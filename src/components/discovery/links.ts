import { calendarLink } from "@/lib/integrations/calendar";
import { rideLinks } from "@/lib/integrations/ride-links";
import { nextOccurrenceDate } from "@/lib/integrations/schedule";
import type { EventCandidate } from "@/lib/integrations/events";
import type { VenueInfo } from "@/lib/integrations/places";
import type { PlanItem } from "@/lib/schema";

// Pure link builders for external handoffs. Every builder returns null when data is
// insufficient — the UI then renders nothing rather than a guessed link.

export const LABELS = {
  publicEvent: "Public event — not checked for fit",
  accessibility: "Accessibility unknown",
  ride: "Opens the app — not booked",
  approx: "approx. time",
  eventsOff: "Live public events are off in this demo",
} as const;

const SLOT_HOUR: Record<string, number> = { morning: 10, afternoon: 14, evening: 18 };

/** "Tue morning" → next LA date + approximate hour, or null when not concrete. */
export function nextPlanSlot(when: string, now = new Date()): { date: string; hour: number } | null {
  const [day, slot] = when.split(" ");
  const hour = SLOT_HOUR[slot];
  const date = hour === undefined ? null : nextOccurrenceDate(day, now);
  return date ? { date, hour } : null;
}

/** Google Calendar link for a plan item; needs a computable date AND a known venue address. */
export function planCalendarLink(item: PlanItem, venue: VenueInfo | null | undefined, now = new Date()): string | null {
  if (!venue?.address || !nextPlanSlot(item.when, now)) return null;
  const base = calendarLink(item); // #11 builder (LA timezone, slot hours)
  return base ? `${base}&${new URLSearchParams({ location: venue.address })}` : null;
}

/** Uber/Lyft deep links only when the venue has real coordinates. */
export function planRideLinks(venue: VenueInfo | null | undefined) {
  if (venue?.lat == null || venue.lon == null) return null;
  return rideLinks(venue.lat, venue.lon, venue.name);
}

const gcalUtc = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Google Calendar link for a public event; needs a concrete start time AND a location. */
export function eventCalendarLink(e: Pick<EventCandidate, "name" | "startsAt" | "endsAt" | "allDay" | "location" | "url">): string | null {
  if (!e.startsAt || e.allDay || !e.location) return null;
  const start = new Date(e.startsAt);
  if (!Number.isFinite(start.getTime())) return null;
  const end = e.endsAt ? new Date(e.endsAt) : new Date(start.getTime() + 3_600_000); // ponytail: 1h default when source gives no end
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.name,
    dates: `${gcalUtc(start.toISOString())}/${gcalUtc(end.toISOString())}`,
    location: e.location,
    details: `Public event found by DayBridge — not checked for fit. Source: ${e.url}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Maps link: provider coordinates first, else a text search for the listed place. */
export function eventMapsLink(e: Pick<EventCandidate, "mapLink" | "location">): string | null {
  if (e.mapLink) return e.mapLink;
  return e.location ? `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: e.location })}` : null;
}

export function relativeTime(iso: string | null, now = new Date()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "unknown";
  const min = Math.round((now.getTime() - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function formatEventTime(e: Pick<EventCandidate, "startsAt" | "allDay">): string {
  const opts: Intl.DateTimeFormatOptions = e.allDay
    ? { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" }
    : { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(e.startsAt)) + (e.allDay ? " (all day)" : "");
}
