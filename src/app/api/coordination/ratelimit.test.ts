import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITIES, DEMO_PROFILES } from "@/domain/activities";
import type { CoordinationStore } from "@/domain/coordination/store";

vi.setConfig({ testTimeout: 30_000 }); // creates many plans; slow under full-suite load

// Route-level rate limiting. Cloud mode: Supabase "configured", auth maps bearer tokens to users, and the
// rate_limit_hit RPC is a per-key counter (the real helper in src/lib/supabase/ratelimit.ts runs unchanged).
const shared = vi.hoisted(() => ({ configured: true, store: undefined as CoordinationStore | undefined, counts: new Map<string, number>() }));

vi.mock("@/lib/supabase/server", () => ({
  supabaseConfigured: () => shared.configured,
  adminClient: () => ({
    rpc: async (fn: string, a: { p_key: string; p_limit: number }) => {
      if (fn !== "rate_limit_hit") throw new Error(`unexpected rpc ${fn}`);
      const n = (shared.counts.get(a.p_key) ?? 0) + 1;
      shared.counts.set(a.p_key, n);
      return { data: n <= a.p_limit, error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/store", async () => {
  const { createMemoryStore } = await import("@/domain/coordination/store");
  return { createSupabaseStore: () => (shared.store ??= { ...createMemoryStore(), kind: "supabase" }) };
});
vi.mock("@/lib/supabase/auth", () => ({ getUserId: async (req: Request) => req.headers.get("authorization")?.replace("Bearer tok-", "user-") ?? null }));

async function routes() {
  vi.resetModules();
  for (const k of Object.keys(globalThis)) if (/daybridge/i.test(k)) delete (globalThis as Record<string, unknown>)[k];
  return {
    create: (await import("./plans/route")).POST,
    get: (await import("./plans/[id]/route")).GET as (req: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>,
    command: (await import("./plans/[id]/commands/route")).POST as (req: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>,
  };
}
const CREATE_URL = "http://test/api/coordination/plans";
const CMD_URL = "http://test/api/coordination/plans/nope/commands";
const post = (url: string, body: unknown, user?: string) =>
  new Request(url, { method: "POST", headers: user ? { authorization: `Bearer tok-${user}` } : {}, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const CREATE_BODY = { profile: Object.values(DEMO_PROFILES)[0], activityId: ACTIVITIES[0].id, contacts: [] };

beforeEach(() => {
  shared.configured = true;
  shared.store = undefined;
  shared.counts.clear();
});

describe("cloud mode rate limits", () => {
  it("plan creation: 10/hour per user, then 429 with Retry-After; other users unaffected", async () => {
    const r = await routes();
    for (let i = 0; i < 10; i++) expect((await r.create(post(CREATE_URL, CREATE_BODY, "alice"))).status).toBe(200);
    const res = await r.create(post(CREATE_URL, CREATE_BODY, "alice"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests; try again shortly" });
    const retry = Number(res.headers.get("Retry-After"));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(3600);
    expect((await r.create(post(CREATE_URL, CREATE_BODY, "bob"))).status).toBe(200);
  });

  it("writes: 60/min per user; GETs are not limited", async () => {
    const r = await routes();
    for (let i = 0; i < 60; i++) expect((await r.command(post(CMD_URL, {}, "carol"), params("nope"))).status).not.toBe(429);
    const res = await r.command(post(CMD_URL, {}, "carol"), params("nope"));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
    const get = await r.get(new Request("http://test/api/coordination/plans/nope", { headers: { authorization: "Bearer tok-carol" } }), params("nope"));
    expect(get.status).not.toBe(429);
  });

  it("unauthenticated requests get 401 before touching the limiter", async () => {
    const r = await routes();
    expect((await r.create(post(CREATE_URL, CREATE_BODY))).status).toBe(401);
    expect(shared.counts.size).toBe(0);
  });
});

describe("local memory mode", () => {
  it("is never limited", async () => {
    shared.configured = false;
    const r = await routes();
    for (let i = 0; i < 15; i++) expect((await r.create(post(CREATE_URL, CREATE_BODY))).status).toBe(200);
    expect(shared.counts.size).toBe(0);
  });
});
