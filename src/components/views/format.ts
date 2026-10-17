// Plain-words formatting for U3 Matches, U4 Calendar and U6 Profile. Pure: unit-tested in format.test.ts.
import { DAYS, placeOnWeek, type Day, type Slot } from "@/components/calendar/WeekCalendar";
import { money } from "@/components/feed/MatchFeed";
import { INTEREST_META, TRANSPORT_OPTIONS, TRAVEL_BUCKETS, WALKING_AID_OPTIONS } from "@/components/onboarding/CardDeck";
import type { AnalysisResult, Barrier, PlanItem, Profile } from "@/lib/schema";

export const DAY_NAMES: Record<Day, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};
export const SLOT_WORDS: Record<Slot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

const MODE_WORDS: Record<string, string> = {
  drive: "Drive", bus: "Bus", paratransit: "Senior shuttle", family: "Family ride", walk: "Walk",
};
const MODE_PHRASE: Record<string, string> = {
  drive: "driving", bus: "bus", paratransit: "senior shuttle", family: "family ride", walk: "walking",
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Free" or "$5 a week". */
export const costPlain = (n: number) => (n === 0 ? "Free" : `${money(n)} a week`);

/** Engine travel "bus, 25 min" → { mode: "Bus", text: "Bus, about 25 min" }. Unknown shapes are shown as given. */
export function travelPlain(travel: string): { mode: string; text: string } {
  const m = /^\s*([a-z]+)\s*,\s*(\d+)\s*min/i.exec(travel ?? "");
  if (!m) return { mode: cap(travel ?? ""), text: cap(travel ?? "") };
  const mode = MODE_WORDS[m[1].toLowerCase()] ?? cap(m[1]);
  return { mode, text: `${mode}, about ${m[2]} min` };
}

/** One meta line for a match card: "Wed afternoon · Bus, about 15 min · Free". */
export const metaLine = (item: PlanItem) => [item.when, travelPlain(item.travel).text, costPlain(item.costPerWeek)].join(" · ");

/** A soft barrier in plain words: what to expect + what helps. */
export function headsUpText(b: Barrier): { detail: string; tip: string | null } {
  let detail = b.detail;
  const shuttle = /^paratransit,\s*(\d+)\s*min/i.exec(b.detail);
  if (shuttle) detail = `Senior shuttle, about ${shuttle[1]} min`;
  else if (b.rule === "social") detail = "Large group";
  return { detail, tip: b.mitigation ?? null };
}

/** First soft barrier as the card's single heads-up row, and how many more there are (shown on the details page). */
export function cardHeadsUp(item: PlanItem): { first: Barrier | null; more: number } {
  const soft = item.barriers.filter((b) => b.severity === "soft");
  return { first: soft[0] ?? null, more: Math.max(0, soft.length - 1) };
}

/** First hard reason an activity didn't fit, in plain words ("Too far: 45 min, your limit is 30"). */
export function didntFitReason(barriers: Barrier[]): string {
  const b = barriers.find((x) => x.severity === "hard");
  if (!b) return "Didn't fit your answers";
  const far = /Fastest option is \w+ at (\d+) min; limit is (\d+) min/.exec(b.detail);
  if (far) return `Too far: ${far[1]} min, your limit is ${far[2]}`;
  const noWay = /No way to get there using (.+)$/.exec(b.detail);
  if (noWay) {
    const modes = noWay[1].split("/").map((m) => MODE_PHRASE[m.trim()] ?? m.trim());
    return `No way to get there by ${modes.join(" or ")}`;
  }
  const time = /^Meets (\w+) (morning|afternoon|evening);/.exec(b.detail);
  if (time) return `Meets ${time[1]} ${time[2]}, outside the times you picked`;
  if (/^Entrance has stairs/.test(b.detail)) return "Entrance has stairs, no step-free way in";
  const cost = /^\$(\S+)\/week exceeds the \$(\S+) budget/.exec(b.detail);
  if (cost) return `Costs $${cost[1]} a week, over the $${cost[2]} budget`;
  return b.detail;
}

/** Matches not yet in the week first; otherwise the engine's order. */
export function sortMatches(plan: PlanItem[], week: readonly string[]): PlanItem[] {
  const inWeek = new Set(week);
  return [...plan.filter((i) => !inWeek.has(i.activityId)), ...plan.filter((i) => inWeek.has(i.activityId))];
}

export const didntFitLabel = (n: number) => `${n} ${n === 1 ? "activity" : "activities"} didn't fit — see why`;

/** Outings in the week, in plan order. Ids missing from the result are ignored (never invented). */
export function weekItems(result: AnalysisResult | null, week: readonly string[]): PlanItem[] {
  if (!result) return [];
  const inWeek = new Set(week);
  return result.plan.filter((i) => inWeek.has(i.activityId));
}

/** JS getDay() (0 = Sunday) → "Mon".."Sun". */
export const dayOf = (date: Date): Day => DAYS[(date.getDay() + 6) % 7];

export type DayRow = { day: Day; isToday: boolean; outings: { slot: Slot; item: PlanItem }[] };

/** Day list for < 1024px: days with outings plus today, Mon→Sun. `allDays` (print) keeps empty days too. */
export function dayRows(items: PlanItem[], today: Day, allDays = false): { rows: DayRow[]; unscheduled: PlanItem[] } {
  const { days, unscheduled } = placeOnWeek(items);
  const rows = days
    .map((d) => ({ day: d.day, isToday: d.day === today, outings: d.slots.flatMap((s) => s.items.map((item) => ({ slot: s.slot, item }))) }))
    .filter((r) => allDays || r.outings.length > 0 || r.isToday);
  return { rows, unscheduled };
}

// ─── U6 Profile rows (same rows as the onboarding review) ───

export const TIME_CHOICES: readonly { key: Profile["times"][number]; label: string }[] = [
  { key: "morning", label: "Mornings" },
  { key: "afternoon", label: "Afternoons" },
  { key: "evening", label: "Evenings" },
];
export const BUDGET_CHOICES: readonly { amount: number; label: string; detail: string }[] = [
  { amount: 0, label: "Free only", detail: "$0 a week" },
  { amount: 10, label: "A little", detail: "up to $10 a week" },
  { amount: 25, label: "Flexible", detail: "up to $25 a week" },
  { amount: 50, label: "Whatever's worth it", detail: "up to $50 a week" },
];

export type ProfileField =
  | "name" | "interests" | "times" | "maxTravelMin" | "mobility" | "transport" | "budgetPerWeek" | "hearingImpaired" | "prefersSmallGroups";
export type ProfileRow = { field: ProfileField; label: string; value: string; optional: boolean };

const labelsOf = <K extends string>(opts: readonly { key: K; label: string }[], keys: readonly K[]) =>
  opts.filter((o) => keys.includes(o.key)).map((o) => o.label).join(", ");

export function travelText(min: number): string {
  const b = TRAVEL_BUCKETS.find((x) => x.min === min);
  return b ? `${b.label} (${b.detail})` : `About ${min} minutes`;
}
export function budgetText(amount: number): string {
  const b = BUDGET_CHOICES.find((x) => x.amount === amount);
  return b ? `${b.label} (${b.detail})` : `Up to ${money(amount)} a week`;
}

/** Answers as plain rows. Labels match the onboarding review ("Here's what we heard"). */
export function profileRows(p: Profile): ProfileRow[] {
  return [
    { field: "name", label: "Name", value: p.name, optional: false },
    { field: "interests", label: "What you enjoy", value: labelsOf(INTEREST_META, p.interests), optional: false },
    { field: "times", label: "When you're free", value: labelsOf(TIME_CHOICES, p.times), optional: false },
    { field: "maxTravelMin", label: "How far", value: travelText(p.maxTravelMin), optional: false },
    { field: "mobility", label: "Walking aid", value: labelsOf(WALKING_AID_OPTIONS, [p.mobility]), optional: false },
    { field: "transport", label: "How you get places", value: labelsOf(TRANSPORT_OPTIONS, p.transport), optional: false },
    { field: "budgetPerWeek", label: "Weekly budget", value: budgetText(p.budgetPerWeek), optional: false },
    { field: "hearingImpaired", label: "Hearing help", value: p.hearingImpaired ? "Yes, hard of hearing" : "No", optional: true },
    { field: "prefersSmallGroups", label: "Small groups", value: p.prefersSmallGroups ? "Yes, prefers small groups" : "No preference", optional: true },
  ];
}

/** Why Save is blocked for a draft, or null when it can be saved. Never fills a missing answer in. */
export function draftProblem(p: Profile): string | null {
  if (p.interests.length === 0) return "Pick at least one thing you enjoy.";
  if (p.times.length === 0) return "Pick at least one time of day.";
  if (p.transport.length === 0) return "Pick at least one way you get places.";
  return null;
}

/** Blank name → "Friend" (same rule as onboarding). */
export const cleanName = (name: string) => name.trim().slice(0, 60) || "Friend";
