// C1 caregiver dashboard model (docs/product/SCREENS.md "C1", journeys/caregiver.md). Pure: no React, no window.
import { ACTIVITIES } from "@/domain/activities";
import type { AnalysisResult, CoordinationPlan, Dependency } from "@/lib/schema";
import { barrierText, whenText } from "@/components/views/copy";
import { coordinateHref, planStatusView, type PlanStatus, type StatusView } from "@/components/shell/helpers";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const SLOT_ORDER = ["morning", "afternoon", "evening"] as const;

/** "Wed afternoon" → "Wednesday afternoon"; anything else is shown as given. */
export const dayAndTime = (when: string): string => whenText(when);

/** Sort key: day of week, then time of day; unparseable times go last. */
function whenRank(when: string): number {
  const m = /^\s*([a-z]{3})[a-z]*\s+(morning|afternoon|evening)\s*$/i.exec(when ?? "");
  if (!m) return 999;
  const d = DAY_ORDER.indexOf(m[1].toLowerCase() as (typeof DAY_ORDER)[number]);
  return d < 0 ? 999 : d * 3 + SLOT_ORDER.indexOf(m[2].toLowerCase() as (typeof SLOT_ORDER)[number]);
}

/** "Margaret" → "Margaret's"; "You" → "Your". */
export const possessive = (name: string) => (name === "You" ? "Your" : `${name}'s`);

export type Outing = { activityId: string; name: string; when: string; whenLabel: string; status: PlanStatus; view: StatusView; href: string };
export type FixRow = { activityId: string; view: StatusView; text: string; detail: string; href: string };
export type ApprovalRow = { key: string; activityId: string; what: string; detail: string; href: string };
export type SharedRow = { key: string; recipient: string; kind: string; outing: string; fields: string; revoked: boolean };
export type Primary = { label: string; href: string; toUserMode?: boolean };

export type CareModel = {
  name: string;
  week: Outing[];
  needsFixing: FixRow[];
  approvals: ApprovalRow[];
  shared: SharedRow[];
  /** true when no outing has a saved plan id yet (the DS fallback): every outing is Not started. */
  noPlansYet: boolean;
  /** Link for the honest "Not started — open Get me there" line (first outing in the week). */
  startHref: string | null;
  primary: Primary;
};

export type CareInput = {
  name: string;
  week: string[];
  plans: Record<string, string>;
  result: AnalysisResult | null;
  statusFor: (activityId: string) => PlanStatus;
  /** Live status returned 503: statuses are unknown, so no fix / approval rows and no status-based primary. */
  unavailable: boolean;
};

function outingInfo(id: string, result: AnalysisResult | null, plan: CoordinationPlan | null): { name: string; when: string } {
  const item = result?.plan.find((i) => i.activityId === id);
  if (item) return { name: item.name, when: item.when };
  const act = ACTIVITIES.find((a) => a.id === id);
  if (act) return { name: act.name, when: `${act.day} ${act.time}` };
  if (plan) return { name: plan.activityName, when: plan.when };
  return { name: "An outing", when: "" };
}

const FIELD_WORDS: Record<string, string> = {
  name: "first name",
  pickupWindow: "pickup time",
  mobility: "walking aid",
  activityName: "activity",
  when: "day and time",
};
/** ["name","pickupWindow","mobility"] → "first name, pickup time and walking aid". Unknown fields are named as-is, never hidden. */
export function fieldsInWords(fields: string[]): string {
  const words = fields.map((f) => FIELD_WORDS[f] ?? f);
  if (words.length <= 1) return words[0] ?? "nothing";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function recipientName(plan: CoordinationPlan, recipientId: string): string {
  if (recipientId === "paratransit") return "Paratransit";
  return plan.contacts.find((c) => c.id === recipientId)?.name ?? recipientId;
}

function actionWhat(plan: CoordinationPlan, kind: "ride" | "invite", recipientId: string): string {
  const who = recipientName(plan, recipientId);
  if (kind === "invite") return `Invite ${who} to come along`;
  return recipientId === "paratransit" ? "Paratransit ride" : `Ride with ${who}`;
}

const BROKEN: Partial<Record<Dependency["status"], string>> = {
  cancelled: "was cancelled",
  declined: "was declined",
  failed: "didn't go through",
};

function replanText(plan: CoordinationPlan | null, outing: string): string {
  const dep = plan ? [...plan.dependencies].reverse().find((d) => BROKEN[d.status]) : undefined;
  if (!dep || !plan) return `${outing} needs a new plan.`;
  const what = dep.kind === "ride" ? `The ride to ${outing}` : `The invite for ${outing}`;
  return `${what} ${BROKEN[dep.status]}. A new plan is waiting.`;
}

export function buildCareModel(input: CareInput): CareModel {
  const { name, unavailable } = input;
  const ids = [...new Set([...input.week, ...Object.keys(input.plans)])];

  const all = ids.map((activityId) => {
    const status = input.statusFor(activityId);
    const info = outingInfo(activityId, input.result, status.plan);
    const view = planStatusView(status.state, "caregiver", name);
    return {
      activityId,
      name: info.name,
      when: info.when,
      whenLabel: dayAndTime(info.when),
      status,
      view,
      href: coordinateHref(activityId, view.resume ? status.planId : null),
    } satisfies Outing;
  });
  const byWhen = (a: Outing, b: Outing) => whenRank(a.when) - whenRank(b.when);
  const inWeek = new Set(input.week);
  const week = all.filter((o) => inWeek.has(o.activityId)).sort(byWhen);

  const live = unavailable ? [] : [...all].sort(byWhen);

  const needsFixing: FixRow[] = [
    ...live.filter((o) => o.status.state === "NEEDS_REPLAN"),
    ...live.filter((o) => o.status.state === "BLOCKED"),
  ].map((o) => ({
    activityId: o.activityId,
    view: o.view,
    href: o.href,
    text: o.status.state === "NEEDS_REPLAN" ? replanText(o.status.plan, o.name) : `${o.name} can't go as planned.`,
    detail:
      o.status.state === "BLOCKED" && o.status.plan?.blockers[0]
        ? `${o.whenLabel} · ${barrierText(o.status.plan.blockers[0], name === "You" ? null : name)}`
        : o.whenLabel,
  }));

  const approvals: ApprovalRow[] = live
    .filter((o) => o.status.state === "AWAITING_APPROVAL")
    .flatMap((o) => {
      const plan = o.status.plan;
      const pending = plan ? plan.actions.filter((a) => a.status === "proposed" && a.planVersion === plan.version) : [];
      if (!plan || pending.length === 0) {
        return [{ key: o.activityId, activityId: o.activityId, what: `Plan for ${o.name}`, detail: o.whenLabel, href: o.href }];
      }
      return pending.map((a) => ({
        key: `${o.activityId}:${a.id}`,
        activityId: o.activityId,
        what: actionWhat(plan, a.scope.kind, a.scope.recipientId),
        detail: [o.name, dayAndTime(a.scope.when) || o.whenLabel].filter(Boolean).join(" · "),
        href: o.href,
      }));
    });

  const shared: SharedRow[] = live.flatMap((o) => {
    const plan = o.status.plan;
    if (!plan) return [];
    return plan.approvals.map((ap) => ({
      key: `${o.activityId}:${ap.id}`,
      recipient: recipientName(plan, ap.scope.recipientId),
      kind: ap.scope.kind === "ride" ? "ride" : "invite",
      outing: o.name,
      fields: fieldsInWords(ap.scope.sharedFields),
      revoked: ap.revoked,
    }));
  });

  const noPlansYet = week.length > 0 && week.every((o) => !input.plans[o.activityId]);
  const startHref = week[0] ? coordinateHref(week[0].activityId) : null;

  // Primary action: first matching row wins (SCREENS C1).
  // Needs-OK beats plan-started: the primary opens the first row the caregiver sees under "Waiting for {name}'s OK".
  const pick = needsFixing[0] ?? approvals[0] ?? live.find((o) => o.status.state === "PROPOSED");
  let primary: Primary;
  if (pick) primary = { label: `Open with ${name}`, href: pick.href };
  else if (week.length === 0) primary = { label: `Pick activities with ${name}`, href: "/matches", toUserMode: true };
  else primary = { label: `See ${possessive(name)} calendar`, href: "/calendar" };

  return { name, week, needsFixing, approvals, shared, noPlansYet, startHref, primary };
}
