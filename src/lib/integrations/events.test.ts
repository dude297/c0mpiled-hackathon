import { afterEach, expect, it, vi } from "vitest";
import { parsePublicEvents } from "./events";
const now = new Date("2026-10-17T20:00:00Z");
const entry = { id: 1, title: "Arts &amp; Community", url: "https://events.berkeley.edu/live/events/1", date_iso: "2026-10-18T10:00:00-07:00", location: "Community Room", location_latitude: 37.87, location_longitude: -122.26 };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });
it("normalizes source events without inventing feasibility", () => {
  const event = parsePublicEvents({ data: [entry] }, now)![0];
  expect(new URL(event.mapLink!).searchParams.get("query")).toBe("37.87,-122.26");
  const directions = new URL(event.directionsLink!);
  expect(directions.searchParams.get("destination")).toBe("37.87,-122.26");
  expect(directions.searchParams.has("origin")).toBe(false);
  expect(directions.searchParams.has("key")).toBe(false);
  expect(event).toMatchObject({ name: "Arts & Community", startsAt: "2026-10-18T17:00:00.000Z", proximity: "local", accessibility: "unknown", cost: "unknown", eligibility: "check-source", verified: false });
});
it("keeps today's all-day events and unknown locations honestly labeled", () => {
  const result = parsePublicEvents({ data: [{ ...entry, is_all_day: 1, date_iso: "2026-10-17T00:00:00-07:00", location_latitude: null, location_longitude: null }] }, now);
  expect(result?.[0]).toMatchObject({ allDay: true, proximity: "unknown", mapLink: null, directionsLink: null });
});
it.each([
  { is_canceled: 1 }, { is_online: 1 }, { date_iso: "2026-10-16T10:00:00-07:00" },
  { location_latitude: -33.8, location_longitude: 151.2 }, { url: "https://evil.example/event" },
  { date_iso: "invalid" }, { date2_iso: "2026-10-17T10:00:00-07:00" },
])("rejects unusable event %j", (change) => {
  expect(parsePublicEvents({ data: [{ ...entry, ...change }] }, now)).toEqual([]);
});
it("distinguishes malformed payloads from a real empty feed", () => {
  expect(parsePublicEvents({}, now)).toBeNull(); expect(parsePublicEvents({ data: [] }, now)).toEqual([]);
});
it("coalesces calls, caches for five minutes, and sends no profile or credentials", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    expect(options.credentials).toBe("omit"); expect(options.headers).toBeUndefined(); expect(options.body).toBeUndefined();
    return Response.json({ data: [entry] });
  });
  vi.stubGlobal("fetch", fetch);
  const { discoverPublicEvents } = await import("./events");
  const results = await Promise.all([discoverPublicEvents(), discoverPublicEvents()]);
  expect(results[0].status).toBe("live"); expect(fetch).toHaveBeenCalledTimes(1);
  await discoverPublicEvents(); expect(fetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(300_001); await discoverPublicEvents(); expect(fetch).toHaveBeenCalledTimes(2);
});
it("fails soft without substituting mock events", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
  const { discoverPublicEvents } = await import("./events");
  expect(await discoverPublicEvents()).toMatchObject({ status: "unavailable", events: [], checkedAt: null });
});
