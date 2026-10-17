import type { PlanItem } from "@/lib/schema";

// "Add to Google Calendar" without OAuth: build a template web link per plan item.
// Zero packages, works instantly, nothing stored.
// Google expects local times as YYYYMMDDTHHMMSS (no timezone suffix) plus a ctz hint,
// so we build the date from local calendar parts instead of toISOString (UTC-shifted).

const DAY_TO_OFFSET: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
const TZ = "America/Los_Angeles";

function nextLocalPartsFor(day: string): { y: string; m: string; d: string } {
  const now = new Date();
  const target = new Date(now);
  const offset = (DAY_TO_OFFSET[day] - now.getDay() + 7) % 7 || 7;
  target.setDate(now.getDate() + offset);
  return {
    y: String(target.getFullYear()),
    m: String(target.getMonth() + 1).padStart(2, "0"),
    d: String(target.getDate()).padStart(2, "0"),
  };
}

function slotHours(slot: string): { start: number; end: number } {
  const start = slot === "morning" ? 10 : slot === "afternoon" ? 14 : 18;
  return { start, end: start + 2 };
}

const hhmmss = (h: number) => `${String(h).padStart(2, "0")}0000`;

export function calendarLink(item: PlanItem): string {
  const [day, slot] = item.when.split(" ");
  const { y, m, d } = nextLocalPartsFor(day);
  const { start, end } = slotHours(slot);
  const date = `${y}${m}${d}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.name,
    dates: `${date}T${hhmmss(start)}/${date}T${hhmmss(end)}`,
    ctz: TZ,
    details: `Planned by DayBridge. Travel: ${item.travel}. Cost: $${item.costPerWeek}/week.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
