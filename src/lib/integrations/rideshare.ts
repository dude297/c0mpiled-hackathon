import type { PlanItem } from "@/lib/schema";

// Rideshare integration for plan items.
// Tier 1 (always on): deep links that open the Uber/Lyft app with the destination
//   pre-filled. No keys, no packages, no server calls.
// Tier 2 (key-gated): real fare estimates via the Uber Estimates API. Fails soft.

export type RideshareInfo = {
  // Deep links — constructed, never fetched.
  uberLink: string;
  lyftLink: string;
  // Real estimates — only present when UBER_API_TOKEN is set and the API responds.
  estimate?: { fareLow: number; fareHigh: number; currency: string; source: "uber" } | null;
} | null;

// Berkeley Civic Center as the demo pickup. Honest labeling: the pickup is a fixed demo
// point, not the user's home, and a deep link is a handoff to tap — not a booking.
const DEFAULT_ORIGIN = { lat: 37.8715, lon: -122.273 };
const ORIGIN_LABEL = "Berkeley Civic Center (demo)";

function uberDeepLink(name: string, lat: number, lon: number): string {
  const params = new URLSearchParams({
    action: "setPickup",
    "pickup[latitude]": String(DEFAULT_ORIGIN.lat),
    "pickup[longitude]": String(DEFAULT_ORIGIN.lon),
    "pickup[nickname]": ORIGIN_LABEL,
    "dropoff[latitude]": String(lat),
    "dropoff[longitude]": String(lon),
    "dropoff[nickname]": name,
  });
  return `https://m.uber.com/ul/?${params.toString()}`;
}

function lyftDeepLink(name: string, lat: number, lon: number): string {
  const params = new URLSearchParams({
    "destination[latitude]": String(lat),
    "destination[longitude]": String(lon),
    "destination[address]": name,
    pickup: JSON.stringify([DEFAULT_ORIGIN.lat, DEFAULT_ORIGIN.lon]),
  });
  return `https://lyft.com/ride?id=lyft&${params.toString()}`;
}

type VenueCoords = { lat: number; lon: number } | null;

// Uber Estimates API (price estimates). Requires a server-to-server token with
// the "price_estimates" scope. Kept fail-soft: rideshare links must always work.
type FareEstimate = NonNullable<RideshareInfo>["estimate"];

async function uberEstimate(lat: number, lon: number): Promise<FareEstimate> {
  const token = process.env.UBER_API_TOKEN;
  if (!token) return null;
  try {
    const params = new URLSearchParams({
      start_latitude: String(DEFAULT_ORIGIN.lat),
      start_longitude: String(DEFAULT_ORIGIN.lon),
      end_latitude: String(lat),
      end_longitude: String(lon),
    });
    const res = await fetch(`https://api.uber.com/v1.2/estimates/price?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) throw new Error(`Uber estimates returned ${res.status}`);
    const data = await res.json();
    // Prefer UberX (standard tier) when present; fall back to the first product.
    const prices: {
      display_name: string;
      low_estimate: number;
      high_estimate: number;
      currency_code: string;
    }[] = data?.prices;
    if (!Array.isArray(prices) || !prices.length) return null;
    const pick = prices.find((p) => p.display_name === "uberX") ?? prices[0];
    return {
      fareLow: pick.low_estimate,
      fareHigh: pick.high_estimate,
      currency: pick.currency_code,
      source: "uber" as const,
    };
  } catch (e) {
    console.error("Uber estimate failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// Builds rideshare info for one plan item. Without verified venue coordinates we skip
// the links entirely rather than aiming a real venue name at a made-up location.
export async function rideshareFor(item: PlanItem, coords: VenueCoords, venueName: string): Promise<RideshareInfo> {
  if (!coords) return null;
  const { lat, lon } = coords;
  const label = venueName || item.name;
  const estimate = await uberEstimate(lat, lon);
  return {
    uberLink: uberDeepLink(label, lat, lon),
    lyftLink: lyftDeepLink(label, lat, lon),
    estimate,
  };
}
