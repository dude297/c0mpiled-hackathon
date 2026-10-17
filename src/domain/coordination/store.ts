import type { CoordinationEvent, CoordinationPlan } from "@/lib/schema";

// Persistence port for the coordinator (domain stays free of Supabase imports).
// `rev` is the concurrency token: it bumps on every successful commit. `plan.version` is the replan counter, not this.
export type StoredPlan = {
  plan: CoordinationPlan;
  log: CoordinationEvent[];
  seenKeys: Set<string>;
  rev: number;
  ownerId: string | null; // null only in local/offline mode
};

export interface CoordinationStore {
  readonly kind: "memory" | "supabase";
  /** A private copy of the stored plan, or null. Mutating it never touches the store. */
  load(planId: string): Promise<StoredPlan | null>;
  /** Insert a new plan at rev = 1. */
  create(entry: Omit<StoredPlan, "rev">): Promise<void>;
  /**
   * Atomic compare-and-swap: write `plan`, append `newEvents`, add `newKeys`, set rev = expectedRev + 1,
   * only while the stored rev still equals expectedRev. Returns false (and changes nothing) otherwise.
   */
  commit(planId: string, expectedRev: number, plan: CoordinationPlan, newEvents: CoordinationEvent[], newKeys: string[]): Promise<boolean>;
}

// Offline/dev default. Same semantics as the Supabase store, including CAS.
export function createMemoryStore(): CoordinationStore {
  const rows = new Map<string, StoredPlan>();
  const copy = (s: StoredPlan): StoredPlan => ({ ...structuredClone({ plan: s.plan, log: s.log }), seenKeys: new Set(s.seenKeys), rev: s.rev, ownerId: s.ownerId });
  return {
    kind: "memory",
    async load(id) {
      const s = rows.get(id);
      return s ? copy(s) : null;
    },
    async create(entry) {
      if (rows.has(entry.plan.id)) throw new Error(`Plan ${entry.plan.id} already exists`);
      rows.set(entry.plan.id, copy({ ...entry, rev: 1 }));
    },
    async commit(id, expectedRev, plan, newEvents, newKeys) {
      const s = rows.get(id);
      if (!s || s.rev !== expectedRev) return false;
      rows.set(id, copy({ plan, log: [...s.log, ...newEvents], seenKeys: new Set([...s.seenKeys, ...newKeys]), rev: s.rev + 1, ownerId: s.ownerId }));
      return true;
    },
  };
}
