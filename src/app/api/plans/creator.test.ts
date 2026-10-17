import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROFILES } from "@/domain/activities";
import { runScenario } from "@/domain/engine";

// Cloud candidate: creator recovery routing, with auth and the durable store mocked.
const auth = vi.hoisted(() => ({ getUserId: vi.fn<(req: Request) => Promise<string | null>>() }));
vi.mock("@/lib/supabase/auth", () => auth);
const store = vi.hoisted(() => ({
  createShare: vi.fn(),
  revokeShare: vi.fn(),
  revokeShareAsCreator: vi.fn(),
  listMyShares: vi.fn(),
}));
vi.mock("@/lib/share/share", async (orig) => ({ ...(await orig<object>()), ...store }));
// Real limiter (memory fallback) unless `allowAll` is set: in cloud mode it would hit the fake Supabase and fail closed.
const rl = vi.hoisted(() => ({ allowAll: false }));
vi.mock("@/lib/supabase/ratelimit", async (orig) => {
  const real = await orig<typeof import("@/lib/supabase/ratelimit")>();
  return { ...real, rateLimit: (...a: Parameters<typeof real.rateLimit>) => (rl.allowAll ? Promise.resolve(true) : real.rateLimit(...a)) };
});

const { POST } = await import("./route");
const { DELETE } = await import("./[id]/route");
const { GET } = await import("./mine/route");

const result = { ...runScenario({ profile: DEMO_PROFILES.margaret }), explanation: "x", dataSource: "mock" as const };
const id = "A".repeat(22);
const hdr = (bearer?: string): HeadersInit => (bearer ? { authorization: `Bearer ${bearer}` } : {});
const post = (bearer?: string) => POST(new Request("http://t/api/plans", { method: "POST", headers: hdr(bearer), body: JSON.stringify({ result, consent: true }) }));
const del = (bearer?: string) => DELETE(new Request(`http://t/api/plans/${id}`, { method: "DELETE", headers: hdr(bearer) }), { params: Promise.resolve({ id }) });
const mine = (bearer?: string) => GET(new Request("http://t/api/plans/mine", { headers: hdr(bearer) }));

beforeEach(() => {
  vi.resetAllMocks();
  store.createShare.mockResolvedValue({ id, revokeToken: "rt", expiresAt: new Date(Date.now() + 1e6).toISOString() });
  auth.getUserId.mockImplementation(async (req) => (req.headers.get("authorization") === "Bearer jwt-u1" ? "u1" : null));
});
afterEach(() => vi.unstubAllEnvs());

describe("cloud mode", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SECRET_KEY", "k");
    rl.allowAll = true;
  });
  afterEach(() => (rl.allowAll = false));

  it("POST records the verified creator; response shape unchanged", async () => {
    const res = await post("jwt-u1");
    expect(res.status).toBe(201);
    expect(Object.keys(await res.json()).sort()).toEqual(["expiresAt", "id", "revokeToken", "url"]);
    expect(store.createShare.mock.calls[0][3]).toBe("u1");
  });

  it("POST without a bearer is anonymous; with an invalid bearer is 401 and creates nothing", async () => {
    expect((await post()).status).toBe(201);
    expect(store.createShare.mock.calls[0][3]).toBeNull();
    expect((await post("bogus")).status).toBe(401);
    expect(store.createShare).toHaveBeenCalledTimes(1);
  });

  it("DELETE: revoke token wins without touching auth", async () => {
    store.revokeShare.mockResolvedValue(true);
    expect((await del("rt")).status).toBe(204);
    expect(auth.getUserId).not.toHaveBeenCalled();
  });

  it("DELETE: creator's access token → revokeShareAsCreator(id, user)", async () => {
    store.revokeShare.mockResolvedValue(false);
    store.revokeShareAsCreator.mockResolvedValue(true);
    expect((await del("jwt-u1")).status).toBe(204);
    expect(store.revokeShareAsCreator).toHaveBeenCalledWith(id, "u1");
  });

  it("DELETE: non-creator, bad token, or no header → identical 404", async () => {
    store.revokeShare.mockResolvedValue(false);
    store.revokeShareAsCreator.mockResolvedValue(false);
    const bodies = [];
    for (const b of ["jwt-u1", "bogus", undefined]) {
      const res = await del(b);
      expect(res.status).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("GET /mine: 401 without a valid user; 200 list for the user", async () => {
    expect((await mine()).status).toBe(401);
    expect((await mine("bogus")).status).toBe(401);
    store.listMyShares.mockResolvedValue([{ id, url: `/plan/${id}`, expiresAt: "e", createdAt: "c", summary: "s" }]);
    const res = await mine("jwt-u1");
    expect(res.status).toBe(200);
    expect(store.listMyShares).toHaveBeenCalledWith("u1");
    expect(JSON.stringify(await res.json())).not.toMatch(/token|creator/i);
  });
});

describe("memory mode (unchanged)", () => {
  beforeEach(() => vi.stubEnv("SUPABASE_URL", ""));

  it("bearer on POST is ignored; DELETE never consults auth; /mine is 404", async () => {
    expect((await post("bogus")).status).toBe(201);
    expect(store.createShare.mock.calls[0][3]).toBeNull();
    store.revokeShare.mockResolvedValue(false);
    expect((await del("jwt-u1")).status).toBe(404);
    expect((await mine("jwt-u1")).status).toBe(404);
    expect(auth.getUserId).not.toHaveBeenCalled();
    expect(store.revokeShareAsCreator).not.toHaveBeenCalled();
  });
});

describe("rate limit (memory fallback)", () => {
  beforeEach(() => vi.stubEnv("SUPABASE_URL", ""));
  it("20 creates/hour per client IP → 429; other IPs unaffected", async () => {
    const p = (ip: string) => POST(new Request("http://t/api/plans", { method: "POST", headers: { "x-forwarded-for": `${ip}, 10.0.0.1` }, body: JSON.stringify({ result, consent: true }) }));
    for (let i = 0; i < 20; i++) expect((await p("203.0.113.9")).status).toBe(201);
    const res = await p("203.0.113.9");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error).toBeTruthy();
    expect((await p("203.0.113.10")).status).toBe(201);
  });
});
