import type { PlanItem } from "@/lib/schema";

// "Add to Google Calendar" without OAuth: build a template web link per plan item.
// Zero packages, works instantly, nothing stored.

const DAY_TO_OFFSET: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

function nextDateFor(day: string): string {
  const now = new Date();
  const target = new Date(now);
  const offset = (DAY_TO_OFFSET[day] - now.getDay() + 7) % 7 || 7;
  target.setDate(now.getDate() + offset);
  return target.toISOString().slice(0, 10).replace(/-/g, "");
}

function slotWindow(slot: string): { start: string; end: string } {
  const startHour = slot === "morning" ? 10 : slot === "afternoon" ? 14 : 18;
  const fmt = (h: number) => `${String(h % 12 || 12).padStart(2, "0")}${h < 12 ? "00AM" : "00PM"}`;
  return { start: fmt(startHour), end: fmt(startHour + 2) };
}

export function calendarLink(item: PlanItem): string {
  const [day, slot] = item.when.split(" ");
  const date = nextDateFor(day);
  const { start, end } = slotWindow(slot);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.name,
    dates: `${date}T${start}/${date}T${end}`,
    details: `Planned by DayBridge. Travel: ${item.travel}. Cost: $${item.costPerWeek}/week.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
