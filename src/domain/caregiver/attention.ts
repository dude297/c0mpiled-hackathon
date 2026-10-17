import type { CoordinationPlan } from "@/lib/schema";
import type { AttentionItem, CheckIn, Person } from "./contract";
import { safeDeps } from "./history";

const DAY_MS = 86_400_000;

type Input = { person: Person; plans: CoordinationPlan[]; checkIns: CheckIn[]; ackedItemIds: string[]; now: Date };

// Pure: recomputed from coordinator + store on every read. Acks only flip acknowledgedByMe; nothing here resolves state.
export function attentionFor({ person, plans, checkIns, ackedItemIds, now }: Input): AttentionItem[] {
  const personId = person.personId;
  const items: Omit<AttentionItem, "acknowledgedByMe">[] = [];

  for (const p of plans) {
    const base = { personId, planId: p.id, createdAt: p.updatedAt };
    // approval_needed: the only state where actions wait on approval is AWAITING_APPROVAL
    // (accepting a NEEDS_REPLAN proposal moves the plan there).
    if (p.state === "AWAITING_APPROVAL")
      items.push({ ...base, itemId: `approval_needed:${p.id}:v${p.version}`, kind: "approval_needed", title: `Approval needed: ${p.activityName}`, detail: "Arrangements are waiting for approval before anything is sent." });
    if (p.state === "PENDING_CONFIRMATION") {
      const waiting = safeDeps(p).filter((d) => d.status === "requested").map((d) => d.label);
      items.push({ ...base, itemId: `confirmation_pending:${p.id}:v${p.version}`, kind: "confirmation_pending", title: `Waiting for confirmation: ${p.activityName}`, detail: waiting.length ? `Requested, not yet confirmed: ${waiting.join(", ")}` : "Waiting for confirmation." });
    }
    if (p.state === "NEEDS_REPLAN")
      items.push({ ...base, itemId: `plan_disrupted:${p.id}:v${p.version}`, kind: "plan_disrupted", title: `Plan disrupted: ${p.activityName}`, detail: "An arrangement fell through; a new proposal is ready to review." });
  }

  for (const c of checkIns) {
    if (c.kind === "help")
      items.push({ itemId: `help_requested:${c.checkInId}`, kind: "help_requested", personId, planId: c.planId, createdAt: c.at, title: "Help requested", detail: `Reported by ${c.reporterRole === "self" ? "the person" : "a caregiver"}.` });
  }

  // Only the latest call request counts, and only while no later "ok" from the same reporter role exists.
  const lastCall = checkIns.filter((c) => c.kind === "call").at(-1);
  if (lastCall && !checkIns.some((c) => c.kind === "ok" && c.reporterRole === lastCall.reporterRole && c.at > lastCall.at))
    items.push({ itemId: `call_requested:${lastCall.checkInId}`, kind: "call_requested", personId, planId: lastCall.planId, createdAt: lastCall.at, title: "Call requested", detail: `Requested by ${lastCall.reporterRole === "self" ? "the person" : "a caregiver"}.` });

  // Unknown stays unknown: without a schedule there is never an overdue item.
  if (person.checkInSchedule) {
    const last = checkIns.at(-1)?.at ?? person.createdAt;
    const windowStart = new Date(Date.parse(last) + person.checkInSchedule.everyDays * DAY_MS);
    if (now.getTime() > windowStart.getTime())
      items.push({ itemId: `checkin_overdue:${personId}:${windowStart.toISOString()}`, kind: "checkin_overdue", personId, createdAt: windowStart.toISOString(), title: "Check-in overdue", detail: `No check-in for more than ${person.checkInSchedule.everyDays} day(s).` });
  }

  const acked = new Set(ackedItemIds);
  return items.map((i) => stripUndef({ ...i, acknowledgedByMe: acked.has(i.itemId) }));
}

const stripUndef = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
