// Pure helpers for U2 Home and U5 Activity detail (docs/product/SCREENS.md). No React, no window: tested in home-model.test.ts.
import { DAYS, SLOTS, parseWhen, type Day } from "@/components/calendar/WeekCalendar";
import { coordinateHref, type DroppedOuting, type Mode, type PlanStatus, type StatusView } from "@/components/shell/helpers";
import type { Activity } from "@/domain/activities";
import { money } from "@/components/feed/MatchFeed";
import type { AnalysisResult, Barrier, PlanItem, Profile } from "@/lib/schema";

export { money };

export const DAY_NAMES: Record<Day, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

type Transport = Profile["transport"][number];
export const MODE_WORDS: Record<Transport, string> = {
  drive: "Driving",
  bus: "Bus",
  paratransit: "Senior shuttle",
  family: "Ride from family",
  walk: "Walking",
};

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const trimDot = (s: string) => s.trim().replace(/\.+$/, "");

/** "Free" or "$5 a week" (U5 header). */
export const costWords = (n: number) => (n === 0 ? "Free" : `${money(n)} a week`);

/** One line for U2: "2 outings · $5 this week", "1 outing · Free". */
export function weekLine(items: Pick<PlanItem, "costPerWeek">[]): string {
  if (items.length === 0) return "Nothing in your week yet";
  const total = items.reduce((s, i) => s + i.costPerWeek, 0);
  return `${items.length} ${items.length === 1 ? "outing" : "outings"} · ${total === 0 ? "Free" : `${money(total)} this week`}`;
}

/** Engine travel "bus, 15 min" → "Bus, about 15 min". Unknown shapes pass through. */
export function travelLine(travel: string): string {
  const m = /^\s*([a-z]+),\s*(\d+)\s*min\s*$/i.exec(travel);
  if (!m) return travel;
  const mode = m[1].toLowerCase() as Transport;
  return `${MODE_WORDS[mode] ?? m[1]}, about ${m[2]} min`;
}

/** A soft barrier in plain words (same on every screen): what to expect + what helps. */
export function softBarrierText(b: Pick<Barrier, "rule" | "detail" | "mitigation">): { detail: string; tip: string | null } {
  const raw = trimDot(b.detail);
  const detail = /^\s*[a-z]+,\s*\d+\s*min\s*$/i.test(raw) ? travelLine(raw) : b.rule === "social" ? "Large group" : raw;
  return { detail, tip: b.mitigation ? trimDot(b.mitigation) : null };
}

export const travelMode = (travel: string): Transport | null => {
  const m = /^\s*([a-z]+),/i.exec(travel);
  const mode = m?.[1].toLowerCase();
  return mode && mode in MODE_WORDS ? (mode as Transport) : null;
};

/** Other ways to get there (one plain line on U5). Walking is left out for walker / wheelchair users. */
export function otherWays(activity: Pick<Activity, "travelMin">, chosen: Transport | null, mobility: Profile["mobility"] | null): string[] {
  const canWalk = mobility !== "walker" && mobility !== "wheelchair";
  return (Object.keys(MODE_WORDS) as Transport[])
    .filter((m) => m !== chosen && activity.travelMin[m] !== undefined && (m !== "walk" || canWalk))
    .sort((a, b) => activity.travelMin[a]! - activity.travelMin[b]!)
    .map((m) => `${lowerFirst(MODE_WORDS[m])}, about ${activity.travelMin[m]} min`);
}

/** Monday = 0 … Sunday = 6. */
export const todayIndex = (d: Date) => (d.getDay() + 6) % 7;

function order(item: PlanItem): number {
  const at = parseWhen(item.when);
  return at ? DAYS.indexOf(at.day) * 10 + SLOTS.indexOf(at.slot) : 999;
}

/** The person's week: plan items whose id is in `week`, Monday → Sunday, morning → evening. */
export function weekItems(result: AnalysisResult | null, week: readonly string[]): PlanItem[] {
  if (!result) return [];
  const ids = new Set(week);
  return result.plan.filter((i) => ids.has(i.activityId)).sort((a, b) => order(a) - order(b));
}

/** Next outing from today on (the week repeats); wraps to the first one. A "time TBD" outing is only picked when nothing is scheduled. */
export function nextOuting(items: PlanItem[], today: number): PlanItem | null {
  const sorted = [...items].sort((a, b) => order(a) - order(b));
  return sorted.find((i) => order(i) < 999 && Math.floor(order(i) / 10) >= today) ?? sorted[0] ?? null;
}

/** "Wednesday" from "Wed afternoon"; falls back to the raw text. */
export function dayName(when: string): string {
  const at = parseWhen(when);
  return at ? DAY_NAMES[at.day] : when;
}

/** 7-day strip: one entry per day with the outings on it. */
export function weekStrip(items: PlanItem[], today: number) {
  return DAYS.map((day, i) => ({
    day,
    name: DAY_NAMES[day],
    today: i === today,
    items: items.filter((it) => parseWhen(it.when)?.day === day),
  }));
}

export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export const aiLabel = (source: AnalysisResult["dataSource"]) => (source === "live" ? "Written by AI" : "Sample AI text");

export type Primary = { label: string; href: string; coordinate: boolean };

type StatusFor = (activityId: string) => PlanStatus;

/** U2 primary action: exactly one, first matching row of the SCREENS.md U2 table wins. */
export function homePrimary(items: PlanItem[], next: PlanItem | null, statusFor: StatusFor, unavailable: boolean): Primary {
  if (items.length === 0 || !next) return { label: "See matches", href: "/matches", coordinate: false };
  // 503: coordination is off on this server. Never a dead "Get me there" link.
  if (unavailable) return { label: "See my calendar", href: "/calendar", coordinate: false };
  const go = (label: string, s: PlanStatus, id: string): Primary => ({ label, href: coordinateHref(id, s.planId), coordinate: true });
  for (const [state, label] of [["NEEDS_REPLAN", "Fix my plan"], ["BLOCKED", "See what's in the way"]] as const) {
    const hit = items.find((i) => statusFor(i.activityId).state === state);
    if (hit) return go(label, statusFor(hit.activityId), hit.activityId);
  }
  const s = statusFor(next.activityId);
  if (s.state === "PROPOSED" || s.state === "AWAITING_APPROVAL") return go("Continue my plan", s, next.activityId);
  if (s.state === "PENDING_CONFIRMATION") return go("See status", s, next.activityId);
  if (s.state === null) return { label: "Get me there", href: coordinateHref(next.activityId), coordinate: true };
  return { label: "See my calendar", href: "/calendar", coordinate: false };
}

export type AttentionRow = { key: string; text: string; link: { label: string; href: string; coordinate: boolean } };

/** U2 "Needs attention": plan states first (by urgency), then dropped outings, then one soft barrier. Max 3. */
export function attentionRows(opts: {
  items: PlanItem[];
  statusFor: StatusFor;
  viewFor: (activityId: string) => StatusView;
  dropped: DroppedOuting[];
  unavailable: boolean;
}): AttentionRow[] {
  const { items, statusFor, viewFor, dropped, unavailable } = opts;
  const rows: AttentionRow[] = [];
  if (!unavailable) {
    items
      .map((i) => ({ i, v: viewFor(i.activityId) }))
      .filter(({ v }) => v.attention > 0 && v.action)
      .sort((a, b) => a.v.attention - b.v.attention)
      .forEach(({ i, v }) => {
        const s = statusFor(i.activityId);
        rows.push({
          key: `status-${i.activityId}`,
          text: `${i.name} on ${dayName(i.when)}: ${lowerFirst(v.word)}.`,
          link: { label: v.action!, href: coordinateHref(i.activityId, v.resume ? s.planId : null), coordinate: true },
        });
      });
  }
  for (const d of dropped) {
    rows.push({
      key: `dropped-${d.activityId}`,
      text: d.reason ? `${d.name} no longer fits: ${lowerFirst(trimDot(d.reason))}.` : `${d.name} no longer fits your answers.`,
      link: { label: "See matches", href: "/matches", coordinate: false },
    });
  }
  for (const i of items) {
    const b = i.barriers.find((x) => x.severity === "soft");
    if (!b) continue;
    const { detail, tip } = softBarrierText(b);
    rows.push({
      key: `soft-${i.activityId}`,
      text: `${i.name}: ${lowerFirst(detail)}.${tip ? ` ${tip}.` : ""}`,
      link: { label: "See details", href: activityHref(i.activityId, "home"), coordinate: false },
    });
    break;
  }
  return rows.slice(0, 3);
}

/** One plain reason when nothing fits: the most common hard barrier across "didn't fit". */
export function noMatchReason(result: AnalysisResult): string {
  const counts = new Map<string, number>();
  for (const b of result.blocked) {
    const rule = b.barriers.find((x) => x.severity === "hard")?.rule;
    if (rule) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const why: Record<string, string> = {
    transport: "most were too far",
    time: "most meet at times you aren't free",
    access: "most have stairs at the entrance",
    cost: "most cost more than your budget",
  };
  return top && why[top] ? `Nothing fits yet: ${why[top]}.` : "Nothing fits yet.";
}

/** Where "Back" goes on U5. `from` is an optional ?from= query value. */
export type BackTarget = "home" | "matches" | "calendar" | "care";
export function backLink(from: string | null, mode: Mode): { label: string; href: string } {
  const targets: Record<BackTarget, { label: string; href: string }> = {
    home: { label: "Back to home", href: "/home" },
    matches: { label: "Back to matches", href: "/matches" },
    calendar: { label: "Back to calendar", href: "/calendar" },
    care: { label: "Back to care", href: "/care" },
  };
  if (from && Object.hasOwn(targets, from)) return targets[from as BackTarget];
  return mode === "caregiver" ? targets.care : targets.matches;
}

export const activityHref = (id: string, from?: BackTarget) => `/activity/${encodeURIComponent(id)}${from ? `?from=${from}` : ""}`;

/** "How we checked" lines for one activity: evidence whose claim starts with "{name}: ". Never labeled "Verified". */
export function checksFor(result: AnalysisResult | null, name: string): { text: string; passed: boolean }[] {
  if (!result) return [];
  const prefix = `${name}: `;
  return result.evidence.filter((e) => e.claim.startsWith(prefix)).map((e) => ({ text: e.claim.slice(prefix.length), passed: e.verified }));
}

/** First hard reason an activity didn't fit, if the last result says so. */
export function didntFitReason(result: AnalysisResult | null, name: string): string | null {
  const b = result?.blocked.find((x) => x.name === name)?.barriers.find((x) => x.severity === "hard");
  return b ? trimDot(b.detail) : null;
}

/** Plain access facts from ACTIVITIES (estimates). */
export function accessFacts(a: Pick<Activity, "stepFree" | "hearingLoop" | "noisy" | "groupSize">): string[] {
  return [
    a.stepFree ? "Step-free entrance" : "Stairs at the entrance",
    a.groupSize === "small" ? "Small group" : "Large group",
    a.noisy ? "Can be noisy" : "Usually quiet",
    ...(a.hearingLoop ? ["Hearing loop"] : []),
  ];
}

/** U5 primary label from the plan status. Caregiver wording never claims they approve for the person. */
export function activityPrimaryLabel(view: StatusView, mode: Mode, name: string): string | null {
  if (!view.action) return null;
  if (mode !== "caregiver") return view.action;
  return view.resume ? `Open with ${name}` : "Get them there";
}
