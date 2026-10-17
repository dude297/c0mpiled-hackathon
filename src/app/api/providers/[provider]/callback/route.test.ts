import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITIES, DEMO_PROFILES } from "@/domain/activities";
import { currentActions } from "@/domain/coordination/coordinator";
import type { CoordinationStore } from "@/domain/coordination/store";
import { sign } from "@/lib/providers/sign";
import { CommandResult, type CoordinationPlan } from "@/lib/schema";

// Cloud mode (Supabase "configured", shared in-memory store, fixed bearer tokens), same harness as coordination/cloud.test.ts.
const shared = vi.hoisted(() => ({ store: undefined as CoordinationStore | undefined }));
vi.mock("@/lib/supabase/server", () => ({ supabaseConfigured: () => true, adminClient: () => { throw new Error("no db in tests"); } }));
vi.mock("@/lib/supabase/store", async () => {
  const { createMemoryStore } = await import("@/domain/coordination/store");
  return { createSupabaseStore: () => (shared.store ??= { ...createMemoryStore(), kind: "supabase" }) };
});
vi.mock("@/lib/supabase/auth", () => ({ getUserId: async (req: Request) => ({ "Bearer tok-alice": "user-alice", "Bearer tok-bob": "user-bob" })[req.headers.get("authorization") ?? ""] ?? null }));
vi.mock("@/lib/supabase/ratelimit", () => ({ rateLimit: async () => true, retryAfterSec: () => 1 }));

const RIDE_SECRET = "r".repeat(32);
const INVITE_SECRET = "i".repeat(32);
const HOUR = 3600_000;
const now = () => Math.floor(Date.now() / 1000);

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
let callback: Handler, create: (req: Request) => Promise<Response>, get: Handler, command: Handler, events: Handler;

beforeEach(async () => {
  vi.resetModules();
  for (const k of Object.keys(globalThis)) if (/daybridge/i.test(k)) delete (globalThis as Record<string, unknown>)[k];
  shared.store = undefined;
  vi.stubEnv("PROVIDER_WEBHOOK_SECRET_MOCK_RIDE", RIDE_SECRET);
  vi.stubEnv("PROVIDER_WEBHOOK_SECRET_MOCK_INVITE", INVITE_SECRET);
  callback = (await import("./route")).POST as unknown as Handler;
  create = (await import("@/app/api/coordination/plans/route")).POST;
  get = (await import("@/app/api/coordination/plans/[id]/route")).GET as unknown as Handler;
  command = (await import("@/app/api/coordination/plans/[id]/commands/route")).POST as unknown as Handler;
  events = (await import("@/app/api/coordination/plans/[id]/events/route")).POST as unknown as Handler;
});
afterEach(() => vi.unstubAllEnvs());

const userReq = (body?: unknown, token = "tok-alice") =>
  new Request("http://test", { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const secretFor = (provider: string) => (provider === "mock-invite" ? INVITE_SECRET : RIDE_SECRET);

function post(provider: string, body: unknown, opts: { raw?: string; sig?: string | null; t?: number; secret?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  const sig = opts.sig === undefined ? sign(opts.secret ?? secretFor(provider), raw, opts.t ?? now()) : opts.sig;
  return callback(new Request("http://test", { method: "POST", headers: sig ? { "x-daybridge-signature": sig } : {}, body: raw }), p({ provider }));
}

// Alice's plan, accepted, approved and executed: every current action has a providerRequestId.
async function dispatched(): Promise<CoordinationPlan> {
  for (const profile of Object.values(DEMO_PROFILES))
    for (const a of ACTIVITIES) {
      const { plan } = CommandResult.parse(await (await create(userReq({ profile, activityId: a.id, contacts: [{ id: "dan", name: "Dan", relation: "son", canDrive: true }, { id: "elaine", name: "Elaine", relation: "friend", canDrive: false }] }))).json());
      if (plan.state !== "PROPOSED" || !currentActions(plan).length) continue;
      await command(userReq({ type: "accept_proposal" }), p({ id: plan.id }));
      for (const x of currentActions(plan)) await command(userReq({ type: "approve", actionId: x.id, scope: x.scope, expiresAt: new Date(Date.now() + HOUR).toISOString() }), p({ id: plan.id }));
      const exec = CommandResult.parse(await (await command(userReq({ type: "execute" }), p({ id: plan.id }))).json());
      expect(exec.plan.state).toBe("PENDING_CONFIRMATION");
      return exec.plan;
    }
  throw new Error("no actionable activity");
}
const providerOf = (kind: string) => (kind === "invite" ? "mock-invite" : "mock-ride");
const okType = (kind: string) => (kind === "invite" ? "invite.accepted" : "ride.confirmed");
const alicePlan = async (id: string) => (await (await get(userReq(), p({ id }))).json()).plan as CoordinationPlan;

describe("provider callback: gate and signature", () => {
  const body = { planId: "x", eventId: "e1", requestId: "r", sequence: 1, type: "ride.confirmed" };

  it("404 when the secret is missing or shorter than 32 chars, or the provider is not allowlisted", async () => {
    vi.stubEnv("PROVIDER_WEBHOOK_SECRET_MOCK_RIDE", "");
    expect((await post("mock-ride", body)).status).toBe(404);
    vi.stubEnv("PROVIDER_WEBHOOK_SECRET_MOCK_RIDE", "s".repeat(31));
    expect((await post("mock-ride", body, { secret: "s".repeat(31) })).status).toBe(404);
    vi.stubEnv("PROVIDER_WEBHOOK_SECRET_UBER", "u".repeat(40));
    expect((await post("uber", body, { secret: "u".repeat(40) })).status).toBe(404);
  });

  it("401 for unsigned, tampered body, tampered/foreign signature, stale or future timestamp", async () => {
    const raw = JSON.stringify(body);
    expect((await post("mock-ride", body, { sig: null })).status).toBe(401);
    expect((await post("mock-ride", body, { raw: raw.replace("e1", "e2"), sig: sign(RIDE_SECRET, raw, now()) })).status).toBe(401);
    const good = sign(RIDE_SECRET, raw, now());
    expect((await post("mock-ride", body, { sig: good.slice(0, -1) + (good.endsWith("0") ? "1" : "0") })).status).toBe(401);
    expect((await post("mock-ride", body, { secret: INVITE_SECRET })).status).toBe(401);
    expect((await post("mock-ride", body, { t: now() - 301 })).status).toBe(401);
    expect((await post("mock-ride", body, { t: now() + 301 })).status).toBe(401);
  });

  it("413 above 16KB, 400 for invalid payload or a type outside the provider's kind", async () => {
    expect((await post("mock-ride", { ...body, eventId: "x".repeat(17_000) })).status).toBe(413);
    expect((await post("mock-ride", { ...body, actor: "demo" })).status).toBe(400); // actor is never caller-chosen
    expect((await post("mock-ride", { ...body, sequence: 0 })).status).toBe(400);
    expect((await post("mock-invite", { ...body, type: "ride.confirmed" })).status).toBe(400);
  });
});

describe("provider callback: ingest", () => {
  it("valid signed callbacks apply with actor=provider, reach READY, and never return the plan", async () => {
    const plan = await dispatched();
    for (const [i, a] of currentActions(plan).entries()) {
      const res = await post(providerOf(a.scope.kind), { planId: plan.id, eventId: `cb-${i}`, requestId: a.providerRequestId, sequence: 1, type: okType(a.scope.kind) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ outcome: "applied" });
    }
    const after = await (await get(userReq(), p({ id: plan.id }))).json();
    expect(after.plan.state).toBe("READY");
    expect(after.events.filter((e: { actor: string }) => e.actor === "provider").length).toBe(currentActions(plan).length);
  });

  it("a replayed signed callback is a duplicate and never double-applies", async () => {
    const plan = await dispatched();
    const a = currentActions(plan)[0];
    const raw = JSON.stringify({ planId: plan.id, eventId: "cb-r", requestId: a.providerRequestId, sequence: 1, type: okType(a.scope.kind) });
    const sig = sign(secretFor(providerOf(a.scope.kind)), raw, now());
    expect(await (await post(providerOf(a.scope.kind), null, { raw, sig })).json()).toEqual({ outcome: "applied" });
    const mid = await alicePlan(plan.id);
    expect((await (await post(providerOf(a.scope.kind), null, { raw, sig })).json()).outcome).toBe("duplicate");
    const end = await alicePlan(plan.id);
    expect(end.dependencies).toEqual(mid.dependencies);
    expect(end.state).toBe(mid.state);
  });

  it("unknown requestId or a request of the other kind is recorded rejected and does not burn the key", async () => {
    const plan = await dispatched();
    const a = currentActions(plan)[0];
    const prov = providerOf(a.scope.kind);
    const unknown = await post(prov, { planId: plan.id, eventId: "cb-k", requestId: "nope", sequence: 1, type: okType(a.scope.kind) });
    expect((await unknown.json()).outcome).toBe("rejected");
    const other = currentActions(plan).find((x) => x.scope.kind !== a.scope.kind);
    if (other) {
      const wrong = await post(prov, { planId: plan.id, eventId: "cb-k", requestId: other.providerRequestId, sequence: 1, type: okType(a.scope.kind) });
      expect((await wrong.json()).outcome).toBe("rejected");
    }
    // Same eventId, now valid: applies because rejections never burned it.
    const real = await post(prov, { planId: plan.id, eventId: "cb-k", requestId: a.providerRequestId, sequence: 1, type: okType(a.scope.kind) });
    expect((await real.json()).outcome).toBe("applied");
  });

  it("a closed plan or stale sequence is ignored, not applied, even for the system caller", async () => {
    const plan = await dispatched();
    const a = currentActions(plan)[0];
    const prov = providerOf(a.scope.kind);
    expect((await (await post(prov, { planId: plan.id, eventId: "s1", requestId: a.providerRequestId, sequence: 2, type: okType(a.scope.kind) })).json()).outcome).toBe("applied");
    expect((await (await post(prov, { planId: plan.id, eventId: "s2", requestId: a.providerRequestId, sequence: 1, type: `${a.scope.kind}.cancelled` })).json()).outcome).toBe("ignored");
    await command(userReq({ type: "cancel" }), p({ id: plan.id }));
    expect((await (await post(prov, { planId: plan.id, eventId: "s3", requestId: a.providerRequestId, sequence: 9, type: `${a.scope.kind}.cancelled` })).json()).outcome).toBe("ignored");
    expect((await alicePlan(plan.id)).state).toBe("CANCELLED");
  });

  it("missing plan -> 404; user routes still enforce the owner; /events stays 403 in cloud production", async () => {
    expect((await post("mock-ride", { planId: "missing", eventId: "m", requestId: "r", sequence: 1, type: "ride.confirmed" })).status).toBe(404);
    const plan = await dispatched();
    const a = currentActions(plan)[0];
    const ev = { eventId: "bob", requestId: a.providerRequestId, sequence: 1, type: okType(a.scope.kind), actor: "provider" };
    expect((await events(userReq(ev, "tok-bob"), p({ id: plan.id }))).status).toBe(404);
    expect((await get(userReq(undefined, "tok-bob"), p({ id: plan.id }))).status).toBe(404);
    vi.stubEnv("NODE_ENV", "production");
    expect((await events(userReq(ev), p({ id: plan.id }))).status).toBe(403);
    // ...while the signed callback still works there.
    expect((await post(providerOf(a.scope.kind), { planId: plan.id, ...ev, actor: undefined })).status).toBe(200);
  });
});
