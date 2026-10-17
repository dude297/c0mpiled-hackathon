import type { EventCandidate } from "@/lib/integrations/events";

const localDay = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);

/** A regional public feed, never a personal fit score or an addition to the saved week. */
export function publicEventsToShow(events: EventCandidate[], compact: boolean, now = new Date()): EventCandidate[] {
  const cutoff = now.getTime() + 7 * 24 * 60 * 60_000;
  const seen = new Set<string>();
  return events.filter((event) => {
    const start = Date.parse(event.startsAt);
    const end = Date.parse(event.endsAt ?? event.startsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || event.proximity !== "local" || seen.has(event.id)) return false;
    const upcoming = event.allDay ? localDay(new Date(start)) >= localDay(now) : end > now.getTime();
    if (!upcoming || (compact && start >= cutoff)) return false;
    seen.add(event.id);
    return true;
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, compact ? 3 : 8);
}
