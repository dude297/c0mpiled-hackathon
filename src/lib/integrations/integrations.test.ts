import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichResult } from "./places";
import { calendarLink } from "./calendar";
import { rideshareFor } from "./rideshare";
import { discoverLumaEvents, parseLumaFeed } from "./luma";
import type { PlanItem } from "@/lib/schema";
const item: PlanItem = { activityId: "garden", name: "Berkeley Garden Walk", when: "Sat morning", travel: "bus", costPerWeek: 0, score: 1, barriers: [] };
const base = (plan = [item]) => ({ plan, blocked: [], evidence: [] });
const response = (data: unknown) => new Response(JSON.stringify(data));
const dates = Array.from({ length: 7 }, (_, i) => `2026-10-${17 + i}`);
const place = { id: "approved", displayName: { text: "Reviewed Garden" }, formattedAddress: "Berkeley, CA", location: { latitude: 37.88, longitude: -122.25 }, accessibilityOptions: { wheelchairAccessibleEntrance: true } };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-17T20:00:00Z"));
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test"); vi.stubEnv("UBER_API_TOKEN", "");
  vi.stubEnv("DAYBRIDGE_VENUE_PLACE_IDS", '{"garden":"approved"}');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("venue handoffs", () => {
  it.each([
    { ...place, id: "unrelated" },
    { ...place, location: { latitude: -33.8688, longitude: 151.2093 } },
    { ...place, location: { latitude: null, longitude: -122.25 } },
    { ...place, formattedAddress: "" },
  ])("rejects unmatched, distant, or incomplete venues", async (badPlace) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url.includes("places.googleapis") ? badPlace : {})));
    const result = await enrichResult(base());
    expect(result.venueByItem.garden).toBeNull(); expect(result.rideshareByItem.garden).toBeNull(); expect(result.evidence).toEqual([]);
  });
  it("does not search program names when no reviewed identity is configured", async () => {
    vi.stubEnv("DAYBRIDGE_VENUE_PLACE_IDS", "{}");
    const fetch = vi.fn(async (url: string) => { void url; return response({}); }); vi.stubGlobal("fetch", fetch);
    expect((await enrichResult(base())).venueByItem.garden).toBeNull();
    expect(fetch.mock.calls.every((args) => !String(args[0]).includes("places.googleapis"))).toBe(true);
  });
  it("creates links only for the matching local Place ID, keeping evidence unconfirmed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url.includes("places.googleapis") ? place : {})));
    const result = await enrichResult(base());
    expect(new URL(result.rideshareByItem.garden!.uberLink).searchParams.get("dropoff[latitude]")).toBe("37.88");
    expect(result.evidence[0].verified).toBe(false);
  });
  it("rejects invalid coordinates and malformed fare estimates", async () => {
    expect(await rideshareFor(item, { lat: NaN, lon: 0 }, "Garden")).toBeNull();
    vi.stubEnv("UBER_API_TOKEN", "test");
    vi.stubGlobal("fetch", vi.fn(async () => response({ prices: [{ low_estimate: null, high_estimate: 5, currency_code: "USD" }] })));
    expect((await rideshareFor(item, { lat: 37.88, lon: -122.25 }, "Garden"))!.estimate).toBeNull();
  });
});
describe("weather and calendar occurrence", () => {
  it("does not describe next Saturday outside the horizon as dry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ daily: { time: dates, weathercode: dates.map(() => 61) } })));
    expect((await enrichResult(base())).weather).toBeNull();
  });
  it.each([null, undefined, -1, 100, "0"])("treats invalid code %s as unknown", async (code) => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ daily: { time: dates, weathercode: [61, code] } })));
    expect((await enrichResult(base([{ ...item, when: "Sun morning" }]))).weather).toBeNull();
  });
  it("matches explicit dates rather than array weekday positions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ daily: { time: ["2026-10-18"], weathercode: [61] } })));
    expect((await enrichResult(base([{ ...item, when: "Sun morning" }]))).weather?.outdoorConcern).toBe(true);
  });
  it("uses LA calendar dates even across UTC midnight and month boundaries", () => {
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z")); // still Saturday in LA
    const params = new URL(calendarLink({ ...item, when: "Sun morning" })).searchParams;
    expect(params.get("dates")).toBe("20261101T100000/20261101T120000");
    expect(params.get("ctz")).toBe("America/Los_Angeles");
    expect(calendarLink({ ...item, when: "Bad slot" })).toBe("");
  });
});
const feed = (extra = "", url = "https://luma.com/public-event") => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:one\r\nSUMMARY:Community\\,\r\n  gathering\r\nDTSTART:20261018T170000Z\r\nDTEND:20261018T190000Z\r\nURL:${url}\r\n${extra}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
describe("public Luma discovery", () => {
  it("imports public future candidates without inventing feasibility", () => {
    const events = parseLumaFeed(feed()); expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "Community, gathering", source: "luma", verified: false, location: null });
    expect(events[0]).not.toHaveProperty("stepFree");
  });
  it.each(["STATUS:CANCELLED", "CLASS:PRIVATE", "RRULE:FREQ=WEEKLY", "DTSTART:invalid"])("skips unsupported/private events %s", (extra) => {
    expect(parseLumaFeed(feed(extra))).toEqual([]);
  });
  it("rejects untrusted event links and past events", () => {
    expect(parseLumaFeed(feed("", "https://evil.example"))).toEqual([]);
    expect(parseLumaFeed(feed(), new Date("2026-10-19"))).toEqual([]);
  });
  it("makes no network calls when disabled, and fails soft on provider failure", async () => {
    const fetch = vi.fn(async () => new Response("down", { status: 503 })); vi.stubGlobal("fetch", fetch);
    vi.stubEnv("DAYBRIDGE_LUMA", ""); expect((await discoverLumaEvents()).status).toBe("disabled"); expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("DAYBRIDGE_LUMA", "1"); expect((await discoverLumaEvents()).status).toBe("unavailable");
  });
  it("fetches the public city feed without credentials", async () => {
    const fetch = vi.fn(async (url: string) => { void url; return new Response(feed()); }); vi.stubGlobal("fetch", fetch); vi.stubEnv("DAYBRIDGE_LUMA", "1");
    expect((await discoverLumaEvents()).events).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toContain("entity=discover");
  });
});

describe("Luma parser and download regressions", () => {
  it("accepts repeated optional iCal properties", () => {
    expect(parseLumaFeed(feed("CATEGORIES:Arts\r\nCATEGORIES:Community\r\nATTENDEE:mailto:a@example.test\r\nATTENDEE:mailto:b@example.test"))).toHaveLength(1);
  });
  it("ignores nested alarm fields instead of overwriting the event", () => {
    const events = parseLumaFeed(feed("BEGIN:VALARM\r\nSUMMARY:Alarm\r\nURL:https://evil.example\r\nEND:VALARM"));
    expect(events).toHaveLength(1);
    expect(events[0].url).toBe("https://luma.com/public-event");
  });
  it.each([
    feed().replace("END:VCALENDAR", ""),
    feed().replace("END:VEVENT", ""),
    feed().replace("END:VEVENT", "END:VALARM"),
    feed() + "\r\n" + feed(),
  ])("rejects incomplete and misnested feeds", async (text) => {
    expect(parseLumaFeed(text)).toEqual([]);
    vi.stubEnv("DAYBRIDGE_LUMA", "1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(text)));
    expect((await discoverLumaEvents()).status).toBe("unavailable");
  });
  it("rejects duplicate required fields even with different parameters", () => {
    expect(parseLumaFeed(feed("DTSTART;TZID=America/Los_Angeles:20261018T100000"))).toEqual([]);
  });
  it("cancels oversized streamed bodies without relying on content-length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1_100_000).fill(65)); }, cancel,
    });
    vi.stubEnv("DAYBRIDGE_LUMA", "1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    expect((await discoverLumaEvents()).status).toBe("unavailable");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("keeps split multibyte UTF-8 characters intact", async () => {
    const encoded = new TextEncoder().encode(feed().replace("Community", "Café"));
    const split = encoded.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoded.slice(0, split)); controller.enqueue(encoded.slice(split)); controller.close();
    } });
    vi.stubEnv("DAYBRIDGE_LUMA", "1");
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.credentials).toBe("omit"); expect(options.referrerPolicy).toBe("no-referrer");
      expect(options.headers).toBeUndefined();
      return new Response(body);
    });
    vi.stubGlobal("fetch", fetch);
    expect((await discoverLumaEvents()).events[0].name).toBe("Café, gathering");
  });
});
