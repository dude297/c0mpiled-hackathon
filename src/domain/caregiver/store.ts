import type { Ack, CheckIn, Grant, Person, PlanLink, ProfileProposal, ProfileSource, ProfileVersion } from "./contract";

export type DecideProposalInput = {
  personId: string;
  proposalId: string;
  decision: "confirmed" | "rejected";
  /** Required to confirm; the caller's view of the current version. */
  expectedVersion?: number;
  decidedBy: string;
  at: string;
};
export type DecideProposalResult = { proposal: ProfileProposal; version?: ProfileVersion } | "not_found" | "not_pending" | "stale" | "version_conflict";
export type AppendVersionInput = { personId: string; expectedVersion: number; profile: Person["profile"]; source: ProfileSource; createdBy: string; at: string; proposalId?: string };

// Storage port. Every method is async and returns plain JSON data (no class instances or Maps cross it),
// so a durable (Supabase) adapter can drop in. Atomic single-call operations keep invariants inside the store;
// permission checks and derivation stay outside, in access.ts / attention.ts / history.ts.
export interface CaregiverStore {
  readonly kind: "memory" | "durable";
  /** Creates the person and the creator's grant together. */
  createPerson(person: Person, creatorGrant: Grant): Promise<void>;
  getPerson(personId: string): Promise<Person | null>;
  /** Removes a person and everything attached (used to re-seed demo fixtures). */
  deletePerson(personId: string): Promise<void>;
  /** Active grant only. */
  getGrant(personId: string, userId: string): Promise<Grant | null>;
  listGrants(personId: string): Promise<Grant[]>;
  listGrantsForUser(userId: string): Promise<Grant[]>;
  /** Replaces scopes. Refuses to leave the person with no active manager. */
  upsertGrant(grant: Grant): Promise<Grant | "last_manager">;
  revokeGrant(personId: string, userId: string, at: string): Promise<"revoked" | "not_found" | "last_manager">;
  /** A plan belongs to exactly one person. */
  linkPlan(link: PlanLink): Promise<"ok" | "already_linked">;
  getPlanLink(planId: string): Promise<PlanLink | null>;
  listPlanLinks(personId: string): Promise<PlanLink[]>;
  /** Idempotent on (personId, reporterUserId, idempotencyKey); same key with a different body → conflict. */
  recordCheckin(checkIn: CheckIn): Promise<{ checkIn: CheckIn; duplicate: boolean; conflict?: true }>;
  getCheckIn(checkInId: string): Promise<CheckIn | null>;
  /** Oldest first. */
  listCheckins(personId: string): Promise<CheckIn[]>;
  ack(ack: Ack): Promise<void>;
  listAckedItemIds(personId: string, userId: string): Promise<string[]>;

  // ─── Person profiles (PERSON_PROFILES.md). createPerson also records version 1 (source "create"). ───
  /** Atomic: refuses ("stale") unless proposal.baseVersion is the person's current version. Changes nothing on the profile. */
  createProposal(proposal: ProfileProposal): Promise<ProfileProposal | "not_found" | "stale">;
  getProposal(proposalId: string): Promise<ProfileProposal | null>;
  /** Oldest first. */
  listProposals(personId: string): Promise<ProfileProposal[]>;
  /**
   * Atomic. Only a "proposed" proposal can be decided. Confirm: expectedVersion must equal the current version
   * ("version_conflict" otherwise) and baseVersion must too (else it is marked stale → "stale"); then
   * profile = {...profile, ...changes}, version + 1 is appended, and other open proposals are marked stale.
   */
  decideProposal(input: DecideProposalInput): Promise<DecideProposalResult>;
  /** Atomic compare-and-append: refuses ("stale") unless expectedVersion is current. Marks open proposals stale. */
  appendVersion(input: AppendVersionInput): Promise<ProfileVersion | "not_found" | "stale">;
  /** Oldest first. */
  listVersions(personId: string): Promise<ProfileVersion[]>;
}

const sameCheckinBody = (a: CheckIn, b: CheckIn) =>
  a.kind === b.kind && a.planId === b.planId && (a.note ?? "") === (b.note ?? "") && a.source === b.source;

const isManager = (g: Grant) => !g.revokedAt && g.scopes.includes("manage");

export function createMemoryStore(): CaregiverStore {
  const people = new Map<string, Person>();
  const grants = new Map<string, Grant>(); // `${personId}|${userId}`
  const links = new Map<string, PlanLink>(); // planId
  const checkins: CheckIn[] = [];
  const acks = new Map<string, Ack>(); // `${personId}|${userId}|${itemId}`
  const versions: ProfileVersion[] = [];
  const proposals = new Map<string, ProfileProposal>(); // proposalId
  const clone = structuredClone;
  const gk = (p: string, u: string) => `${p}|${u}`;
  const otherManagers = (personId: string, userId: string) =>
    [...grants.values()].some((g) => g.personId === personId && g.userId !== userId && isManager(g));

  return {
    kind: "memory",
    async createPerson(person, creatorGrant) {
      people.set(person.personId, clone({ ...person, profileVersion: 1 }));
      versions.push(clone({ personId: person.personId, version: 1, profile: person.profile, createdAt: person.createdAt, createdBy: person.createdBy, source: "create" as const }));
      grants.set(gk(creatorGrant.personId, creatorGrant.userId), clone(creatorGrant));
    },
    async getPerson(id) {
      const p = people.get(id);
      return p ? clone(p) : null;
    },
    async deletePerson(id) {
      people.delete(id);
      for (const [k, g] of grants) if (g.personId === id) grants.delete(k);
      for (const [k, l] of links) if (l.personId === id) links.delete(k);
      for (let i = checkins.length - 1; i >= 0; i--) if (checkins[i].personId === id) checkins.splice(i, 1);
      for (const [k, a] of acks) if (a.personId === id) acks.delete(k);
      for (let i = versions.length - 1; i >= 0; i--) if (versions[i].personId === id) versions.splice(i, 1);
      for (const [k, p] of proposals) if (p.personId === id) proposals.delete(k);
    },
    async getGrant(personId, userId) {
      const g = grants.get(gk(personId, userId));
      return g && !g.revokedAt ? clone(g) : null;
    },
    async listGrants(personId) {
      return clone([...grants.values()].filter((g) => g.personId === personId && !g.revokedAt));
    },
    async listGrantsForUser(userId) {
      return clone([...grants.values()].filter((g) => g.userId === userId && !g.revokedAt));
    },
    async upsertGrant(grant) {
      const prev = grants.get(gk(grant.personId, grant.userId));
      if (prev && isManager(prev) && !grant.scopes.includes("manage") && !otherManagers(grant.personId, grant.userId)) return "last_manager";
      grants.set(gk(grant.personId, grant.userId), clone({ ...grant, revokedAt: undefined }));
      return clone(grant);
    },
    async revokeGrant(personId, userId, at) {
      const g = grants.get(gk(personId, userId));
      if (!g || g.revokedAt) return "not_found";
      if (isManager(g) && !otherManagers(personId, userId)) return "last_manager";
      g.revokedAt = at;
      return "revoked";
    },
    async linkPlan(link) {
      if (links.has(link.planId)) return "already_linked";
      links.set(link.planId, clone(link));
      return "ok";
    },
    async getPlanLink(planId) {
      const l = links.get(planId);
      return l ? clone(l) : null;
    },
    async listPlanLinks(personId) {
      return clone([...links.values()].filter((l) => l.personId === personId));
    },
    async recordCheckin(c) {
      const prior = checkins.find((x) => x.personId === c.personId && x.reporterUserId === c.reporterUserId && x.idempotencyKey === c.idempotencyKey);
      if (prior) return sameCheckinBody(prior, c) ? { checkIn: clone(prior), duplicate: true } : { checkIn: clone(prior), duplicate: true, conflict: true };
      checkins.push(clone(c));
      return { checkIn: clone(c), duplicate: false };
    },
    async getCheckIn(id) {
      const c = checkins.find((x) => x.checkInId === id);
      return c ? clone(c) : null;
    },
    async listCheckins(personId) {
      return clone(checkins.filter((c) => c.personId === personId).sort((a, b) => a.at.localeCompare(b.at)));
    },
    async ack(a) {
      const k = `${a.personId}|${a.userId}|${a.itemId}`;
      if (!acks.has(k)) acks.set(k, clone(a));
    },
    async listAckedItemIds(personId, userId) {
      return [...acks.values()].filter((a) => a.personId === personId && a.userId === userId).map((a) => a.itemId);
    },
    async createProposal(p) {
      const person = people.get(p.personId);
      if (!person) return "not_found";
      if (p.baseVersion !== current(person)) return "stale";
      proposals.set(p.proposalId, clone(p));
      return clone(p);
    },
    async getProposal(id) {
      const p = proposals.get(id);
      return p ? clone(p) : null;
    },
    async listProposals(personId) {
      return clone([...proposals.values()].filter((p) => p.personId === personId));
    },
    async decideProposal({ personId, proposalId, decision, expectedVersion, decidedBy, at }) {
      const p = proposals.get(proposalId);
      const person = people.get(personId);
      if (!p || !person || p.personId !== personId) return "not_found";
      if (p.status === "stale") return "stale";
      if (p.status !== "proposed") return "not_pending";
      if (decision === "rejected") {
        Object.assign(p, { status: "rejected", decidedAt: at, decidedBy });
        return { proposal: clone(p) };
      }
      if (p.baseVersion !== current(person)) {
        Object.assign(p, { status: "stale", decidedAt: at, decidedBy });
        return "stale";
      }
      if (expectedVersion !== current(person)) return "version_conflict";
      const version = append(person, { ...person.profile, ...p.changes }, p.source, decidedBy, at, p.proposalId);
      Object.assign(p, { status: "confirmed", decidedAt: at, decidedBy });
      return { proposal: clone(p), version: clone(version) };
    },
    async appendVersion({ personId, expectedVersion, profile, source, createdBy, at, proposalId }) {
      const person = people.get(personId);
      if (!person) return "not_found";
      if (expectedVersion !== current(person)) return "stale";
      return clone(append(person, profile, source, createdBy, at, proposalId));
    },
    async listVersions(personId) {
      return clone(versions.filter((v) => v.personId === personId).sort((a, b) => a.version - b.version));
    },
  };

  // Callers hold no await between check and write, so each op is atomic in the single-threaded memory store.
  function append(person: Person, profile: Person["profile"], source: ProfileSource, createdBy: string, at: string, proposalId?: string) {
    const v: ProfileVersion = { personId: person.personId, version: current(person) + 1, profile: clone(profile), createdAt: at, createdBy, source, ...(proposalId ? { proposalId } : {}) };
    versions.push(v);
    person.profile = clone(profile);
    person.profileVersion = v.version;
    for (const o of proposals.values()) if (o.personId === person.personId && o.status === "proposed") Object.assign(o, { status: "stale", decidedAt: at });
    return v;
  }
}

const current = (p: Person) => p.profileVersion ?? 1;

// ponytail: in-memory default on globalThis (survives dev hot reload, lost on restart). Durable adapter replaces it.
const g = globalThis as unknown as { __daybridgeCaregiverStore?: CaregiverStore };
export const memoryCaregiverStore = (g.__daybridgeCaregiverStore ??= createMemoryStore());
