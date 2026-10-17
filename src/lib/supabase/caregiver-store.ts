import { CaregiverError } from "@/domain/caregiver/access";
import { Ack, CheckIn, Grant, Person, PlanLink, ProfileProposal, ProfileVersion } from "@/domain/caregiver/contract";
import type { CaregiverStore } from "@/domain/caregiver/store";
import { adminClient } from "./server";

// Supabase-backed CaregiverStore (supabase/migrations/20261017030000_caregiver.sql + 20261017040000_person_profiles.sql). Server-only (secret key).
// Invariants (person+grant together, last manager, check-in idempotency) live in SQL RPCs; every row read is
// Zod-validated against the contract and throws on corrupt data.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const iso = (t: string) => new Date(t).toISOString(); // timestamptz comes back as "+00:00"
const uuidOr400 = (id: string, what: string) => {
  if (!UUID.test(id)) throw new CaregiverError(400, `${what} must be a signed-in user's id`);
  return id;
};

type Row = Record<string, unknown>;
const toPerson = (r: Row) =>
  Person.parse({
    personId: r.person_id, profile: r.profile, timezone: r.timezone,
    ...(r.self_user_id != null && { selfUserId: r.self_user_id }),
    checkInSchedule: r.check_in_schedule ?? null, createdAt: iso(r.created_at as string), createdBy: r.created_by,
    profileVersion: r.profile_version,
  });
const toGrant = (r: Row) =>
  Grant.parse({
    personId: r.person_id, userId: r.user_id, scopes: r.scopes, grantedBy: r.granted_by, grantedAt: iso(r.granted_at as string),
    ...(r.revoked_at != null && { revokedAt: iso(r.revoked_at as string) }),
  });
const toLink = (r: Row) =>
  PlanLink.parse({
    personId: r.person_id, planId: r.plan_id, linkedAt: iso(r.linked_at as string), linkedBy: r.linked_by,
    ...(r.profile_version != null && { profileVersion: r.profile_version }),
  });
const toVersion = (r: Row) =>
  ProfileVersion.parse({
    personId: r.person_id, version: r.version, profile: r.profile, createdAt: iso(r.created_at as string), createdBy: r.created_by, source: r.source,
    ...(r.proposal_id != null && { proposalId: r.proposal_id }),
  });
const toProposal = (r: Row) =>
  ProfileProposal.parse({
    proposalId: r.proposal_id, personId: r.person_id, baseVersion: r.base_version, changes: r.changes, evidence: r.evidence, source: r.source,
    proposedBy: r.proposed_by, status: r.status, createdAt: iso(r.created_at as string),
    ...(r.plan_id != null && { planId: r.plan_id }),
    ...(r.decided_at != null && { decidedAt: iso(r.decided_at as string) }),
    ...(r.decided_by != null && { decidedBy: r.decided_by }),
  });
const toCheckIn = (r: Row) =>
  CheckIn.parse({
    checkInId: r.check_in_id, personId: r.person_id, kind: r.kind,
    ...(r.plan_id != null && { planId: r.plan_id }),
    ...(r.note != null && { note: r.note }),
    reporterUserId: r.reporter_user_id, reporterRole: r.reporter_role, source: r.source, at: iso(r.at as string), idempotencyKey: r.idempotency_key,
  });

export function createSupabaseCaregiverStore(): CaregiverStore {
  const db = () => adminClient();
  const must = <T>(r: { data: T; error: { message: string; code?: string } | null }, what: string): T => {
    if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
    return r.data;
  };
  const rows = <T>(r: { data: T[] | null; error: { message: string } | null }, what: string) => must(r, what) ?? [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const r = await db().rpc(fn, args);
    if (r.error?.code === "23503") throw new CaregiverError(400, "Unknown user id"); // e.g. selfUserId not a real user
    return must(r, fn) as unknown;
  };

  return {
    kind: "durable",
    async createPerson(p, g) {
      if (g.personId !== p.personId || g.userId !== p.createdBy) throw new Error("createPerson: creator grant must match the person");
      await rpc("caregiver_create_person", {
        p_person_id: p.personId, p_profile: p.profile, p_timezone: p.timezone,
        p_self_user_id: p.selfUserId ? uuidOr400(p.selfUserId, "selfUserId") : null,
        p_check_in_schedule: p.checkInSchedule, p_created_at: p.createdAt, p_created_by: uuidOr400(p.createdBy, "createdBy"), p_scopes: g.scopes,
      });
    },
    async getPerson(id) {
      if (!UUID.test(id)) return null;
      const r = must(await db().from("caregiver_people").select("*").eq("person_id", id).maybeSingle(), "getPerson");
      return r ? toPerson(r) : null;
    },
    async deletePerson(id) {
      if (!UUID.test(id)) return;
      must(await db().from("caregiver_people").delete().eq("person_id", id), "deletePerson"); // FKs cascade
    },
    async getGrant(personId, userId) {
      if (!UUID.test(personId) || !UUID.test(userId)) return null;
      const r = must(await db().from("caregiver_grants").select("*").eq("person_id", personId).eq("user_id", userId).is("revoked_at", null).maybeSingle(), "getGrant");
      return r ? toGrant(r) : null;
    },
    async listGrants(personId) {
      if (!UUID.test(personId)) return [];
      return rows(await db().from("caregiver_grants").select("*").eq("person_id", personId).is("revoked_at", null).order("granted_at"), "listGrants").map(toGrant);
    },
    async listGrantsForUser(userId) {
      if (!UUID.test(userId)) return [];
      return rows(await db().from("caregiver_grants").select("*").eq("user_id", userId).is("revoked_at", null).order("granted_at"), "listGrantsForUser").map(toGrant);
    },
    async upsertGrant(g) {
      const res = await rpc("caregiver_upsert_grant", {
        p_person: g.personId, p_user: uuidOr400(g.userId, "userId"), p_scopes: g.scopes, p_granted_by: g.grantedBy, p_granted_at: g.grantedAt,
      });
      if (res === "last_manager") return "last_manager";
      if (res !== "ok") throw new CaregiverError(404, "Person not found");
      return Grant.parse({ ...g, revokedAt: undefined });
    },
    async revokeGrant(personId, userId, at) {
      if (!UUID.test(personId) || !UUID.test(userId)) return "not_found";
      return (await rpc("caregiver_revoke_grant", { p_person: personId, p_user: userId, p_at: at })) as "revoked" | "not_found" | "last_manager";
    },
    async linkPlan(l) {
      const r = await db().from("caregiver_plan_links").insert({ plan_id: l.planId, person_id: l.personId, linked_at: l.linkedAt, linked_by: l.linkedBy, profile_version: l.profileVersion ?? null });
      if (r.error?.code === "23505") return "already_linked";
      must(r, "linkPlan");
      return "ok";
    },
    async getPlanLink(planId) {
      if (!UUID.test(planId)) return null;
      const r = must(await db().from("caregiver_plan_links").select("*").eq("plan_id", planId).maybeSingle(), "getPlanLink");
      return r ? toLink(r) : null;
    },
    async listPlanLinks(personId) {
      if (!UUID.test(personId)) return [];
      return rows(await db().from("caregiver_plan_links").select("*").eq("person_id", personId).order("linked_at"), "listPlanLinks").map(toLink);
    },
    async recordCheckin(c) {
      const res = (await rpc("caregiver_record_checkin", { p: CheckIn.parse(c) })) as { row: Row; duplicate: boolean; conflict: boolean };
      return { checkIn: toCheckIn(res.row), duplicate: res.duplicate, ...(res.conflict && { conflict: true as const }) };
    },
    async getCheckIn(id) {
      if (!UUID.test(id)) return null;
      const r = must(await db().from("caregiver_checkins").select("*").eq("check_in_id", id).maybeSingle(), "getCheckIn");
      return r ? toCheckIn(r) : null;
    },
    async listCheckins(personId) {
      if (!UUID.test(personId)) return [];
      return rows(
        await db().from("caregiver_checkins").select("*").eq("person_id", personId).order("at").order("created_at"),
        "listCheckins",
      ).map(toCheckIn);
    },
    async ack(a) {
      const v = Ack.parse(a);
      must(
        await db().from("caregiver_acks").upsert({ person_id: v.personId, user_id: v.userId, item_id: v.itemId, at: v.at }, { onConflict: "person_id,user_id,item_id", ignoreDuplicates: true }),
        "ack",
      );
    },
    async listAckedItemIds(personId, userId) {
      if (!UUID.test(personId) || !UUID.test(userId)) return [];
      return rows(await db().from("caregiver_acks").select("item_id").eq("person_id", personId).eq("user_id", userId), "listAckedItemIds").map((r) => r.item_id as string);
    },

    // ─── Person profiles: CAS + stale-marking happen inside the RPCs under the person row lock ───
    async createProposal(p) {
      const res = await rpc("caregiver_create_proposal", { p: ProfileProposal.parse(p) });
      return res === "ok" ? ProfileProposal.parse(p) : (res as "not_found" | "stale");
    },
    async getProposal(id) {
      if (!UUID.test(id)) return null;
      const r = must(await db().from("profile_proposals").select("*").eq("proposal_id", id).maybeSingle(), "getProposal");
      return r ? toProposal(r) : null;
    },
    async listProposals(personId) {
      if (!UUID.test(personId)) return [];
      return rows(await db().from("profile_proposals").select("*").eq("person_id", personId).order("created_at").order("proposal_id"), "listProposals").map(toProposal);
    },
    async decideProposal({ personId, proposalId, decision, expectedVersion, decidedBy, at }) {
      if (!UUID.test(personId) || !UUID.test(proposalId)) return "not_found";
      const res = (await rpc("caregiver_decide_proposal", {
        p_person: personId, p_proposal: proposalId, p_decision: decision, p_expected: expectedVersion ?? null, p_by: decidedBy, p_at: at,
      })) as { result: string; proposal?: Row; version?: Row };
      if (res.result !== "ok") return res.result as "not_found" | "not_pending" | "stale" | "version_conflict";
      return { proposal: toProposal(res.proposal!), ...(res.version && { version: toVersion(res.version) }) };
    },
    async appendVersion({ personId, expectedVersion, profile, source, createdBy, at, proposalId }) {
      if (!UUID.test(personId)) return "not_found";
      const res = (await rpc("caregiver_append_version", {
        p_person: personId, p_expected: expectedVersion, p_profile: profile, p_source: source, p_by: createdBy, p_at: at, p_proposal: proposalId ?? null,
      })) as { result: string; version?: Row };
      return res.result === "ok" ? toVersion(res.version!) : (res.result as "not_found" | "stale");
    },
    async listVersions(personId) {
      if (!UUID.test(personId)) return [];
      return rows(await db().from("person_profile_versions").select("*").eq("person_id", personId).order("version"), "listVersions").map(toVersion);
    },
  };
}
