import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvedPlan, poisonedResult } from "./coordination-fixture";

// A share link is a read-only snapshot. It must not carry coordination data, and neither the share id
// nor the revoke token may act as a coordination plan id or bearer credential.
const shared = vi.hoisted(() => ({ configured: false }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseConfigured: () => shared.configured,
  adminClient: () => {
    throw new Error("adminClient must not be reached in tests");
  },
}));
vi.mock("@/lib/supabase/store", async () => {
  const { createMemoryStore } = await import("@/domain/coordination/store");
  const s = createMemoryStore();
  return { createSupabaseStore: () => ({ ...s, kind: "supabase" }) };
});
vi.mock("@/lib/supabase/auth", () => ({
  getUserId: async (req: Request) => (req.headers.get("authorization") === "Bearer tok-alice" ? "user-alice" : null),
}));
vi.mock("@/lib/supabase/ratelimit", () => ({ rateLimit: async () => true, retryAfterSec: () => 1 })); // limiter has its own tests; fails closed on the mocked adminClient
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (token?: string, body?: unknown) =>
  new Request("http://test", {
    method: body === undefined ? "GET" : "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function load() {
  vi.resetModules();
  for (const k of Object.keys(globalThis)) if (/daybridge/i.test(k)) delete (globalThis as Record<string, unknown>)[k];
  return {
    share: await import("./share"),
    createShare: (await import("@/app/api/plans/route")).POST,
    page: (await import("@/app/plan/[id]/page")).default,
    coordCreate: (await import("@/app/api/coordination/plans/route")).POST,
    coordGet: (await import("@/app/api/coordination/plans/[id]/route")).GET as (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>,
    coordCommand: (await import("@/app/api/coordination/plans/[id]/commands/route")).POST as (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>,
    coordEvents: (await import("@/app/api/coordination/plans/[id]/events/route")).POST as (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>,
  };
}

let m: Awaited<ReturnType<typeof load>>;
beforeEach(async () => {
  shared.configured = false;
  m = await load();
});
afterEach(() => vi.unstubAllEnvs());

async function makeShare() {
  const { plan, secrets } = await approvedPlan();
  const res = await m.createShare(new Request("http://test/api/plans", { method: "POST", body: JSON.stringify({ result: poisonedResult(plan, secrets), consent: true }) }));
  expect(res.status).toBe(201);
  return { ...((await res.json()) as { id: string; revokeToken: string }), plan, secrets };
}

describe("share snapshot carries no coordination data", () => {
  it("stored snapshot and served page contain no plan/action/approval ids, idempotency keys, contacts or profile", async () => {
    const { id, plan, secrets } = await makeShare();
    expect(secrets.length).toBeGreaterThan(6);
    const snap = (await m.share.getShare(id))!;
    expect(Object.keys(snap).sort()).toEqual(["createdAt", "dataSource", "displayName", "expiresAt", "items", "summary"]);
    expect(m.share.SharedPlan.safeParse(snap).success).toBe(true);
    const html = renderToStaticMarkup(await m.page({ params: Promise.resolve({ id }) } as never));
    expect(html).toContain(snap.summary.replace(/'/g, "&#x27;"));
    for (const out of [JSON.stringify(snap), html]) {
      for (const s of secrets) expect(out).not.toContain(s);
      expect(out).not.toMatch(/coordinationPlanId|approval|idempotency|contacts|profile|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    }
    expect(plan.approvals.length).toBeGreaterThan(0);
  });
});

describe("share id / revoke token confer no coordination authority", () => {
  it("cloud mode: as bearer token → 401; as plan id (signed in) → 404; never data", async () => {
    const { id, revokeToken, plan } = await makeShare();
    shared.configured = true;
    // A real plan owned by alice, to show the share credentials can't reach it either.
    const own = await m.coordCreate(new Request("http://test", { method: "POST", headers: { authorization: "Bearer tok-alice" }, body: JSON.stringify({ profile: plan.profile, activityId: plan.activityId }) }));
    expect(own.status).toBe(200);
    const ownId = (await own.json()).plan.id as string;
    const ev = { eventId: "e1", requestId: "r1", sequence: 1, type: "ride.confirmed", actor: "demo" };
    const approve = { type: "approve", actionId: id, scope: plan.actions[0].scope, expiresAt: new Date(Date.now() + 3600_000).toISOString() };

    for (const tok of [revokeToken, id]) {
      for (const pid of [ownId, id, revokeToken]) {
        expect((await m.coordGet(req(tok), ctx(pid))).status).toBe(401);
        expect((await m.coordCommand(req(tok, { type: "cancel" }), ctx(pid))).status).toBe(401);
        expect((await m.coordCommand(req(tok, approve), ctx(pid))).status).toBe(401);
        expect((await m.coordEvents(req(tok, ev), ctx(pid))).status).toBe(401);
      }
    }
    for (const pid of [id, revokeToken]) {
      const res = await m.coordGet(req("tok-alice"), ctx(pid));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: expect.any(String) });
      expect((await m.coordCommand(req("tok-alice", approve), ctx(pid))).status).toBe(404);
      expect((await m.coordEvents(req("tok-alice", ev), ctx(pid))).status).toBe(404);
    }
  });

  it("local memory mode (no auth): share id / revoke token as plan id → 404", async () => {
    const { id, revokeToken } = await makeShare();
    for (const pid of [id, revokeToken]) {
      expect((await m.coordGet(req(revokeToken), ctx(pid))).status).toBe(404);
      expect((await m.coordCommand(req(revokeToken, { type: "accept_proposal" }), ctx(pid))).status).toBe(404);
    }
  });
});
