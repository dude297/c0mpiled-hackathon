import type { CoordinationPlan } from "@/lib/schema";
import type { Upcoming } from "./contract";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar date + weekday of `now` as seen in `timeZone`. */
export function localDate(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday: DAYS.indexOf(parts.weekday) };
}

/** Next occurrence (today counts) of `day` ("Sun".."Sat") in the person's time zone, as YYYY-MM-DD. */
export function nextDateFor(day: string, timeZone: string, now: Date): string | null {
  const target = DAYS.indexOf(day);
  if (target < 0) return null;
  const t = localDate(now, timeZone);
  // Pure calendar arithmetic on the local date: DST shifts cannot move it.
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d + ((target - t.weekday + 7) % 7)));
  return d.toISOString().slice(0, 10);
}

const OPEN = (p: CoordinationPlan) => p.state !== "COMPLETED" && p.state !== "CANCELLED";

export function upcomingFor(plans: CoordinationPlan[], timeZone: string, now: Date): Upcoming[] {
  return plans
    .filter(OPEN)
    .flatMap((p) => {
      const nextDate = nextDateFor(p.when.split(" ")[0] ?? "", timeZone, now);
      return nextDate ? [{ planId: p.id, activityName: p.activityName, slot: p.when, nextDate, timezone: timeZone, state: p.state }] : [];
    })
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.planId.localeCompare(b.planId));
}
