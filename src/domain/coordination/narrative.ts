import type { ActionRequest, CoordinationPlan, PlanState, PreferencePatch } from "@/lib/schema";
import { PARATRANSIT_ID } from "./planner";

// Plain-language, deterministic summary of a plan for caregivers. No AI. Never calls a "requested"
// dependency confirmed or booked: only provider evidence (dependency "confirmed") is described as confirmed.

export type NarrativeStatus = "blocked" | "needs_you" | "waiting" | "ready" | "replanning" | "done" | "cancelled";
export type PlanNarrative = { headline: string; status: NarrativeStatus; lines: string[]; nextStep: string | null };

const STATUS: Record<PlanState, NarrativeStatus> = {
  BLOCKED: "blocked", PROPOSED: "needs_you", AWAITING_APPROVAL: "needs_you", PENDING_CONFIRMATION: "waiting",
  READY: "ready", NEEDS_REPLAN: "replanning", COMPLETED: "done", CANCELLED: "cancelled",
};
const FIELD: Record<string, string> = { name: "name", pickupWindow: "pickup window", mobility: "mobility", activityName: "activity name", when: "time" };
const FAILED = new Set(["declined", "cancelled", "failed"]);

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function patchText(p: PreferencePatch) {
  if (p.field === "prefersSmallGroups") return `prefer ${p.to ? "small groups" : "any group size"} (was ${p.from ? "on" : "off"})`;
  if (p.field === "maxTravelMin") return `keep trips under ${p.to} min (was ${p.from} min)`;
  return `weekly budget $${p.to} (was $${p.from})`;
}

export function describePlan(plan: CoordinationPlan): PlanNarrative {
  const who = (id: string) => (id === PARATRANSIT_ID ? "Paratransit service" : plan.contacts.find((c) => c.id === id)?.name ?? id);
  const label = (a: ActionRequest) =>
    a.scope.kind === "invite" ? `Invite to ${who(a.scope.recipientId)}` : a.scope.recipientId === PARATRANSIT_ID ? "Paratransit ride" : `Ride from ${who(a.scope.recipientId)}`;
  const depOf = (a: ActionRequest) => plan.dependencies.find((d) => d.actionId === a.id);
  const current = plan.actions.filter((a) => a.status !== "superseded");
  const needsOk = current.filter((a) => a.status === "proposed" || a.status === "revoked");
  const isNeedsOk = (a: ActionRequest) => needsOk.includes(a);
  const name = plan.profile.name;
  const act = `${plan.activityName} (${plan.when})`;

  const lines: string[] = [];
  // What went wrong, and what replaces it.
  for (const a of plan.actions) {
    const d = depOf(a);
    if (!d || !FAILED.has(d.status) || current.includes(a)) continue;
    const verb = a.scope.kind === "invite" && d.status === "declined" ? "declined" : d.status;
    const next = current.find((x) => x.scope.kind === a.scope.kind);
    const tail = next ? (isNeedsOk(next) ? ` — new option: ${label(next)} (needs your OK)` : ` — replaced by ${label(next)}`) : plan.blockers.length ? " — no other option left" : "";
    lines.push(`✗ ${label(a)} ${verb}${tail}`);
  }
  for (const a of current) {
    const st = depOf(a)?.status;
    const l = label(a);
    if (st === "confirmed") lines.push(`✓ ${l} ${a.scope.kind === "invite" ? "accepted" : "confirmed"}`);
    else if (st === "requested") lines.push(`⏳ ${l} sent, waiting for a reply`);
    else if (st && FAILED.has(st)) lines.push(`✗ ${l} ${st}`);
    else if (a.status === "approved") lines.push(a.dispatchError ? `⚠ ${l} approved, but the service couldn't be reached yet` : `• ${l} approved, not sent yet`);
    else if (plan.state !== "CANCELLED") lines.push(`• ${l} (needs your OK)`);
  }
  for (const iv of plan.interventions) if (iv.kind === "user_step") lines.push(`• Tip: ${iv.description}`);
  for (const b of plan.blockers) lines.push(`✗ ${b.detail}`);
  if (plan.state === "COMPLETED") for (const p of plan.preferencePatches) if (p.status === "proposed") lines.push(`? Suggested change: ${patchText(p)} — waiting for your confirmation`);

  const alts = plan.alternatives.map((x) => `${x.name} (${x.when})`);
  const tryInstead = alts.length ? `Try instead: ${list(alts)}` : "No workable option right now; cancel or adjust preferences";
  const approvals = needsOk.map((a) => `${label(a)} (shares ${list(a.scope.sharedFields.map((f) => FIELD[f] ?? f))})`);
  const waitingOn = current.filter((a) => depOf(a)?.status === "requested").map(label);

  let headline: string;
  let nextStep: string | null;
  switch (plan.state) {
    case "BLOCKED":
      headline = `${name} can't go to ${act} yet`;
      nextStep = tryInstead;
      break;
    case "PROPOSED":
      headline = `Here's how ${name} can get to ${act}`;
      nextStep = current.length ? `Accept the plan, then approve each request (${list(current.map(label))})` : "Accept the plan — no one needs to be contacted";
      break;
    case "AWAITING_APPROVAL": {
      headline = `${act} needs your OK before anyone is contacted`;
      const retry = current.some((a) => a.dispatchError);
      nextStep = approvals.length ? `Approve ${list(approvals)}, then send the requests` : retry ? "Try sending again — the service couldn't be reached" : "Send the approved requests";
      break;
    }
    case "PENDING_CONFIRMATION":
      headline = `Waiting for replies about ${name}'s ${act}`;
      nextStep = waitingOn.length ? `Nothing to do yet — waiting on ${list(waitingOn)}` : null;
      break;
    case "READY":
      headline = `${name} is all set for ${act}`;
      nextStep = "After the activity, mark whether it happened";
      break;
    case "NEEDS_REPLAN":
      headline = `Something changed for ${act} — here's a new plan`;
      nextStep = plan.blockers.length ? tryInstead : approvals.length ? `Accept the new plan, then approve ${list(approvals)}` : "Accept the new plan — no new requests needed";
      break;
    case "COMPLETED": {
      headline = plan.outcome?.attended === false ? `${name} didn't make it to ${act}` : `${name} went to ${act}`;
      const n = plan.preferencePatches.filter((p) => p.status === "proposed").length;
      nextStep = n ? `Confirm or reject ${n} suggested preference change${n > 1 ? "s" : ""}` : plan.preferencePatches.length ? null : "Share how it went";
      break;
    }
    case "CANCELLED": {
      headline = `${name}'s plan for ${act} was cancelled`;
      const told = current.filter((a) => a.status === "dispatched" && !FAILED.has(depOf(a)?.status ?? "")).map((a) => who(a.scope.recipientId));
      nextStep = told.length ? `Let ${list(told)} know it's off` : null;
      break;
    }
  }
  return { headline, status: STATUS[plan.state], lines, nextStep };
}
