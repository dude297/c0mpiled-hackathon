import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EventCandidate } from "@/lib/integrations/events";
import { PublicListingCards } from "./AppDiscovery";
import { publicEventsToShow } from "./discovery-model";

const NOW = new Date("2026-10-17T19:00:00Z");
const event = (id: string, startsAt = "2026-10-18T19:00:00Z", extra: Partial<EventCandidate> = {}): EventCandidate => ({
  id, name: `Fixture listing ${id}`, url: "https://events.berkeley.edu/event/12345", startsAt,
  endsAt: "2026-10-18T20:00:00Z", mapLink: null, directionsLink: null, uberLink: null, lyftLink: null,
  allDay: false, location: "Fixture venue", proximity: "local", tags: [], source: "uc-berkeley",
  verified: false, checkedAt: "2026-10-17T18:58:00Z", accessibility: "unknown", cost: "unknown", eligibility: "check-source", ...extra,
});

describe("public discovery window", () => {
  it("keeps upcoming local candidates separate from expired, unlocated and later listings on Home", () => {
    const listings = [
      event("later", "2026-10-25T19:00:00Z", { endsAt: "2026-10-25T20:00:00Z" }),
      event("near"), event("unknown-location", undefined, { proximity: "unknown" }),
      event("expired", "2026-10-16T19:00:00Z", { endsAt: "2026-10-16T20:00:00Z" }),
      event("invalid", "not-a-date"),
    ];
    expect(publicEventsToShow(listings, true, NOW).map((item) => item.id)).toEqual(["near"]);
    expect(publicEventsToShow(listings, false, NOW).map((item) => item.id)).toEqual(["near", "later"]);
    expect(listings[0].id).toBe("later"); // Selection never reorders or changes source data.
  });

  it("includes an event already in progress and today's all-day event in Pacific time", () => {
    const listings = [
      event("ongoing", "2026-10-17T18:00:00Z", { endsAt: "2026-10-17T20:00:00Z" }),
      event("all-day", "2026-10-17T07:00:00Z", { allDay: true, endsAt: null }),
      event("old-day", "2026-10-16T07:00:00Z", { allDay: true, endsAt: null }),
    ];
    expect(publicEventsToShow(listings, true, NOW).map((item) => item.id)).toEqual(["all-day", "ongoing"]);
  });

  it("deduplicates before limiting the compact and full feeds", () => {
    const listings = [event("0"), ...Array.from({ length: 10 }, (_, i) => event(String(i)))];
    expect(publicEventsToShow(listings, true, NOW).map((item) => item.id)).toEqual(["0", "1", "2"]);
    expect(publicEventsToShow(listings, false, NOW)).toHaveLength(8);
  });
});

describe("public discovery actions and provenance", () => {
  it("keeps unknowns visible and has no personal-match, booking or add-to-week action", () => {
    const html = renderToStaticMarkup(createElement(PublicListingCards, { events: [event("a")], compact: true }));
    expect(html).toContain("Details via UC Berkeley events");
    expect(html).toContain("Cost, accessibility and eligibility:");
    expect(html).toContain("Unknown — call ahead");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("Add to my week");
    expect(html).not.toContain("/coordinate");
    expect(html).not.toContain("Google Calendar");
  });

  it("offers existing Maps and Calendar handoffs only with their necessary known facts", () => {
    const html = renderToStaticMarkup(createElement(PublicListingCards, { events: [event("a")], compact: false }));
    expect(html).toContain("Add to Google Calendar");
    expect(html).toContain("Open in Maps");
    expect(html).toContain("opens in new tab");
    const unknown = renderToStaticMarkup(createElement(PublicListingCards, {
      events: [event("b", undefined, { location: null, endsAt: null })], compact: false,
    }));
    expect(unknown).toContain("Location: Unknown — call ahead");
    expect(unknown).not.toContain("Google Calendar");
    expect(unknown).not.toContain("Open in Maps");
    const noEnd = renderToStaticMarkup(createElement(PublicListingCards, { events: [event("c", undefined, { endsAt: null })], compact: false }));
    expect(noEnd).not.toContain("Google Calendar"); // Never guess a duration.
  });
});
