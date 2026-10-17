import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITIES, DEMO_PROFILES } from "@/domain/activities";
import { createCoordinator, currentActions } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import type { CoordinationStore } from "@/domain/coordination/store";
import { CommandResult, type CoordinationPlan } from "@/lib/schema";

// Route-level cloud-mode tests: Supabase is "configured", but the store is a shared in-memory store
// (same CAS contract) and auth maps fixed bearer tokens to user ids. No network.
const shared = vi.hoisted(() => ({ configured: true, store: undefined as CoordinationStore | undefined, casMisses: 0 }));

vi.mock("@/lib/supabase/server", () => ({
  supabaseConfigured: () => shared.configured,
  adminClient: () => {
    throw new Error("adminClient must not be reached in tests");
  },
}));
vi.mock("@/lib/supabase/store", async () => {
  const { createMemoryStore } = await import("@/domain/coordination/store");
  const counted = (): CoordinationStore => {
    const s = createMemoryStore();
    // Count lost CAS races so the concurrency test can prove it actually exercised them.
    return { ...s, kind: "supabase", commit: async (...a) => (await s.commit(...a)) || (shared.casMisses++, false) };
  };
  return { createSupabaseStore: () => (shared.store ??= counted()) };
});
// Rate limiting has its own tests (ratelimit.test.ts); here it always allows.
vi.mock("@/lib/supabase/ratelimit", () => ({ rateLimit: async () => true, retryAfterSec: () => 1 }));
vi.mock("@/lib/supabase/auth", () => {
  const users: Record<string, string> = { "Bearer tok-alice": "user-alice", "Bearer tok-bob": "user-bob" };
  return { getUserId: async (req: Request) => users[req.headers.get("authorization") ?? ""] ?? null };
});

type Routes = {
  create: (req: Request) => Promise<Response>;
  get: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  command: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  events: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};

// "New process": drop the module registry and any globalThis singleton so nothing in-process survives.
async function freshRoutes(): Promise<Routes> {
  vi.resetModules();
  for (const k of Object.keys(globalThis)) if (/daybridge/i.test(k)) delete (globalThis as Record<string, unknown>)[k];
  return {
    create: (await import("./plans/route")).POST,
    get: (await import("./plans/[id]/route")).GET as Routes["get"],
    command: (await import("./plans/[id]/commands/route")).POST as Routes["command"],
    events: (await import("./plans/[id]/events/route")).POST as Routes["events"],
  };
}

const ALICE = "tok-alice";
const BOB = "tok-bob";
const req = (body?: unknown, token?: string, headers: Record<string, string> = {}) =>
  new Request("http://test", {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const CONTACTS = [
  { id: "dan", name: "Dan", relation: "son", canDrive: true },
  { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
];
const HOUR = 3600_000;

let r: Routes;
beforeEach(async () => {
  shared.configured = true;
  shared.store = undefined;
  shared.casMisses = 0;
  r = await freshRoutes();
});
afterEach(() => vi.unstubAllEnvs());

// Catalog-agnostic: the first (profile, activity) that yields a feasible proposal with actions.
async function createActionable(token = ALICE): Promise<CoordinationPlan> {
  for (const profile of Object.values(DEMO_PROFILES))
    for (const a of ACTIVITIES) {
      const res = await r.create(req({ profile, activityId: a.id, contacts: CONTACTS }, token));
      expect(res.status).toBe(200);
      const { plan } = CommandResult.parse(await res.json());
      if (plan.state === "PROPOSED" && currentActions(plan).length) return plan;
    }
  throw new Error("No catalog activity yields an actionable proposal");
}

async function cmd(id: string, body: unknown, token = ALICE) {
  const res = await r.command(req(body, token), ctx(id));
  return { status: res.status, body: res.status === 200 ? CommandResult.parse(await res.json()) : await res.json() };
}

async function approveAll(plan: CoordinationPlan, token = ALICE) {
  for (const a of currentActions(plan).filter((x) => x.status === "proposed")) {
    const out = await cmd(plan.id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: new Date(Date.now() + HOUR).toISOString() }, token);
    expect(out.status).toBe(200);
    expect(out.body.outcome).toBe("applied");
  }
}

describe("cloud mode: authentication", () => {
  it("rejects every route with 401 when no valid token is sent", async () => {
    const valid = { profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id };
    expect((await r.create(req(valid))).status).toBe(401);
    expect((await r.create(req(valid, "tok-mallory"))).status).toBe(401);
    expect((await r.get(req(), ctx("x"))).status).toBe(401);
    expect((await r.command(req({ type: "cancel" }), ctx("x"))).status).toBe(401);
    expect((await r.events(req({ eventId: "e", requestId: "r", sequence: 1, type: "ride.confirmed", actor: "demo" }), ctx("x"))).status).toBe(401);
  });

  it("rejects malformed Authorization headers and forged tokens on every route", async () => {
    const valid = { profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id };
    const ev = { eventId: "e", requestId: "r", sequence: 1, type: "ride.confirmed", actor: "demo" };
    const bad = ["Basic tok-alice", "bearer tok-alice", "Bearer", "tok-alice", "Bearer tok-alice extra", "Bearer forged.eyJzdWIiOiJ1c2VyLWFsaWNlIn0.sig"];
    for (const authorization of bad) {
      const h = { authorization };
      expect((await r.create(req(valid, undefined, h))).status).toBe(401);
      expect((await r.get(req(undefined, undefined, h), ctx("x"))).status).toBe(401);
      expect((await r.command(req({ type: "cancel" }, undefined, h), ctx("x"))).status).toBe(401);
      expect((await r.events(req(ev, undefined, h), ctx("x"))).status).toBe(401);
    }
  });

  it("returns 500 'Internal error' with no detail when the store fails unexpectedly", async () => {
    const SECRET = "connection to db.internal:5432 failed password=hunter2";
    shared.store = { kind: "supabase", load: async () => { throw new Error(SECRET); }, create: async () => { throw new Error(SECRET); }, commit: async () => { throw new Error(SECRET); } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const res of [
        await r.create(req({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id }, ALICE)),
        await r.get(req(undefined, ALICE), ctx("x")),
        await r.command(req({ type: "cancel" }, ALICE), ctx("x")),
      ]) {
        expect(res.status).toBe(500);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ error: "Internal error" });
        expect(text).not.toContain("hunter2");
        expect(res.headers.get("x-daybridge-persistence")).toBe("supabase");
      }
    } finally {
      log.mockRestore();
    }
  });

  it("marks responses with the persistence mode", async () => {
    const res = await r.create(req({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id }, ALICE));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-daybridge-persistence")).toBe("supabase");
  });
});

describe("cloud mode: ownership", () => {
  it("another user cannot read, command or post events to a plan (404, indistinguishable from missing)", async () => {
    const plan = await createActionable(ALICE);
    const before = await (await r.get(req(undefined, ALICE), ctx(plan.id))).json();

    expect((await r.get(req(undefined, BOB), ctx(plan.id))).status).toBe(404);
    expect((await cmd(plan.id, { type: "cancel" }, BOB)).status).toBe(404);
    expect((await cmd(plan.id, { type: "accept_proposal" }, BOB)).status).toBe(404);
    const ev = { eventId: "bob-1", requestId: "whatever", sequence: 1, type: "ride.confirmed", actor: "demo" };
    expect((await r.events(req(ev, BOB), ctx(plan.id))).status).toBe(404);
    // Same response as a non-existent id: no enumeration signal.
    const missing = await r.get(req(undefined, BOB), ctx("does-not-exist"));
    expect(missing.status).toBe(404);

    const after = await (await r.get(req(undefined, ALICE), ctx(plan.id))).json();
    expect(after).toEqual(before); // bob's attempts left no trace
  });
});

describe("cloud mode: full flow", () => {
  it("alice: accept -> approve -> execute -> provider confirmations -> READY", async () => {
    const plan = await createActionable(ALICE);
    expect((await cmd(plan.id, { type: "accept_proposal" })).body.plan.state).toBe("AWAITING_APPROVAL");
    await approveAll(plan);
    const exec = await cmd(plan.id, { type: "execute" });
    expect(exec.status).toBe(200);
    expect(exec.body.outcome).toBe("applied");
    expect(exec.body.plan.state).toBe("PENDING_CONFIRMATION");

    let last: CommandResult | undefined;
    for (const [i, a] of currentActions(exec.body.plan).entries()) {
      const type = a.scope.kind === "invite" ? "invite.accepted" : "ride.confirmed";
      const res = await r.events(req({ eventId: `ok-${i}`, requestId: a.providerRequestId, sequence: 1, type, actor: "demo" }, ALICE), ctx(plan.id));
      expect(res.status).toBe(200);
      last = CommandResult.parse(await res.json());
    }
    expect(last!.plan.state).toBe("READY");

    // Duplicate provider event is recorded as duplicate, not re-applied.
    const a0 = currentActions(exec.body.plan)[0];
    const dup = await r.events(req({ eventId: "ok-0", requestId: a0.providerRequestId, sequence: 1, type: a0.scope.kind === "invite" ? "invite.accepted" : "ride.confirmed", actor: "demo" }, ALICE), ctx(plan.id));
    expect(CommandResult.parse(await dup.json()).outcome).toBe("duplicate");
  });

  it("rejects an approval whose scope does not match the proposed action", async () => {
    const plan = await createActionable(ALICE);
    await cmd(plan.id, { type: "accept_proposal" });
    const a = currentActions(plan)[0];
    const out = await cmd(plan.id, { type: "approve", actionId: a.id, scope: { ...a.scope, recipientId: "someone-else" }, expiresAt: new Date(Date.now() + HOUR).toISOString() });
    expect(out.status).toBe(200);
    expect(out.body.outcome).toBe("rejected");
    expect(currentActions(out.body.plan).find((x: { id: string }) => x.id === a.id)!.status).toBe("proposed");
  });

  it("refuses to execute without approval and dispatches nothing", async () => {
    const plan = await createActionable(ALICE);
    await cmd(plan.id, { type: "accept_proposal" });
    const out = await cmd(plan.id, { type: "execute" });
    expect(out.body.outcome).toBe("rejected");
    expect(out.body.plan.state).toBe("AWAITING_APPROVAL");
    expect(currentActions(out.body.plan).every((a: { providerRequestId?: string }) => !a.providerRequestId)).toBe(true);
  });
});

describe("cloud mode: persistence and concurrency", () => {
  it("a plan created before a cold start is still loadable afterwards (state lives in the store, not the process)", async () => {
    const plan = await createActionable(ALICE);
    await cmd(plan.id, { type: "accept_proposal" });
    r = await freshRoutes(); // new module graph, no globalThis caches, same backing store
    const res = await r.get(req(undefined, ALICE), ctx(plan.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: CoordinationPlan; events: { seq: number }[] };
    expect(body.plan.state).toBe("AWAITING_APPROVAL");
    expect((await r.get(req(undefined, BOB), ctx(plan.id))).status).toBe(404); // ownership survives too
    // ...and still accepts commands
    await approveAll(body.plan);
    expect((await cmd(plan.id, { type: "execute" })).body.plan.state).toBe("PENDING_CONFIRMATION");
  });

  it("parallel commands on one plan produce a contiguous, unique event log", async () => {
    const plan = await createActionable(ALICE);
    const N = 8;
    const initial = ((await (await r.get(req(undefined, ALICE), ctx(plan.id))).json()) as { events: unknown[] }).events.length;
    // Each approve of an unknown action is a valid, logged rejection: N independent writes racing on one row.
    // A second serverless instance: its own coordinator (own in-process lock) over the same store, so only
    // the store's CAS orders the two. (The route modules share one globalThis coordinator, hence built directly.)
    const other = createCoordinator({ provider: createMockProvider(), store: shared.store! });
    const approveNope = (i: number) => ({ type: "approve" as const, actionId: `nope-${i}`, scope: currentActions(plan)[0].scope, expiresAt: new Date(Date.now() + HOUR).toISOString() });
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        i % 2
          ? other.command(plan.id, approveNope(i), "user-alice").then(() => ({ status: 200 }), (e: { status?: number }) => ({ status: e.status ?? 500 }))
          : r.command(req(approveNope(i), ALICE), ctx(plan.id)),
      ),
    );
    const statuses = results.map((x) => x.status);
    // Store retries CAS 3x then 409; every 200 must have been committed exactly once.
    expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);
    const ok = statuses.filter((s) => s === 200).length;
    expect(ok).toBeGreaterThan(0);
    expect(shared.casMisses).toBeGreaterThan(0); // the two instances really raced on the row
    const { events } = (await (await r.get(req(undefined, ALICE), ctx(plan.id))).json()) as { events: { seq: number }[] };
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(seqs.length).toBe(initial + ok); // each 200 committed exactly one event; 409s committed nothing
  });
});

describe("production guards", () => {
  it("fails closed with 503 in production when Supabase is not configured", async () => {
    shared.configured = false;
    vi.stubEnv("NODE_ENV", "production");
    r = await freshRoutes();
    expect((await r.create(req({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id }, ALICE))).status).toBe(503);
    expect((await r.get(req(undefined, ALICE), ctx("x"))).status).toBe(503);
    expect((await r.command(req({ type: "cancel" }, ALICE), ctx("x"))).status).toBe(503);
    expect((await r.events(req({ eventId: "e", requestId: "r", sequence: 1, type: "ride.confirmed", actor: "demo" }, ALICE), ctx("x"))).status).toBe(403);
  });

  it("uses the local memory store with no auth outside production when Supabase is not configured", async () => {
    shared.configured = false;
    r = await freshRoutes();
    const res = await r.create(req({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-daybridge-persistence")).toBe("memory");
  });

  it("local `next start` demo (production, no Supabase, DAYBRIDGE_DEMO_EVENTS=1) runs in memory with events open", async () => {
    shared.configured = false;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DAYBRIDGE_DEMO_EVENTS", "1");
    r = await freshRoutes();
    const res = await r.create(req({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-daybridge-persistence")).toBe("memory");
    const { plan } = CommandResult.parse(await res.json());
    const ev = await r.events(req({ eventId: "l1", requestId: "nothing-dispatched", sequence: 1, type: "ride.confirmed", actor: "demo" }), ctx(plan.id));
    expect(ev.status).toBe(200);
  });

  describe("demo events gate (cloud)", () => {
    const KEY = "k".repeat(32);
    const ev = { eventId: "g1", requestId: "nothing-dispatched", sequence: 1, type: "ride.confirmed", actor: "demo" };
    const post = async (id: string, token: string | undefined, headers: Record<string, string> = {}) =>
      (await r.events(req(ev, token, headers), ctx(id))).status;

    it("production + Supabase: /events is always 403, for any flag/key/header/token combination", async () => {
      const plan = await createActionable(ALICE);
      vi.stubEnv("NODE_ENV", "production");
      for (const flag of [undefined, "1", "true"]) {
        for (const key of [undefined, KEY]) {
          vi.unstubAllEnvs();
          vi.stubEnv("NODE_ENV", "production");
          if (flag) vi.stubEnv("DAYBRIDGE_DEMO_EVENTS", flag);
          if (key) vi.stubEnv("DAYBRIDGE_DEMO_KEY", key);
          for (const headers of [{} as Record<string, string>, { "x-daybridge-demo-key": KEY }, { "x-daybridge-demo-key": "x" }]) {
            for (const token of [ALICE, BOB, undefined]) expect(await post(plan.id, token, headers)).toBe(403);
          }
        }
      }
      // Nothing was ingested.
      vi.unstubAllEnvs();
      const { events } = (await (await r.get(req(undefined, ALICE), ctx(plan.id))).json()) as { events: { type: string }[] };
      expect(events.some((e) => JSON.stringify(e).includes("g1"))).toBe(false);
    });

    it("non-production cloud: events open but owner-checked (forged callback recorded as rejected; bob -> 404; no token -> 401)", async () => {
      const plan = await createActionable(ALICE);
      const res = await r.events(req(ev, ALICE), ctx(plan.id));
      expect(res.status).toBe(200);
      expect(CommandResult.parse(await res.json()).outcome).toBe("rejected");
      expect(await post(plan.id, BOB)).toBe(404);
      expect(await post(plan.id, BOB, { "x-daybridge-demo-key": KEY })).toBe(404);
      expect(await post(plan.id, undefined)).toBe(401);
    });
  });
});
