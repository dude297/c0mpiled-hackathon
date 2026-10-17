import type { Activity } from "@/domain/activities";
import { checkActivity } from "@/domain/engine";
import type { ActionScope, Barrier, Contact, FeedbackSignal, Intervention, PreferencePatch, Profile } from "@/lib/schema";

// Pure planning: which interventions make an activity feasible, and which external actions they need.
// Hard barriers come from the existing engine (checkActivity), so analysis and coordination never disagree.

export const PARATRANSIT_ID = "paratransit";

// Minimum data shared with a recipient; the approval scope names these exact fields.
const SHARED_FIELDS: Record<ActionScope["kind"], string[]> = {
  ride: ["name", "pickupWindow", "mobility"],
  invite: ["name", "activityName", "when"],
};

export type ProposedAction = { interventionId: string; scope: ActionScope; description: string };

export type Proposal =
  | { feasible: false; blockers: Barrier[] }
  | { feasible: true; blockers: Barrier[]; interventions: Intervention[]; actions: ProposedAction[] };

export type Exclusions = { recipients: Set<string> }; // recipients that declined/cancelled/failed for this plan

export function whenOf(a: Activity) {
  return `${a.day} ${a.time}`;
}

function rideCandidates(p: Profile, a: Activity, contacts: Contact[], ex: Exclusions): { recipientId: string; label: string }[] {
  const out: { recipientId: string; label: string }[] = [];
  const family = a.travelMin.family;
  if (p.transport.includes("family") && family !== undefined && family <= p.maxTravelMin) {
    for (const c of contacts) if (c.canDrive && !ex.recipients.has(c.id)) out.push({ recipientId: c.id, label: `Ride from ${c.name} (${family} min)` });
  }
  const para = a.travelMin.paratransit;
  if (p.transport.includes("paratransit") && para !== undefined && para <= p.maxTravelMin && !ex.recipients.has(PARATRANSIT_ID)) {
    out.push({ recipientId: PARATRANSIT_ID, label: `Paratransit ride (${para} min, booked 24h ahead)` });
  }
  return out;
}

export function propose(p: Profile, a: Activity, contacts: Contact[], ex: Exclusions = { recipients: new Set() }): Proposal {
  const checks = checkActivity(p, a);
  const hard = checks.flatMap((c) => (c.barrier?.severity === "hard" ? [c.barrier] : []));
  if (hard.length) return { feasible: false, blockers: hard };

  const interventions: Intervention[] = [];
  const actions: ProposedAction[] = [];
  const blockers: Barrier[] = [];
  const when = whenOf(a);

  for (const c of checks) {
    const b = c.barrier;
    if (!b) continue;
    const id = `iv-${b.rule}`;
    if (b.rule === "transport") {
      // Engine says the only route needs someone else to drive (family or paratransit): that's a dependency.
      const ride = rideCandidates(p, a, contacts, ex)[0];
      if (!ride) {
        blockers.push({ rule: "transport", severity: "hard", detail: `${b.detail}; no available driver or paratransit option left` });
        continue;
      }
      interventions.push({ id, kind: "ride", rule: b.rule, description: ride.label, actionId: undefined });
      actions.push({ interventionId: id, description: ride.label, scope: { kind: "ride", recipientId: ride.recipientId, sharedFields: SHARED_FIELDS.ride, when } });
    } else if (b.rule === "social") {
      const friend = contacts.find((x) => !ex.recipients.has(x.id));
      if (friend) {
        const description = `Invite ${friend.name} to come along`;
        interventions.push({ id, kind: "invite", rule: b.rule, description });
        actions.push({ interventionId: id, description, scope: { kind: "invite", recipientId: friend.id, sharedFields: SHARED_FIELDS.invite, when } });
      } else {
        interventions.push({ id, kind: "user_step", rule: b.rule, description: b.mitigation ?? b.detail });
      }
    } else {
      interventions.push({ id, kind: "user_step", rule: b.rule, description: b.mitigation ?? b.detail });
    }
  }
  if (blockers.length) return { feasible: false, blockers };
  return { feasible: true, blockers: [], interventions, actions };
}

// Feasible alternatives the user can switch to (deterministic order: fewest soft barriers, then id).
export function alternativesFor(p: Profile, catalog: Activity[], excludeId: string, contacts: Contact[]) {
  return catalog
    .filter((a) => a.id !== excludeId && a.tags.some((t) => p.interests.includes(t)))
    .map((a) => ({ a, prop: propose(p, a, contacts) }))
    .filter((x) => x.prop.feasible)
    .sort((x, y) => softCount(p, x.a) - softCount(p, y.a) || x.a.id.localeCompare(y.a.id))
    .slice(0, 3)
    .map(({ a }) => ({ activityId: a.id, name: a.name, when: whenOf(a) }));
}

export function softCount(p: Profile, a: Activity) {
  return checkActivity(p, a).filter((c) => c.barrier?.severity === "soft").length;
}

// Feedback → proposed patches. Never applied here; the user must confirm each one.
export function patchesFromFeedback(p: Profile, signals: FeedbackSignal[], activityName: string): Omit<PreferencePatch, "id">[] {
  const out: Omit<PreferencePatch, "id">[] = [];
  for (const s of new Set(signals)) {
    if (s === "too_crowded" && !p.prefersSmallGroups)
      out.push({ field: "prefersSmallGroups", from: false, to: true, evidence: `Said ${activityName} felt too crowded`, status: "proposed" });
    if (s === "too_far" && p.maxTravelMin > 5)
      out.push({ field: "maxTravelMin", from: p.maxTravelMin, to: Math.max(5, p.maxTravelMin - 10), evidence: `Said the trip to ${activityName} was too far`, status: "proposed" });
    if (s === "too_expensive" && p.budgetPerWeek > 0)
      out.push({ field: "budgetPerWeek", from: p.budgetPerWeek, to: Math.max(0, p.budgetPerWeek - 5), evidence: `Said ${activityName} cost too much`, status: "proposed" });
  }
  return out;
}
