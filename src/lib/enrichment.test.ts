import { describe, expect, it } from "vitest";
import { AnalysisResult, Provenance, RideshareOption, VenueInfo, WeatherNote } from "@/lib/schema";

// Samples are #11 (intg/third-party @ 41ed0a7) outputs mapped per ENRICHMENT_CONTRACT.md. No network.
const fetchedAt = "2026-10-17T18:00:00.000Z";
const live = (provider: string) => ({ source: "live", provider, fetchedAt, verified: false }) as const;

const base = { summary: "s", items: [], plan: [], blocked: [], evidence: [], explanation: "x", dataSource: "mock" } as const;

// places.ts lookupVenue: { name, address, lat, lon, stepFree, source: "google" }
const venue = {
  name: "Berkeley Rose Garden",
  address: "1200 Euclid Ave, Berkeley, CA 94708",
  lat: 37.8855,
  lng: -122.2626, // was `lon`
  accessibility: { wheelchairEntrance: null }, // was `stepFree`
  provenance: live("google-places"), // was `source: "google"`
};

// places.ts lookupWeather: { summary, outdoorConcern } — now with the occurrence date.
const weather = {
  date: "2026-10-20",
  summary: "Precipitation forecast Tue — Garden club may move indoors; the venue can confirm.",
  outdoorConcern: true,
  provenance: live("open-meteo"),
};

// rideshare.ts: { uberLink, lyftLink, estimate: { fareLow, fareHigh, currency, source: "uber" } } → one option per provider.
const uber = {
  provider: "uber",
  deepLink: "https://m.uber.com/ul/?action=setPickup&dropoff%5Blatitude%5D=37.8855",
  fare: { low: 12, high: 16, currency: "USD" },
  pickupLabel: "Berkeley Civic Center (demo)",
  notBooked: true,
  provenance: { source: "estimate", provider: "uber", fetchedAt, verified: false },
};
const lyft = {
  provider: "lyft",
  deepLink: "https://lyft.com/ride?id=lyft&destination%5Blatitude%5D=37.8855",
  pickupLabel: "Berkeley Civic Center (demo)",
  notBooked: true,
  provenance: live("google-places"), // link built from venue coordinates; no fare fetched
};

describe("enrichment contract", () => {
  it("base result without enrichment still parses (all fields optional)", () => {
    expect(AnalysisResult.parse(base)).toEqual(base);
  });

  it("parses a full enriched result shaped like #11's outputs", () => {
    const r = AnalysisResult.parse({
      ...base,
      venueByItem: { "garden-club": venue },
      weather,
      rideshareByItem: { "garden-club": [uber, lyft] },
      enrichment: { enabled: true, budgetMs: 1000, timedOut: false },
    });
    expect(r.venueByItem?.["garden-club"].provenance.provider).toBe("google-places");
    expect(r.rideshareByItem?.["garden-club"]).toHaveLength(2);
    expect(r.rideshareByItem?.["garden-club"].every((o) => o.pickupLabel.includes("(demo)"))).toBe(true);
  });

  it("accepts weather: null (no data) and a timed-out enrichment", () => {
    const r = AnalysisResult.parse({ ...base, weather: null, enrichment: { enabled: true, budgetMs: 1000, timedOut: true } });
    expect(r.weather).toBeNull();
  });

  it("rejects verified: true on any third-party provenance", () => {
    expect(Provenance.safeParse({ ...live("google-places"), verified: true }).success).toBe(false);
    expect(VenueInfo.safeParse({ ...venue, provenance: { ...venue.provenance, verified: true } }).success).toBe(false);
  });

  it("rejects weather without a date", () => {
    const { date: _date, ...noDate } = weather;
    expect(WeatherNote.safeParse(noDate).success).toBe(false);
    expect(WeatherNote.safeParse({ ...weather, date: "Tue" }).success).toBe(false);
  });

  it("rejects rideshare without notBooked: true", () => {
    const { notBooked: _nb, ...noFlag } = uber;
    expect(RideshareOption.safeParse(noFlag).success).toBe(false);
    expect(RideshareOption.safeParse({ ...uber, notBooked: false }).success).toBe(false);
  });

  it("rejects #11's current raw shapes until mapped", () => {
    const raw = { name: "x", address: "y", lat: 1, lon: 2, stepFree: true, source: "google" };
    expect(VenueInfo.safeParse(raw).success).toBe(false); // no provenance
    expect(AnalysisResult.safeParse({ ...base, rideshareByItem: { a: { uberLink: "https://m.uber.com/ul/", lyftLink: "https://lyft.com/ride" } } }).success).toBe(false);
    expect(AnalysisResult.safeParse({ ...base, enrichment: { enabled: true, budgetMs: 4000, timedOut: false } }).success).toBe(false);
  });
});
