import { nextOccurrenceDate, PLAN_TIMEZONE } from "./schedule";
import type { PlanItem } from "@/lib/schema";

// "Add to Google Calendar" without OAuth: build a template web link per plan item.
// Zero packages, works instantly, nothing stored.
// Google expects local times as YYYYMMDDTHHMMSS (no timezone suffix) plus a ctz hint,
// so we build the date from local calendar parts instead of toISOString (UTC-shifted).

function slotHours(slot: string): { start: number; end: number } {
  const start = slot === "morning" ? 10 : slot === "afternoon" ? 14 : 18;
  return { start, end: start + 2 };
}

const hhmmss = (h: number) => `${String(h).padStart(2, "0")}0000`;

export function calendarLink(item: PlanItem): string {
  const [day, slot] = item.when.split(" ");
  const occurrence = nextOccurrenceDate(day);
  if (!occurrence || !["morning", "afternoon", "evening"].includes(slot)) return "";
  const { start, end } = slotHours(slot);
  const date = occurrence.replaceAll("-", "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.name,
    dates: `${date}T${hhmmss(start)}/${date}T${hhmmss(end)}`,
    ctz: PLAN_TIMEZONE,
    details: `Planned by DayBridge. Travel: ${item.travel}. Cost: $${item.costPerWeek}/week.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
