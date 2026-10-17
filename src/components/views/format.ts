// Plain-words formatting for U3 Matches, U4 Calendar and U6 Profile. Pure: unit-tested in format.test.ts.
import { DAYS, placeOnWeek, type Day, type Slot } from "@/components/calendar/WeekCalendar";
import { DAY_NAMES, costWords, money, softBarrierText, weekItems } from "@/components/home/home-model";
import { INTEREST_META, TRANSPORT_OPTIONS, TRAVEL_BUCKETS, WALKING_AID_OPTIONS } from "@/components/onboarding/CardDeck";
import type { Barrier, PlanItem, Profile } from "@/lib/schema";
import { NO_NAME, barrierText, realName, travelPlain, whenText } from "./copy";

// Day names, mode words, cost and the week list are shared with Home / Activity (home-model) so every screen says the same thing.
// Engine strings become plain words in copy.ts (one place, unit-tested).
export { DAY_NAMES, weekItems, travelPlain };
export const SLOT_WORDS: Record<Slot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

/** "Free" or "$5 a week". */
export const costPlain = costWords;

/** One meta line for a match card: "Wednesday afternoon · Bus, about 15 min · Free". */
export const metaLine = (item: PlanItem) => [whenText(item.when), travelPlain(item.travel).text, costPlain(item.costPerWeek)].join(" · ");

/** A soft barrier in plain words: what to expect + what helps (same words as Home and Activity). */
export const headsUpText = softBarrierText;

/** First soft barrier as the card's single heads-up row, and how many more there are (shown on the details page). */
export function cardHeadsUp(item: PlanItem): { first: Barrier | null; more: number } {
  const soft = item.barriers.filter((b) => b.severity === "soft");
  return { first: soft[0] ?? null, more: Math.max(0, soft.length - 1) };
}

/** First hard reason an activity didn't fit, in plain words ("Costs $20 a week, over your $10 budget"). `person` = real name or null. */
export function didntFitReason(barriers: Barrier[], person: string | null = null): string {
  const b = barriers.find((x) => x.severity === "hard");
  return b ? barrierText(b, person) : `Didn't fit ${person ? `${person}'s` : "your"} answers`;
}

/** Matches not yet in the week first; otherwise the engine's order. */
export function sortMatches(plan: PlanItem[], week: readonly string[]): PlanItem[] {
  const inWeek = new Set(week);
  return [...plan.filter((i) => !inWeek.has(i.activityId)), ...plan.filter((i) => inWeek.has(i.activityId))];
}

export const didntFitLabel = (n: number) => `${n} ${n === 1 ? "activity" : "activities"} didn't fit — see why`;

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
    { field: "name", label: "Name", value: realName(p.name) ?? "Not given", optional: false },
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

/** Blank name is stored as the onboarding fallback (the schema needs one); screens never show it (see copy.ts realName). */
export const cleanName = (name: string) => name.trim().slice(0, 60) || NO_NAME;
