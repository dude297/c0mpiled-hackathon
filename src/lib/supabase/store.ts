import { CoordinationEvent, CoordinationPlan } from "@/lib/schema";
import { CoordinationError } from "@/domain/coordination/coordinator";
import type { CoordinationStore } from "@/domain/coordination/store";
import { adminClient } from "./server";

// Supabase-backed CoordinationStore. Writes go through two security-definer RPCs (one transaction each);
// see supabase/migrations/20261017000000_coordination.sql.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EventRow = { seq: number; at: string; type: string; actor: string; outcome: string; reason: string | null; idempotency_key: string | null; payload: unknown };

function toEvent(r: EventRow) {
  return {
    seq: r.seq,
    at: new Date(r.at).toISOString(), // timestamptz comes back as "+00:00"; the app writes toISOString()
    type: r.type,
    actor: r.actor,
    outcome: r.outcome,
    ...(r.reason != null && { reason: r.reason }),
    ...(r.idempotency_key != null && { idempotencyKey: r.idempotency_key }),
    payload: r.payload,
  };
}

export function createSupabaseStore(): CoordinationStore {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await adminClient().rpc(fn, args);
    if (error?.code === "P0001" && error.message === "plan_limit") throw new CoordinationError(429, "Plan limit reached for this account");
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    return data as unknown;
  };
  return {
    kind: "supabase",
    async load(id) {
      if (!UUID.test(id)) return null;
      // One PostgREST request = one SQL statement, so plan, events and keys are a consistent snapshot.
      const { data, error } = await adminClient()
        .from("coordination_plans")
        .select("id, owner_id, rev, plan, coordination_events(seq, at, type, actor, outcome, reason, idempotency_key, payload), coordination_seen_keys(key)")
        .eq("id", id)
        .order("seq", { referencedTable: "coordination_events", ascending: true })
        .maybeSingle();
      if (error) throw new Error(`load ${id} failed: ${error.message}`);
      if (!data) return null;
      const plan = CoordinationPlan.parse(data.plan); // throws on corrupt rows: never trust silently
      if (plan.id !== data.id) throw new Error(`Stored plan ${data.id} has mismatched id ${plan.id}`);
      return {
        plan,
        log: CoordinationEvent.array().parse((data.coordination_events as EventRow[]).map(toEvent)),
        seenKeys: new Set((data.coordination_seen_keys as { key: string }[]).map((k) => k.key)),
        rev: data.rev as number,
        ownerId: data.owner_id as string,
      };
    },
    async create(entry) {
      if (!entry.ownerId) throw new Error("Supabase plans require an ownerId");
      await rpc("coordination_create", { p_id: entry.plan.id, p_owner: entry.ownerId, p_plan: entry.plan, p_events: entry.log, p_keys: [...entry.seenKeys] });
    },
    async commit(id, expectedRev, plan, newEvents, newKeys) {
      if (plan.id !== id) throw new Error(`commit: plan.id ${plan.id} does not match ${id}`);
      if (!UUID.test(id)) return false; // no such row can exist
      return (await rpc("coordination_commit", { p_id: id, p_expected_rev: expectedRev, p_plan: plan, p_events: newEvents, p_keys: newKeys })) === true;
    },
  };
}
