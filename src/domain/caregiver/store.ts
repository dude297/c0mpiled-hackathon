import type { Ack, CheckIn, Grant, Person, PlanLink } from "./contract";

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
  const clone = structuredClone;
  const gk = (p: string, u: string) => `${p}|${u}`;
  const otherManagers = (personId: string, userId: string) =>
    [...grants.values()].some((g) => g.personId === personId && g.userId !== userId && isManager(g));

  return {
    kind: "memory",
    async createPerson(person, creatorGrant) {
      people.set(person.personId, clone(person));
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
  };
}

// ponytail: in-memory default on globalThis (survives dev hot reload, lost on restart). Durable adapter replaces it.
const g = globalThis as unknown as { __daybridgeCaregiverStore?: CaregiverStore };
export const memoryCaregiverStore = (g.__daybridgeCaregiverStore ??= createMemoryStore());
