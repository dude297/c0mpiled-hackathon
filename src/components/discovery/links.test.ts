import { describe, expect, it } from "vitest";
import { LABELS, eventCalendarLink, eventMapsLink, nextPlanSlot, planCalendarLink, planRideLinks, relativeTime } from "./links";
import type { PlanItem } from "@/lib/schema";

const NOW = new Date("2026-10-17T19:00:00Z"); // Sat Oct 17, LA noon
const item: PlanItem = { activityId: "a", name: "Choir", when: "Tue morning", travel: "bus 20 min", costPerWeek: 0, score: 1, barriers: [] };
const venue = { name: "Hall", address: "1 Main St, Berkeley", lat: 37.87, lon: -122.27, stepFree: null, source: "google" as const };
const ev = { name: "Talk", startsAt: "2026-10-20T01:00:00.000Z", endsAt: null, allDay: false, location: "Doe Library", url: "https://events.berkeley.edu/x", mapLink: null };

describe("nextPlanSlot", () => {
  it("computes the next weekday occurrence with slot hour", () => {
    expect(nextPlanSlot("Tue morning", NOW)).toEqual({ date: "2026-10-20", hour: 10 });
    expect(nextPlanSlot("Sat evening", NOW)).toEqual({ date: "2026-10-24", hour: 18 }); // strictly after today
  });
  it("returns null for vague schedules", () => {
    expect(nextPlanSlot("Weekly", NOW)).toBeNull();
    expect(nextPlanSlot("Tue lunch", NOW)).toBeNull();
  });
});

describe("plan handoffs", () => {
  it("calendar needs a date and a venue address", () => {
    expect(planCalendarLink(item, venue, NOW)).toContain("location=1+Main+St");
    expect(planCalendarLink(item, null, NOW)).toBeNull();
    expect(planCalendarLink(item, { ...venue, address: "" }, NOW)).toBeNull();
    expect(planCalendarLink({ ...item, when: "Flexible" }, venue, NOW)).toBeNull();
  });
  it("rides need coordinates", () => {
    expect(planRideLinks(venue)?.uberLink).toContain("m.uber.com");
    // Uber forwards "+" verbatim into the app; spaces must be %20.
    expect(planRideLinks({ ...venue, name: "Doe Library" })?.uberLink).toContain("Doe%20Library");
    expect(planRideLinks({ ...venue, name: "Doe Library" })?.uberLink).not.toContain("+");
    expect(planRideLinks({ ...venue, lat: null })).toBeNull();
    expect(planRideLinks(undefined)).toBeNull();
  });
});

describe("event handoffs", () => {
  it("calendar needs start time and location", () => {
    expect(eventCalendarLink(ev)).toContain("dates=20261020T010000Z%2F20261020T020000Z");
    expect(eventCalendarLink({ ...ev, location: null })).toBeNull();
    expect(eventCalendarLink({ ...ev, allDay: true })).toBeNull();
  });
  it("maps prefers provider link, else location search, else null", () => {
    expect(eventMapsLink({ mapLink: "https://maps/x", location: "A" })).toBe("https://maps/x");
    expect(eventMapsLink({ mapLink: null, location: "Doe Library" })).toContain("Doe+Library");
    expect(eventMapsLink({ mapLink: null, location: null })).toBeNull();
  });
});

it("labels stay honest", () => {
  expect(LABELS.ride).toContain("not booked");
  expect(LABELS.publicEvent).toContain("not checked");
  expect(Object.values(LABELS).join(" ")).not.toMatch(/match|confirmed|recommended/i);
});

it("relativeTime", () => {
  expect(relativeTime("2026-10-17T18:55:00Z", NOW)).toBe("5 min ago");
  expect(relativeTime(null, NOW)).toBe("unknown");
});
