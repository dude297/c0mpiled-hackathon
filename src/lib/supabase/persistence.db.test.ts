import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/domain/activities";
import { createCoordinator, currentActions, readyViolations, type Coordinator } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import { createMemoryStore, type StoredPlan } from "@/domain/coordination/store";
import { handle } from "@/app/api/coordination/_lib/service";
import { CommandResult, type Contact, type CoordinationEvent, type CoordinationPlan, type Profile } from "@/lib/schema";
import { adminClient } from "./server";
import { createSupabaseStore } from "./store";

// Persistence guarantees proven against the REAL local Supabase database (`supabase start` + env from
// `supabase status -o env`). Skipped unless SUPABASE_URL + SUPABASE_SECRET_KEY (+ publishable key for RLS) are set.
const URL_ = process.env.SUPABASE_URL;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const live = !!(URL_ && process.env.SUPABASE_SECRET_KEY);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 }); // real DB round-trips

const WORKSHOP: Activity = { id: "workshop", name: "Saturday Craft Workshop", tags: ["crafts"], day: "Sat", time: "afternoon", costPerWeek: 5, travelMin: { bus: 50, family: 15, paratransit: 25 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false };
const MAYA: Profile = { name: "Maya", interests: ["crafts"], mobility: "walker", transport: ["bus", "family", "paratransit"], maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true };
const CONTACTS: Contact[] = [
  { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
  { id: "dan", name: "Dan", relation: "son", canDrive: true },
];
const HOUR = 3600_000;
const ok = (r: CommandResult) => CommandResult.parse(r);
const contiguous = (seqs: number[]) => seqs.length > 0 && seqs.every((s, i) => s === i + 1);
const pending = (p: CoordinationPlan) => currentActions(p).filter((a) => a.status === "proposed" || a.status === "revoked");
const ev = (seq: number, extra: Partial<CoordinationEvent> = {}): CoordinationEvent => ({ seq, at: new Date().toISOString(), type: "test.event", actor: "demo", outcome: "applied", payload: { n: seq }, ...extra });

const provider = createMockProvider(); // one external provider shared by every "process"
const make = (store = createSupabaseStore()) => createCoordinator({ provider, store, activities: [WORKSHOP], newId: randomUUID });

// A fresh module graph = a fresh process: new admin client singleton, new store, new coordinator (no shared locks).
async function freshProcess(): Promise<Coordinator> {
  vi.resetModules();
  const [{ createSupabaseStore: mkStore }, { createCoordinator: mkCoord }] = await Promise.all([import("./store"), import("@/domain/coordination/coordinator")]);
  return mkCoord({ provider, store: mkStore(), activities: [WORKSHOP], newId: randomUUID });
}

async function realEntry(): Promise<Omit<StoredPlan, "rev" | "ownerId">> {
  const mem = createMemoryStore();
  const r = await createCoordinator({ provider: createMockProvider(), store: mem, activities: [WORKSHOP], newId: randomUUID }).create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
  const s = (await mem.load(r.plan.id))!;
  return { plan: s.plan, log: s.log, seenKeys: s.seenKeys };
}

// Raw rows from all three tables, read directly (not via the store under test).
async function rows(id: string) {
  const db = adminClient();
  const [p, e, k] = await Promise.all([
    db.from("coordination_plans").select("rev, plan, updated_at, owner_id").eq("id", id).maybeSingle(),
    db.from("coordination_events").select("*").eq("plan_id", id).order("seq"),
    db.from("coordination_seen_keys").select("key").eq("plan_id", id).order("key"),
  ]);
  for (const r of [p, e, k]) if (r.error) throw r.error;
  return { plan: p.data, events: e.data!, keys: k.data!.map((x) => x.key as string) };
}

describe.skipIf(!live)("Supabase persistence (real local DB)", () => {
  const store = live ? createSupabaseStore() : undefined!;
  const users: string[] = [];
  let owner = "";
  const newUser = async () => {
    const { data, error } = await adminClient().auth.admin.createUser({ email: `db-${randomUUID()}@test.local`, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    return data.user.id;
  };
  const toAwaitingApproval = async (c: Coordinator) => {
    const id = ok(await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS }, owner)).plan.id;
    expect(ok(await c.command(id, { type: "accept_proposal" }, owner)).plan.state).toBe("AWAITING_APPROVAL");
    return id;
  };
  const approveAll = async (c: Coordinator, id: string) => {
    for (const a of pending((await c.get(id, owner)).plan))
      ok(await c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: new Date(Date.now() + HOUR).toISOString() }, owner));
  };

  beforeAll(async () => {
    owner = await newUser();
  });
  afterAll(async () => {
    for (const u of users) await adminClient().auth.admin.deleteUser(u);
  });

  describe("1. CAS races", () => {
    it("12 concurrent commits with the same expectedRev: exactly one wins", async () => {
      const e = await realEntry();
      await store.create({ ...e, ownerId: owner });
      const n = e.log.length;
      const stores = [store, createSupabaseStore(), createSupabaseStore()];
      const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => stores[i % 3].commit(e.plan.id, 1, e.plan, [ev(n + 1, { type: `w${i}` })], [`k${i}`])));
      expect(rs.filter(Boolean)).toHaveLength(1);
      const winner = rs.indexOf(true);
      const r = await rows(e.plan.id);
      expect(r.plan!.rev).toBe(2);
      expect(r.events.map((x) => x.seq)).toEqual(Array.from({ length: n + 1 }, (_, i) => i + 1));
      expect(r.events.at(-1)!.type).toBe(`w${winner}`);
      expect(r.keys).toEqual([...e.seenKeys, `k${winner}`].sort());
    });

    it("12 concurrent coordinator commands from 3 instances: each applied or 409; seqs contiguous; rev = commits + 1", async () => {
      const instances = [make(), await freshProcess(), await freshProcess()];
      const id = await toAwaitingApproval(instances[0]); // rev 2
      const start = (await rows(id)).plan!.rev;
      // Forged callbacks: each is rejected but still recorded (one commit each), so every call contends for the row.
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) => instances[i % 3].ingest(id, { eventId: `race-${i}`, requestId: `forged-${i}`, sequence: 1, type: "ride.confirmed", actor: "demo" }, owner)),
      );
      const applied = results.filter((r) => r.status === "fulfilled");
      for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
      for (const r of applied) expect((r as PromiseFulfilledResult<CommandResult>).value.outcome).toBe("rejected");
      const r = await rows(id);
      expect(r.plan!.rev).toBe(start + applied.length);
      expect(contiguous(r.events.map((x) => x.seq))).toBe(true);
      expect(r.events.filter((x) => String((x.payload as { eventId?: string }).eventId).startsWith("race-"))).toHaveLength(applied.length);
      expect(applied.length).toBeGreaterThanOrEqual(1);
      // rev = number of successful commits + 1 over the plan's whole life (create = rev 1)
      expect(r.plan!.rev).toBe(1 + 1 + applied.length);
    });
  });

  describe("2. rollback on partial failure", () => {
    it("duplicate seq, collision with stored seq, or invalid timestamp leaves all three tables unchanged", async () => {
      const e = await realEntry();
      await store.create({ ...e, ownerId: owner });
      const before = await rows(e.plan.id);
      const n = e.log.length;
      const changed = { ...e.plan, state: "CANCELLED" as const };
      await expect(store.commit(e.plan.id, 1, changed, [ev(n + 1), ev(n + 1)], ["k-dup"])).rejects.toThrow(/coordination_commit/);
      await expect(store.commit(e.plan.id, 1, changed, [ev(1)], ["k-coll"])).rejects.toThrow(/coordination_commit/);
      await expect(store.commit(e.plan.id, 1, changed, [ev(n + 1, { at: "not-a-date" })], ["k-ts"])).rejects.toThrow(/coordination_commit/);
      expect(await rows(e.plan.id)).toEqual(before); // plan jsonb, rev, updated_at, events, seen_keys
      expect(before.plan!.rev).toBe(1);
    });
  });

  it("3. restart survival: a fresh process reads the plan and continues it to READY", async () => {
    const id = await toAwaitingApproval(make());
    const b = await freshProcess();
    const { plan, events } = await b.get(id, owner);
    expect(plan.state).toBe("AWAITING_APPROVAL");
    expect(events.length).toBeGreaterThan(0);
    await approveAll(b, id);
    const c = await freshProcess();
    ok(await c.command(id, { type: "execute" }, owner));
    for (const a of currentActions((await c.get(id, owner)).plan))
      ok(await (await freshProcess()).ingest(id, { eventId: `ok-${a.id}`, requestId: a.providerRequestId!, sequence: 1, type: a.scope.kind === "ride" ? "ride.confirmed" : "invite.accepted", actor: "demo" }, owner));
    const final = await (await freshProcess()).get(id, owner);
    expect(final.plan.state).toBe("READY");
    expect(contiguous(final.events.map((x) => x.seq))).toBe(true);
  });

  it("4. duplicate / stale / forged provider events, consent and READY gates through the real store", async () => {
    const a = make();
    const b = await freshProcess();
    const id = await toAwaitingApproval(a);

    const calls = provider.calls.length;
    expect(ok(await a.command(id, { type: "execute" }, owner)).outcome).toBe("rejected"); // no approval yet
    expect(provider.calls.length).toBe(calls);

    await approveAll(b, id);
    ok(await a.command(id, { type: "execute" }, owner));
    const acts = currentActions((await b.get(id, owner)).plan);
    expect(acts.length).toBeGreaterThanOrEqual(2);
    const [first, ...rest] = acts;
    const kind = (x: typeof first) => (x.scope.kind === "ride" ? "ride.confirmed" : "invite.accepted") as "ride.confirmed" | "invite.accepted";

    // Forged requestId: rejected, and its eventId is NOT burned.
    expect(ok(await a.ingest(id, { eventId: "E1", requestId: "forged-req", sequence: 1, type: kind(first), actor: "demo" }, owner)).outcome).toBe("rejected");
    expect((await rows(id)).keys).not.toContain("event:E1");

    // The real event with the same eventId then applies (other instance), and a replay is a duplicate.
    expect(ok(await b.ingest(id, { eventId: "E1", requestId: first.providerRequestId!, sequence: 1, type: kind(first), actor: "demo" }, owner)).outcome).toBe("applied");
    expect((await rows(id)).keys).toContain("event:E1");
    expect(ok(await a.ingest(id, { eventId: "E1", requestId: first.providerRequestId!, sequence: 1, type: kind(first), actor: "demo" }, owner)).outcome).toBe("duplicate");

    // Stale sequence (new eventId, sequence <= lastSequence) is ignored.
    expect(ok(await a.ingest(id, { eventId: "E1-stale", requestId: first.providerRequestId!, sequence: 1, type: kind(first), actor: "demo" }, owner)).outcome).toBe("ignored");

    // Not READY until every dependency is confirmed.
    expect((await b.get(id, owner)).plan.state).not.toBe("READY");
    for (const x of rest) ok(await b.ingest(id, { eventId: `ok-${x.id}`, requestId: x.providerRequestId!, sequence: 1, type: kind(x), actor: "demo" }, owner));
    const p = (await a.get(id, owner)).plan;
    expect(p.state).toBe("READY");
    expect(readyViolations(p)).toEqual([]);
    const r = await rows(id);
    expect(contiguous(r.events.map((x) => x.seq))).toBe(true);
    expect(r.events.filter((x) => (x.payload as { eventId?: string }).eventId === "E1").map((x) => x.outcome)).toEqual(["rejected", "applied", "duplicate"]);
  });

  describe("5. corrupt stored data is never trusted", () => {
    const tamper = async (id: string, patch: Record<string, unknown>, table = "coordination_plans", seq?: number) => {
      let q = adminClient().from(table).update(patch).eq(table === "coordination_plans" ? "id" : "plan_id", id);
      if (seq) q = q.eq("seq", seq);
      const { error } = await q;
      expect(error).toBeNull();
    };
    const expect500 = async (c: Coordinator, id: string) => {
      await expect(c.get(id, owner)).rejects.not.toHaveProperty("status");
      const before = (await rows(id)).plan!.rev;
      const res = await handle({ coordinator: c, userId: owner, persistence: "supabase" }, () => c.command(id, { type: "cancel" }, owner));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal error" });
      expect((await rows(id)).plan!.rev).toBe(before); // nothing written on top of corrupt data
    };
    const errSpy = () => vi.spyOn(console, "error").mockImplementation(() => {});

    it("wrong plan shape", async () => {
      const spy = errSpy();
      const id = await toAwaitingApproval(make());
      await tamper(id, { plan: { id, bogus: true } });
      await expect(store.load(id)).rejects.toThrow();
      await expect500(make(), id);
      spy.mockRestore();
    });

    it("plan id mismatch", async () => {
      const spy = errSpy();
      const id = await toAwaitingApproval(make());
      const other = await realEntry();
      await tamper(id, { plan: other.plan });
      await expect(store.load(id)).rejects.toThrow(/mismatched id/);
      await expect500(make(), id);
      spy.mockRestore();
    });

    it("event with a bad actor", async () => {
      const spy = errSpy();
      const id = await toAwaitingApproval(make());
      await tamper(id, { actor: "hacker" }, "coordination_events", 1);
      await expect(store.load(id)).rejects.toThrow();
      await expect500(make(), id);
      spy.mockRestore();
    });
  });

  describe("plan cap (20 per owner)", () => {
    it("20 creates OK, 21st -> 429; 21 concurrent creates from a fresh owner -> exactly 20", async () => {
      const capped = await newUser();
      for (let i = 0; i < 20; i++) await store.create({ ...(await realEntry()), ownerId: capped });
      await expect(store.create({ ...(await realEntry()), ownerId: capped })).rejects.toMatchObject({ status: 429, message: "Plan limit reached for this account" });
      const c = make();
      await expect(c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS }, capped)).rejects.toMatchObject({ status: 429 });

      const racer = await newUser();
      const entries = await Promise.all(Array.from({ length: 21 }, () => realEntry()));
      const stores = [store, createSupabaseStore(), createSupabaseStore()];
      const rs = await Promise.allSettled(entries.map((e, i) => stores[i % 3].create({ ...e, ownerId: racer })));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(20);
      const failed = rs.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(failed).toHaveLength(1);
      expect(failed[0].reason).toMatchObject({ status: 429 });
      const { count } = await adminClient().from("coordination_plans").select("id", { count: "exact", head: true }).eq("owner_id", racer);
      expect(count).toBe(20);
    });
  });

  describe.skipIf(!PUB)("6. RLS + grants (publishable-key clients)", () => {
    const asUser = async () => {
      const c = createClient(URL_!, PUB!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await c.auth.signInAnonymously();
      if (error) throw error;
      return { c, id: data.user!.id };
    };

    it("owner reads own rows only; nobody writes; seen_keys + RPCs closed; deleting the user cascades", async () => {
      const x = await asUser();
      const y = await asUser();
      users.push(y.id); // x is deleted explicitly below
      const ex = await realEntry();
      const ey = await realEntry();
      await store.create({ ...ex, ownerId: x.id });
      await store.create({ ...ey, ownerId: y.id });
      const anon = createClient(URL_!, PUB!, { auth: { persistSession: false, autoRefreshToken: false } });

      expect((await x.c.from("coordination_plans").select("id")).data).toEqual([{ id: ex.plan.id }]);
      expect((await x.c.from("coordination_events").select("plan_id, seq")).data!.every((r) => r.plan_id === ex.plan.id)).toBe(true);
      expect((await x.c.from("coordination_events").select("seq").eq("plan_id", ex.plan.id)).data).toHaveLength(ex.log.length);
      expect((await y.c.from("coordination_plans").select("id").eq("id", ex.plan.id)).data).toEqual([]);
      expect((await y.c.from("coordination_events").select("seq").eq("plan_id", ex.plan.id)).data).toEqual([]);

      for (const c of [x.c, anon]) {
        expect((await c.from("coordination_seen_keys").select("key")).error).not.toBeNull();
        for (const t of ["coordination_plans", "coordination_events", "coordination_seen_keys"]) {
          expect((await c.from(t).insert({ plan_id: ex.plan.id, id: randomUUID(), owner_id: x.id, plan: {}, seq: 999, at: new Date().toISOString(), type: "t", actor: "user", outcome: "applied", key: "z" })).error).not.toBeNull();
          expect((await c.from(t).update({ rev: 99, actor: "user", key: "z" }).eq(t === "coordination_plans" ? "id" : "plan_id", ex.plan.id)).error).not.toBeNull();
          expect((await c.from(t).delete().eq(t === "coordination_plans" ? "id" : "plan_id", ex.plan.id)).error).not.toBeNull();
        }
        expect((await c.rpc("coordination_commit", { p_id: ex.plan.id, p_expected_rev: 1, p_plan: ex.plan, p_events: [], p_keys: [] })).error).not.toBeNull();
        expect((await c.rpc("coordination_create", { p_id: randomUUID(), p_owner: x.id, p_plan: ex.plan, p_events: [], p_keys: [] })).error).not.toBeNull();
        expect((await c.rpc("coordination_append", { p_id: ex.plan.id, p_events: [ev(999)], p_keys: ["z"] })).error).not.toBeNull();
      }
      expect((await anon.from("coordination_plans").select("id")).error).not.toBeNull();
      expect((await anon.from("coordination_events").select("seq")).error).not.toBeNull();

      const after = await rows(ex.plan.id);
      expect(after.plan!.rev).toBe(1);
      expect(after.events).toHaveLength(ex.log.length);
      expect(after.keys).not.toContain("z");

      // Deleting the (anonymous) owner removes the plan, its events and its seen keys.
      expect((await adminClient().auth.admin.deleteUser(x.id)).error).toBeNull();
      expect(await rows(ex.plan.id)).toEqual({ plan: null, events: [], keys: [] });
      expect((await rows(ey.plan.id)).plan).not.toBeNull();
    });
  });
});
