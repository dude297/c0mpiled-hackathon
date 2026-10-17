import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activity } from "@/domain/activities";
import { createCoordinator, currentActions } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import { createMemoryStore, type StoredPlan } from "@/domain/coordination/store";
import type { CoordinationEvent, Profile } from "@/lib/schema";
import { adminClient } from "./server";
import { createSupabaseStore } from "./store";

// Integration tests against a real Supabase (local stack). Skipped unless SUPABASE_URL + SUPABASE_SECRET_KEY are set.
// RLS checks additionally need NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (anon/publishable key).
const URL_ = process.env.SUPABASE_URL;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const live = !!(URL_ && process.env.SUPABASE_SECRET_KEY);

const WORKSHOP: Activity = { id: "workshop", name: "Saturday Craft Workshop", tags: ["crafts"], day: "Sat", time: "afternoon", costPerWeek: 5, travelMin: { bus: 50, family: 15, paratransit: 25 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false };
const MAYA: Profile = { name: "Maya", interests: ["crafts"], mobility: "walker", transport: ["bus", "family", "paratransit"], maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true };
const CONTACTS = [{ id: "dan", name: "Dan", relation: "son", canDrive: true }];

// A real plan + log produced by the engine (memory store), so fixtures match the live contract.
async function realEntry(): Promise<Omit<StoredPlan, "rev" | "ownerId">> {
  const mem = createMemoryStore();
  const c = createCoordinator({ provider: createMockProvider(), store: mem, activities: [WORKSHOP], newId: randomUUID });
  const r = await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
  const s = (await mem.load(r.plan.id))!;
  return { plan: s.plan, log: s.log, seenKeys: s.seenKeys };
}
const ev = (seq: number, extra: Partial<CoordinationEvent> = {}): CoordinationEvent => ({ seq, at: new Date().toISOString(), type: "test.event", actor: "demo", outcome: "applied", payload: { n: seq }, ...extra });

describe.skipIf(!live)("createSupabaseStore (live)", () => {
  const store = live ? createSupabaseStore() : undefined!;
  const users: string[] = [];
  let owner = "";
  const newUser = async () => {
    const { data, error } = await adminClient().auth.admin.createUser({ email: `store-${randomUUID()}@test.local`, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    return data.user.id;
  };
  const fresh = async () => {
    const e = await realEntry();
    await store.create({ ...e, ownerId: owner });
    return e;
  };

  beforeAll(async () => {
    owner = await newUser();
  });
  afterAll(async () => {
    for (const u of users) await adminClient().auth.admin.deleteUser(u); // cascades to plans/events/keys
  });

  it("create → load round-trips exactly", async () => {
    const e = await realEntry();
    e.seenKeys.add("k1");
    e.log.push(ev(e.log.length + 1, { reason: "why", idempotencyKey: "idem-1" }));
    await store.create({ ...e, ownerId: owner });
    const s = (await store.load(e.plan.id))!;
    expect(s).toStrictEqual({ plan: e.plan, log: e.log, seenKeys: e.seenKeys, rev: 1, ownerId: owner });
    await expect(store.create({ ...e, ownerId: owner })).rejects.toThrow(); // duplicate id
  });

  it("rejects create without owner", async () => {
    await expect(store.create({ ...(await realEntry()), ownerId: null })).rejects.toThrow(/ownerId/);
  });

  it("commit with right rev applies, bumps rev, appends events and keys", async () => {
    const e = await fresh();
    const plan = { ...e.plan, state: "CANCELLED" as const };
    const n = e.log.length;
    expect(await store.commit(e.plan.id, 1, plan, [ev(n + 1), ev(n + 2)], ["a", "b", "a"])).toBe(true);
    const s = (await store.load(e.plan.id))!;
    expect(s.rev).toBe(2);
    expect(s.plan).toEqual(plan);
    expect(s.log.map((x) => x.seq)).toEqual([...e.log.map((x) => x.seq), n + 1, n + 2]);
    expect([...s.seenKeys].sort()).toEqual([...e.seenKeys, "a", "b"].sort());
  });

  it("stale rev returns false and changes nothing", async () => {
    const e = await fresh();
    const before = await store.load(e.plan.id);
    expect(await store.commit(e.plan.id, 7, { ...e.plan, state: "CANCELLED" }, [ev(e.log.length + 1)], ["x"])).toBe(false);
    expect(await store.load(e.plan.id)).toEqual(before);
  });

  it("two concurrent commits with the same rev: exactly one wins", async () => {
    const e = await fresh();
    const n = e.log.length;
    const rs = await Promise.all([1, 2, 3, 4].map((i) => store.commit(e.plan.id, 1, e.plan, [ev(n + 1, { type: `w${i}` })], [`k${i}`])));
    expect(rs.filter(Boolean)).toHaveLength(1);
    const s = (await store.load(e.plan.id))!;
    expect(s.rev).toBe(2);
    expect(s.log).toHaveLength(n + 1);
  });

  it("duplicate seq fails the whole commit without partial writes", async () => {
    const e = await fresh();
    const before = await store.load(e.plan.id);
    const n = e.log.length;
    await expect(store.commit(e.plan.id, 1, { ...e.plan, state: "CANCELLED" }, [ev(n + 1), ev(n + 1)], ["dup"])).rejects.toThrow(/coordination_commit/);
    await expect(store.commit(e.plan.id, 1, e.plan, [ev(1)], ["dup"])).rejects.toThrow(); // seq 1 already stored
    expect(await store.load(e.plan.id)).toEqual(before);
  });

  it("unknown / non-uuid ids load as null; commit on unknown is false", async () => {
    expect(await store.load(randomUUID())).toBeNull();
    expect(await store.load("missing")).toBeNull();
    expect(await store.load("'; drop table x; --")).toBeNull();
    const e = await realEntry();
    expect(await store.commit(e.plan.id, 1, e.plan, [], [])).toBe(false);
  });

  it("corrupt stored plan or event makes load throw", async () => {
    const e = await fresh();
    const { error } = await adminClient().from("coordination_plans").update({ plan: { id: e.plan.id, bogus: true } }).eq("id", e.plan.id);
    expect(error).toBeNull();
    await expect(store.load(e.plan.id)).rejects.toThrow();
    const e2 = await fresh();
    await adminClient().from("coordination_events").update({ actor: "hacker" }).eq("plan_id", e2.plan.id).eq("seq", 1);
    await expect(store.load(e2.plan.id)).rejects.toThrow();
  });

  it("drives the real coordinator end to end", async () => {
    const c = createCoordinator({ provider: createMockProvider(), store, activities: [WORKSHOP], newId: randomUUID });
    const r = await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS }, owner);
    const a = currentActions(r.plan).find((x) => x.status === "proposed");
    if (a) await c.command(r.plan.id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: new Date(Date.now() + 3600_000).toISOString() }, owner);
    const s = (await store.load(r.plan.id))!;
    expect(s.ownerId).toBe(owner);
    expect(s.rev).toBe(a ? 2 : 1);
    expect(s.log.map((x) => x.seq)).toEqual(s.log.map((_, i) => i + 1));
  });

  describe.skipIf(!PUB)("RLS (publishable key client)", () => {
    const asUser = async () => {
      const c = createClient(URL_!, PUB!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await c.auth.signInAnonymously();
      if (error) throw error;
      users.push(data.user!.id);
      return { c, id: data.user!.id };
    };

    it("owner reads own plan/events only; no writes, no RPCs, no seen keys", async () => {
      const x = await asUser();
      const y = await asUser();
      const ex = await realEntry();
      const ey = await realEntry();
      await store.create({ ...ex, ownerId: x.id });
      await store.create({ ...ey, ownerId: y.id });

      const own = await x.c.from("coordination_plans").select("id").eq("id", ex.plan.id);
      expect(own.data).toEqual([{ id: ex.plan.id }]);
      expect((await x.c.from("coordination_events").select("seq").eq("plan_id", ex.plan.id)).data).toHaveLength(ex.log.length);
      expect((await x.c.from("coordination_plans").select("id").eq("id", ey.plan.id)).data).toEqual([]);
      expect((await x.c.from("coordination_events").select("seq").eq("plan_id", ey.plan.id)).data).toEqual([]);
      expect((await x.c.from("coordination_seen_keys").select("key")).error).not.toBeNull();

      expect((await x.c.from("coordination_plans").insert({ id: randomUUID(), owner_id: x.id, plan: {} })).error).not.toBeNull();
      expect((await x.c.from("coordination_plans").update({ rev: 99 }).eq("id", ex.plan.id)).error).not.toBeNull();
      expect((await x.c.from("coordination_plans").delete().eq("id", ex.plan.id)).error).not.toBeNull();
      expect((await x.c.from("coordination_events").insert({ plan_id: ex.plan.id, seq: 999, at: new Date().toISOString(), type: "t", actor: "user", outcome: "applied" })).error).not.toBeNull();
      expect((await x.c.rpc("coordination_commit", { p_id: ex.plan.id, p_expected_rev: 1, p_plan: ex.plan, p_events: [], p_keys: [] })).error).not.toBeNull();
      expect((await x.c.rpc("coordination_create", { p_id: randomUUID(), p_owner: x.id, p_plan: ex.plan, p_events: [], p_keys: [] })).error).not.toBeNull();
      expect((await x.c.rpc("coordination_append", { p_id: ex.plan.id, p_events: [], p_keys: ["z"] })).error).not.toBeNull();

      const anon = createClient(URL_!, PUB!, { auth: { persistSession: false } });
      expect((await anon.from("coordination_plans").select("id")).error).not.toBeNull();
      expect((await store.load(ex.plan.id))!.rev).toBe(1); // nothing changed
    });
  });
});
