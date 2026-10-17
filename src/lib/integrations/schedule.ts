export const PLAN_TIMEZONE = "America/Los_Angeles";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Recurring demo slots mean the next weekday, strictly after today's LA date.
// UTC arithmetic here operates on calendar dates, not the host's local timezone.
export function nextOccurrenceDate(day: string, now = new Date()): string | null {
  const targetDay = DAYS.indexOf(day);
  if (targetDay < 0) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PLAN_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((targetDay - date.getUTCDay() + 7) % 7 || 7));
  return date.toISOString().slice(0, 10);
}
