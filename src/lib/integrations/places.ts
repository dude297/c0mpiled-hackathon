import { nextOccurrenceDate } from "./schedule";
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

// A search result is not a venue identity. Only operator-reviewed Place IDs
// bound to activity IDs may produce handoffs. Unknown activities fail closed.
const DEMO_AREA = { lat: 37.8715, lon: -122.273, radiusM: 20_000 };

async function lookupVenue(activityId: string, signal?: AbortSignal): Promise<VenueInfo | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const configured: unknown = JSON.parse(process.env.DAYBRIDGE_VENUE_PLACE_IDS ?? "{}");
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) return null;
    const placeId = Object.hasOwn(configured, activityId)
      ? (configured as Record<string, unknown>)[activityId] : undefined;
    if (typeof placeId !== "string" || !/^[A-Za-z0-9_-]+$/.test(placeId)) return null;
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,accessibilityOptions,location",
      },
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const place = await res.json();
    const lat = place?.location?.latitude;
    const lon = place?.location?.longitude;
    if (place?.id !== placeId || typeof place?.displayName?.text !== "string" ||
        !place.displayName.text.trim() || typeof place.formattedAddress !== "string" ||
        !place.formattedAddress.trim() || !isLocalCoordinate(lat, lon)) return null;
    return {
      name: place.displayName.text,
      address: place.formattedAddress,
      lat, lon,
      stepFree: typeof place.accessibilityOptions?.wheelchairAccessibleEntrance === "boolean"
        ? place.accessibilityOptions.wheelchairAccessibleEntrance : null,
      source: "google",
    };
  } catch {
    return null;
  }
}

export function isLocalCoordinate(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== "number" || typeof lon !== "number" ||
      !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  const radians = (value: number) => value * Math.PI / 180;
  const a = Math.sin(radians(lat - DEMO_AREA.lat) / 2) ** 2 +
    Math.cos(radians(DEMO_AREA.lat)) * Math.cos(radians(lat)) *
    Math.sin(radians(lon - DEMO_AREA.lon) / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= DEMO_AREA.radiusM;
}

export type WeatherNote = { summary: string; outdoorConcern: boolean } | null;

// Open-Meteo — free, no key. Only flags a concern; never changes the plan.
// Match the scheduled occurrence against the provider's explicit forecast dates.
const OUTDOOR_KEYWORDS = /\b(garden|walk|walkers|walking)\b/i;

async function lookupWeather(items: PlanItem[], signal?: AbortSignal): Promise<WeatherNote> {
  try {
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=37.8715&longitude=-122.273&daily=weathercode&timezone=America/Los_Angeles&forecast_days=7",
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000) },
    );
    if (!res.ok) throw new Error(`Weather returned ${res.status}`);
    const data = await res.json();
    const codes: unknown = data?.daily?.weathercode;
    const dates: unknown = data?.daily?.time;
    if (!Array.isArray(codes) || !Array.isArray(dates)) return null;
    const outdoorItem = items.find((i) => OUTDOOR_KEYWORDS.test(i.name));
    if (!outdoorItem) return null;
    const day = outdoorItem.when.split(" ")[0];
    const occurrence = nextOccurrenceDate(day);
    if (!occurrence) return null;
    const index = dates.indexOf(occurrence);
    if (index < 0) return null;
    const code = codes[index];
    const validCodes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
    if (typeof code !== "number" || !validCodes.includes(code)) return null;
    // Snow/ice are also outdoor concerns, rather than a misleading dry-weather note.
    if (code < 51) return { summary: `No precipitation forecast for ${day}.`, outdoorConcern: false };
    return { summary: `Precipitation forecast ${day} — ${outdoorItem.name} may move indoors; the venue can confirm.`, outdoorConcern: true };
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
}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const [venues, weather] = await Promise.all([
    Promise.all(result.plan.map((i) => lookupVenue(i.activityId, signal))),
    lookupWeather(result.plan, signal),
  ]);
  signal?.throwIfAborted();
  const venueByItem = new Map<string, VenueInfo | null>();
  result.plan.forEach((i, idx) => venueByItem.set(i.activityId, venues[idx] ?? null));
  // Estimates run in parallel — sequential awaits would cost up to 4 s per item against the shared request budget.
  const rideshareByItem: Record<string, Awaited<ReturnType<typeof rideshareFor>>> = {};
  const rides = await Promise.all(
    result.plan.map((item, idx) => {
      const venue = venues[idx];
      return rideshareFor(
        item,
        venue?.lat != null && venue?.lon != null ? { lat: venue.lat, lon: venue.lon } : null,
        venue?.name ?? item.name,
        signal,
      );
    }),
  );
  result.plan.forEach((item, idx) => { rideshareByItem[item.activityId] = rides[idx] ?? null; });
  // Google's accessibilityOptions are crowd-sourced: report as unconfirmed, never as verified.
  const evidence = [...result.evidence];
  for (const v of venueByItem.values()) {
    if (v?.source === "google" && v.stepFree !== null) {
      evidence.push({
        claim: `Google says ${v.name} ${v.stepFree ? "reports a wheelchair-accessible entrance" : "does not report a wheelchair-accessible entrance"} — unconfirmed by the venue`,
        source: "google:places/accessibilityOptions",
        verified: false,
      });
    }
  }
  return { venueByItem: Object.fromEntries(venueByItem), weather, evidence, rideshareByItem };
}
