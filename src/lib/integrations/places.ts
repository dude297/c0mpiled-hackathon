import type { PlanItem } from "@/lib/schema";
import { rideshareFor } from "./rideshare";

// Third-party enrichment for plan items. Every call is key-gated and fails soft:
// enrichment is additive, so the deterministic plan must never break.

export type VenueInfo = {
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  stepFree: boolean | null;
  source: "google" | "none";
};

// Demo area (Berkeley). locationBias keeps the search from matching venues
// with the same name anywhere in the world.
const DEMO_AREA = { lat: 37.8715, lon: -122.273, radiusM: 20_000 };

// Places API (New) — Text Search. Plain fetch, no SDK.
// Accessibility fields are crowd-sourced: we report them as unconfirmed.
async function lookupVenue(name: string): Promise<VenueInfo | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.accessibilityOptions,places.location",
      },
      body: JSON.stringify({
        textQuery: name,
        maxResultCount: 1,
        locationBias: {
          circle: {
            center: { latitude: DEMO_AREA.lat, longitude: DEMO_AREA.lon },
            radius: DEMO_AREA.radiusM,
          },
        },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) throw new Error(`Places returned ${res.status}`);
    const data = await res.json();
    const place = data.places?.[0];
    if (!place) return null;
    return {
      name: place.displayName?.text ?? name,
      address: place.formattedAddress ?? "",
      lat: typeof place.location?.latitude === "number" ? place.location.latitude : null,
      lon: typeof place.location?.longitude === "number" ? place.location.longitude : null,
      stepFree: typeof place.accessibilityOptions?.wheelchairAccessibleEntrance === "boolean"
        ? place.accessibilityOptions.wheelchairAccessibleEntrance
        : null,
      source: "google",
    };
  } catch (e) {
    console.error("Places lookup failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type WeatherNote = { summary: string; outdoorConcern: boolean } | null;

// Open-Meteo — free, no key. Only flags a concern; never changes the plan.
// The daily forecast starts at today, so index by days-from-today, not weekday name.
const DAY_OFFSET: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const OUTDOOR_KEYWORDS = /\bgarden|walk\b/i;

async function lookupWeather(items: PlanItem[]): Promise<WeatherNote> {
  try {
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=37.8715&longitude=-122.273&daily=weathercode&timezone=America/Los_Angeles&forecast_days=7",
      { signal: AbortSignal.timeout(4_000) },
    );
    if (!res.ok) throw new Error(`Weather returned ${res.status}`);
    const data = await res.json();
    const codes: number[] = data?.daily?.weathercode;
    if (!Array.isArray(codes)) return null;
    // WMO codes: 51-67, 80-82, 95+ = rain/showers/thunderstorms
    const rainy = (code: number) => code >= 51 && code <= 67 || code >= 80 && code <= 82 || code >= 95;
    const outdoorItem = items.find((i) => OUTDOOR_KEYWORDS.test(i.name));
    if (!outdoorItem) return null;
    const day = outdoorItem.when.split(" ")[0];
    const targetDow = DAY_OFFSET[day];
    if (targetDow === undefined) return null;
    // days from today until the activity's weekday, in the forecast's timezone
    const todayName = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles", weekday: "short",
    }).format(new Date());
    const todayDow = DAY_OFFSET[todayName];
    if (todayDow === undefined) return null;
    const daysFromToday = (targetDow - todayDow + 7) % 7 || 7;
    const code = codes[daysFromToday];
    if (code === undefined || !rainy(code)) return { summary: `No rain forecast for ${day}.`, outdoorConcern: false };
    return { summary: `Rain forecast ${day} — ${outdoorItem.name} may move indoors; the venue can confirm.`, outdoorConcern: true };
  } catch (e) {
    console.error("Weather lookup failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// Enriches an AnalysisResult without changing plan/blocked/evidence shape.
export async function enrichResult(result: {
  plan: PlanItem[];
  blocked: { name: string }[];
  evidence: { claim: string; source: string; verified: boolean }[];
}) {
  const [venues, weather] = await Promise.all([
    Promise.all(result.plan.map((i) => lookupVenue(i.name))),
    lookupWeather(result.plan),
  ]);
  const venueByItem = new Map<string, VenueInfo | null>();
  result.plan.forEach((i, idx) => venueByItem.set(i.activityId, venues[idx] ?? null));
  const rideshareByItem: Record<string, Awaited<ReturnType<typeof rideshareFor>>> = {};
  for (let idx = 0; idx < result.plan.length; idx++) {
    const item = result.plan[idx];
    const venue = venues[idx];
    rideshareByItem[item.activityId] = await rideshareFor(
      item,
      venue?.lat != null && venue?.lon != null ? { lat: venue.lat, lon: venue.lon } : null,
      venue?.name ?? item.name,
    );
  }
  // Google's accessibilityOptions are crowd-sourced: report as unconfirmed, never as verified.
  const evidence = [...result.evidence];
  for (const v of venueByItem.values()) {
    if (v?.source === "google" && v.stepFree !== null) {
      evidence.push({
        claim: `Google says ${v.name} has a ${v.stepFree ? "wheelchair-accessible" : "step"} entrance — unconfirmed by the venue`,
        source: "google:places/accessibilityOptions",
        verified: false,
      });
    }
  }
  return { venueByItem: Object.fromEntries(venueByItem), weather, evidence, rideshareByItem };
}
