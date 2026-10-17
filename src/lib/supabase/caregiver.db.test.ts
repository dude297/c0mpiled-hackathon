import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CheckIn, Grant, Person, ProfileProposal } from "@/domain/caregiver/contract";
import { MAYA_PROFILE } from "@/domain/caregiver/fixtures";
import { adminClient } from "./server";
import { createSupabaseCaregiverStore } from "./caregiver-store";

// Caregiver persistence + RLS against the REAL local Supabase DB. Skipped unless SUPABASE_URL, SUPABASE_SECRET_KEY
// and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set (see `supabase status -o env`).
const URL_ = process.env.SUPABASE_URL;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const live = !!(URL_ && process.env.SUPABASE_SECRET_KEY && PUB);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const TABLES = ["caregiver_people", "caregiver_grants", "caregiver_plan_links", "caregiver_checkins", "caregiver_acks"] as const;
const ALL: Grant["scopes"] = ["view", "checkin", "manage"];
const now = () => new Date().toISOString();

describe.skipIf(!live)("caregiver persistence (real local DB)", () => {
  const store = live ? createSupabaseCaregiverStore() : undefined!;
  const users: string[] = [];
  const people: string[] = [];
  const plans: string[] = [];

  const newUser = async () => {
    const email = `cg-${randomUUID()}@test.local`;
    const password = `pw-${randomUUID()}`;
    const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
    return { id: data.user.id, email, password };
  };
  const signedIn = async (u: { email: string; password: string }) => {
    const c = createClient(URL_!, PUB!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await c.auth.signInWithPassword(u);
    if (error) throw error;
    return c;
  };
  const newPerson = async (creator: string, extra: Partial<Person> = {}) => {
    const p: Person = { personId: randomUUID(), profile: MAYA_PROFILE, timezone: "America/Los_Angeles", checkInSchedule: { everyDays: 3 }, createdAt: now(), createdBy: creator, ...extra };
    await store.createPerson(p, { personId: p.personId, userId: creator, scopes: ALL, grantedBy: creator, grantedAt: p.createdAt });
    people.push(p.personId);
    return p;
  };
  const newPlan = async (owner: string) => {
    const id = randomUUID();
    const { error } = await adminClient().from("coordination_plans").insert({ id, owner_id: owner, plan: {} });
    if (error) throw error;
    plans.push(id);
    return id;
  };
  const grant = (personId: string, userId: string, scopes: Grant["scopes"], by: string): Grant => ({ personId, userId, scopes, grantedBy: by, grantedAt: now() });
  const checkIn = (personId: string, reporter: string, key: string, extra: Partial<CheckIn> = {}): CheckIn => ({
    checkInId: randomUUID(), personId, kind: "ok", reporterUserId: reporter, reporterRole: "caregiver", source: "app", at: now(), idempotencyKey: key, ...extra,
  });
  const count = async (c: SupabaseClient, table: string, personId: string) => {
    const cols = table === "caregiver_checkins" ? "check_in_id" : "person_id";
    const { data, error } = await c.from(table).select(cols).eq("person_id", personId);
    if (error) throw error;
    return data.length;
  };

  afterAll(async () => {
    if (!live) return;
    const db = adminClient();
    if (people.length) await db.from("caregiver_people").delete().in("person_id", people);
    if (plans.length) await db.from("coordination_plans").delete().in("id", plans);
    for (const id of users) await db.auth.admin.deleteUser(id);
  });

  describe("RLS: grant-based isolation via publishable-key sessions", () => {
    let manager: Awaited<ReturnType<typeof newUser>>, viewer: typeof manager, revoked: typeof manager, stranger: typeof manager, self: typeof manager;
    let p: Person;
    beforeAll(async () => {
      [manager, viewer, revoked, stranger, self] = await Promise.all([newUser(), newUser(), newUser(), newUser(), newUser()]);
      p = await newPerson(manager.id, { selfUserId: self.id });
      await store.upsertGrant(grant(p.personId, viewer.id, ["view"], manager.id));
      await store.upsertGrant(grant(p.personId, revoked.id, ["view"], manager.id));
      expect(await store.revokeGrant(p.personId, revoked.id, now())).toBe("revoked");
      await store.linkPlan({ personId: p.personId, planId: await newPlan(manager.id), linkedAt: now(), linkedBy: manager.id });
      await store.recordCheckin(checkIn(p.personId, manager.id, "k1", { note: "private note" }));
      await store.ack({ personId: p.personId, userId: manager.id, itemId: "item-1", at: now() });
    });

    it("active grantee reads person, grants, links, check-ins (without notes)", async () => {
      const c = await signedIn(viewer);
      for (const t of ["caregiver_people", "caregiver_grants", "caregiver_plan_links", "caregiver_checkins"]) expect(await count(c, t, p.personId)).toBeGreaterThan(0);
      expect((await c.from("caregiver_checkins").select("note").eq("person_id", p.personId)).error).not.toBeNull(); // column not granted
      expect(await count(c, "caregiver_acks", p.personId)).toBe(0); // only own acks
      expect(await count(await signedIn(manager), "caregiver_acks", p.personId)).toBe(1);
    });

    it("revoked grantee and stranger read nothing; self reads only their person row", async () => {
      for (const u of [revoked, stranger]) {
        const c = await signedIn(u);
        for (const t of TABLES) expect(await count(c, t, p.personId)).toBe(0);
      }
      const s = await signedIn(self);
      expect(await count(s, "caregiver_people", p.personId)).toBe(1);
      expect(await count(s, "caregiver_grants", p.personId)).toBe(0);
      const anon = createClient(URL_!, PUB!, { auth: { persistSession: false } });
      for (const t of TABLES) expect((await anon.from(t).select("person_id").eq("person_id", p.personId)).data ?? []).toEqual([]);
    });

    it("clients cannot write and cannot execute the write RPCs", async () => {
      const c = await signedIn(manager);
      expect((await c.from("caregiver_grants").insert({ person_id: p.personId, user_id: stranger.id, scopes: ["view"], granted_by: manager.id, granted_at: now() })).error).not.toBeNull();
      expect((await c.from("caregiver_grants").update({ scopes: ["view"] }).eq("person_id", p.personId).select()).data ?? []).toEqual([]);
      expect((await c.from("caregiver_people").delete().eq("person_id", p.personId).select()).data ?? []).toEqual([]);
      expect((await c.from("caregiver_acks").insert({ person_id: p.personId, user_id: manager.id, item_id: "x", at: now() })).error).not.toBeNull();
      const rpcs: [string, Record<string, unknown>][] = [
        ["caregiver_upsert_grant", { p_person: p.personId, p_user: stranger.id, p_scopes: ALL, p_granted_by: manager.id, p_granted_at: now() }],
        ["caregiver_revoke_grant", { p_person: p.personId, p_user: viewer.id, p_at: now() }],
        ["caregiver_record_checkin", { p: checkIn(p.personId, manager.id, "rpc") }],
        ["caregiver_create_person", { p_person_id: randomUUID(), p_profile: {}, p_timezone: "UTC", p_self_user_id: null, p_check_in_schedule: null, p_created_at: now(), p_created_by: manager.id, p_scopes: ALL }],
      ];
      for (const [fn, args] of rpcs) expect((await c.rpc(fn, args)).error, fn).not.toBeNull();
      expect(await store.getGrant(p.personId, stranger.id)).toBeNull();
      expect((await store.listGrants(p.personId)).map((g) => g.userId).sort()).toEqual([manager.id, viewer.id].sort());
    });
  });

  it("last-manager invariant: two concurrent revokes of the only two managers → exactly one succeeds", async () => {
    const [a, b] = await Promise.all([newUser(), newUser()]);
    const p = await newPerson(a.id);
    await store.upsertGrant(grant(p.personId, b.id, ALL, a.id));
    const res = await Promise.all([store.revokeGrant(p.personId, a.id, now()), store.revokeGrant(p.personId, b.id, now())]);
    expect(res.sort()).toEqual(["last_manager", "revoked"]);
    expect((await store.listGrants(p.personId)).filter((g) => g.scopes.includes("manage"))).toHaveLength(1);
    // downgrading the last manager is refused too; re-granting a revoked user re-activates
    const last = (await store.listGrants(p.personId))[0];
    expect(await store.upsertGrant(grant(p.personId, last.userId, ["view"], last.userId))).toBe("last_manager");
    const other = last.userId === a.id ? b.id : a.id;
    expect(await store.upsertGrant(grant(p.personId, other, ["view", "manage"], last.userId))).toMatchObject({ userId: other });
    expect(await store.getGrant(p.personId, other)).toMatchObject({ scopes: ["view", "manage"] });
  });

  it("check-in idempotency: concurrent duplicates store one row; same key + different body → conflict", async () => {
    const u = await newUser();
    const p = await newPerson(u.id);
    const planId = await newPlan(u.id);
    await store.linkPlan({ personId: p.personId, planId, linkedAt: now(), linkedBy: u.id });
    expect(await store.linkPlan({ personId: p.personId, planId, linkedAt: now(), linkedBy: u.id })).toBe("already_linked");
    const body = { kind: "call" as const, planId, note: "call me" };
    const res = await Promise.all(Array.from({ length: 5 }, () => store.recordCheckin(checkIn(p.personId, u.id, "dup", body))));
    expect(res.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(res.map((r) => r.checkIn.checkInId)).size).toBe(1);
    expect(res.every((r) => !r.conflict)).toBe(true);
    const conflict = await store.recordCheckin(checkIn(p.personId, u.id, "dup", { ...body, kind: "help" }));
    expect(conflict).toMatchObject({ duplicate: true, conflict: true, checkIn: { kind: "call" } });
    const list = await store.listCheckins(p.personId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ...body, reporterUserId: u.id, idempotencyKey: "dup" });
    expect(await store.getCheckIn(list[0].checkInId)).toEqual(list[0]);
  });

  it("survives a restart (fresh module graph reads the same data); deletePerson cascades", async () => {
    const u = await newUser();
    const p = await newPerson(u.id);
    await store.recordCheckin(checkIn(p.personId, u.id, "r"));
    await store.ack({ personId: p.personId, userId: u.id, itemId: "i", at: now() });
    await store.ack({ personId: p.personId, userId: u.id, itemId: "i", at: now() }); // idempotent
    vi.resetModules();
    const fresh = (await import("./caregiver-store")).createSupabaseCaregiverStore();
    expect(fresh.kind).toBe("durable");
    expect(await fresh.getPerson(p.personId)).toEqual({ ...p, profileVersion: 1 });
    expect(await fresh.listGrantsForUser(u.id)).toEqual([expect.objectContaining({ personId: p.personId, scopes: ALL })]);
    expect(await fresh.listCheckins(p.personId)).toHaveLength(1);
    expect(await fresh.listAckedItemIds(p.personId, u.id)).toEqual(["i"]);
    await fresh.deletePerson(p.personId);
    expect(await fresh.getPerson(p.personId)).toBeNull();
    expect(await fresh.listGrantsForUser(u.id)).toEqual([]);
    expect(await fresh.listCheckins(p.personId)).toEqual([]);
  });

  it("non-uuid ids read as absent; granting to one is a 400", async () => {
    expect(await store.getPerson("not-a-uuid")).toBeNull();
    expect(await store.getGrant(randomUUID(), "cg-dana")).toBeNull();
    await expect(store.upsertGrant(grant(randomUUID(), "cg-dana", ["view"], "cg-dana"))).rejects.toMatchObject({ status: 400 });
  });

  describe("person profiles", () => {
    const proposal = (personId: string, by: string, baseVersion: number, changes: ProfileProposal["changes"]): ProfileProposal => ({
      proposalId: randomUUID(), personId, baseVersion, changes, evidence: "said so", source: "caregiver", proposedBy: by, status: "proposed", createdAt: now(),
    });

    it("createPerson records v1; concurrent confirms + append on the same base → exactly one wins, the rest stale", async () => {
      const u = await newUser();
      const p = await newPerson(u.id);
      expect(await store.listVersions(p.personId)).toEqual([expect.objectContaining({ version: 1, source: "create", profile: MAYA_PROFILE })]);
      const props = [3, 4, 5].map((n) => proposal(p.personId, u.id, 1, { budgetPerWeek: n }));
      for (const pr of props) expect(await store.createProposal(pr)).toMatchObject({ proposalId: pr.proposalId });
      const res = await Promise.all([
        ...props.map((pr) => store.decideProposal({ personId: p.personId, proposalId: pr.proposalId, decision: "confirmed", expectedVersion: 1, decidedBy: u.id, at: now() })),
        store.appendVersion({ personId: p.personId, expectedVersion: 1, profile: { ...MAYA_PROFILE, budgetPerWeek: 99 }, source: "revert", createdBy: u.id, at: now() }),
      ]);
      expect(res.filter((r) => typeof r === "object")).toHaveLength(1);
      expect(res.filter((r) => r === "stale")).toHaveLength(3);
      const versions = await store.listVersions(p.personId);
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      const person = await store.getPerson(p.personId);
      expect(person).toMatchObject({ profileVersion: 2, profile: versions[1].profile });
      const statuses = (await store.listProposals(p.personId)).map((x) => x.status).sort();
      expect(statuses.filter((s) => s === "proposed")).toEqual([]);
      expect(statuses.filter((s) => s === "confirmed").length).toBeLessThanOrEqual(1);
      expect(await store.createProposal(proposal(p.personId, u.id, 1, { budgetPerWeek: 1 }))).toBe("stale");
    });

    it("version_conflict keeps the proposal open; reject; not_pending; unique(person_id, version)", async () => {
      const u = await newUser();
      const p = await newPerson(u.id);
      const pr = proposal(p.personId, u.id, 1, { maxTravelMin: 45 });
      await store.createProposal(pr);
      expect(await store.decideProposal({ personId: p.personId, proposalId: pr.proposalId, decision: "confirmed", expectedVersion: 7, decidedBy: u.id, at: now() })).toBe("version_conflict");
      expect(await store.getProposal(pr.proposalId)).toMatchObject({ status: "proposed" });
      const ok = await store.decideProposal({ personId: p.personId, proposalId: pr.proposalId, decision: "confirmed", expectedVersion: 1, decidedBy: u.id, at: now() });
      expect(ok).toMatchObject({ proposal: { status: "confirmed", decidedBy: u.id }, version: { version: 2, proposalId: pr.proposalId, profile: { ...MAYA_PROFILE, maxTravelMin: 45 } } });
      expect(await store.decideProposal({ personId: p.personId, proposalId: pr.proposalId, decision: "rejected", decidedBy: u.id, at: now() })).toBe("not_pending");
      const pr2 = proposal(p.personId, u.id, 2, { noisy: true } as never);
      await expect(store.createProposal(pr2)).rejects.toThrow(); // unknown field rejected by the contract schema
      const pr3 = proposal(p.personId, u.id, 2, { hearingImpaired: true });
      await store.createProposal(pr3);
      expect(await store.decideProposal({ personId: p.personId, proposalId: pr3.proposalId, decision: "rejected", decidedBy: u.id, at: now() })).toMatchObject({ proposal: { status: "rejected" } });
      expect(await store.decideProposal({ personId: randomUUID(), proposalId: pr3.proposalId, decision: "rejected", decidedBy: u.id, at: now() })).toBe("not_found");
      const dup = await adminClient().from("person_profile_versions").insert({ person_id: p.personId, version: 2, profile: MAYA_PROFILE, source: "revert", created_by: u.id });
      expect(dup.error?.code).toBe("23505");
    });

    it("RLS: self and grantee read versions/proposals; stranger and revoked read nothing; no client writes or RPCs", async () => {
      const [mgr, viewer, self, stranger] = await Promise.all([newUser(), newUser(), newUser(), newUser()]);
      const p = await newPerson(mgr.id, { selfUserId: self.id });
      await store.upsertGrant(grant(p.personId, viewer.id, ["view"], mgr.id));
      await store.createProposal(proposal(p.personId, mgr.id, 1, { budgetPerWeek: 12 }));
      const read = async (c: SupabaseClient) => {
        const [v, pr] = await Promise.all([
          c.from("person_profile_versions").select("version").eq("person_id", p.personId),
          c.from("profile_proposals").select("proposal_id").eq("person_id", p.personId),
        ]);
        return [v.data?.length ?? 0, pr.data?.length ?? 0];
      };
      expect(await read(await signedIn(self))).toEqual([1, 1]);
      expect(await read(await signedIn(viewer))).toEqual([1, 1]);
      expect(await read(await signedIn(stranger))).toEqual([0, 0]);
      await store.revokeGrant(p.personId, viewer.id, now());
      expect(await read(await signedIn(viewer))).toEqual([0, 0]);
      const c = await signedIn(mgr);
      expect((await c.from("profile_proposals").update({ status: "confirmed" }).eq("person_id", p.personId).select()).data ?? []).toEqual([]);
      expect((await c.from("person_profile_versions").insert({ person_id: p.personId, version: 9, profile: {}, source: "revert", created_by: mgr.id })).error).not.toBeNull();
      for (const [fn, args] of [
        ["caregiver_append_version", { p_person: p.personId, p_expected: 1, p_profile: {}, p_source: "revert", p_by: mgr.id, p_at: now(), p_proposal: null }],
        ["caregiver_create_proposal", { p: proposal(p.personId, mgr.id, 1, { budgetPerWeek: 1 }) }],
        ["caregiver_decide_proposal", { p_person: p.personId, p_proposal: randomUUID(), p_decision: "rejected", p_expected: 1, p_by: mgr.id, p_at: now() }],
        ["caregiver_append_profile", { p_person: p.personId, p_profile: {}, p_source: "revert", p_by: mgr.id, p_at: now(), p_proposal: null }],
      ] as const) expect((await c.rpc(fn, args)).error, fn).not.toBeNull();
      expect((await store.listVersions(p.personId)).map((v) => v.version)).toEqual([1]);
    });
  });
});
