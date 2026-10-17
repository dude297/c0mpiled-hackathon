import type { PlanItem } from "@/lib/schema";

// Third-party enrichment for plan items. Every call is key-gated and fails soft:
// enrichment is additive, so the deterministic plan must never break.

export type VenueInfo = {
  name: string;
  address: string;
  stepFree: boolean | null;
  source: "google" | "none";
};

// Places API (New) — Text Search. Plain fetch, no SDK.
// Accessibility fields (wheelchairAccessibleEntrance) map to the engine's stepFree.
async function lookupVenue(name: string): Promise<VenueInfo | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.accessibilityOptions",
      },
      body: JSON.stringify({ textQuery: name, maxResultCount: 1 }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) throw new Error(`Places returned ${res.status}`);
    const data = await res.json();
    const place = data.places?.[0];
    if (!place) return null;
    return {
      name: place.displayName?.text ?? name,
      address: place.formattedAddress ?? "",
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
const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
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
    const idx = DAY_INDEX[day];
    if (idx === undefined || !rainy(codes[idx])) return { summary: `No rain forecast for ${day}.`, outdoorConcern: false };
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
  const evidence = [...result.evidence];
  for (const v of venueByItem.values()) {
    if (v?.source === "google" && v.stepFree !== null) {
      evidence.push({
        claim: `${v.name}: Google lists wheelchair-accessible entrance: ${v.stepFree ? "yes" : "no"}`,
        source: "google:places/accessibilityOptions",
        verified: true,
      });
    }
  }
  return { venueByItem: Object.fromEntries(venueByItem), weather, evidence };
}
