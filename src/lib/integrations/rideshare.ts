import type { PlanItem } from "@/lib/schema";
import { rideLinks } from "./ride-links";

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

// Fixed demo point used ONLY as the fare-estimate start; deep links never carry it
// (pickup is chosen in the provider app — see ride-links.ts).
const DEFAULT_ORIGIN = { lat: 37.8715, lon: -122.273 };

type VenueCoords = { lat: number; lon: number } | null;

// Uber Estimates API (price estimates). Requires a server-to-server token with
// the "price_estimates" scope. Kept fail-soft: rideshare links must always work.
type FareEstimate = NonNullable<RideshareInfo>["estimate"];

async function uberEstimate(lat: number, lon: number, signal?: AbortSignal): Promise<FareEstimate> {
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
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000),
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
    if (!pick || !Number.isFinite(pick.low_estimate) || !Number.isFinite(pick.high_estimate) ||
        pick.low_estimate < 0 || pick.high_estimate < pick.low_estimate ||
        typeof pick.currency_code !== "string" || !/^[A-Z]{3}$/.test(pick.currency_code)) return null;
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

// Builds rideshare info for one plan item. Without validated venue coordinates we skip
// the links entirely rather than aiming a real venue name at a made-up location.
export async function rideshareFor(item: PlanItem, coords: VenueCoords, venueName: string, signal?: AbortSignal): Promise<RideshareInfo> {
  if (signal?.aborted) return null;
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon) ||
      Math.abs(coords.lat) > 90 || Math.abs(coords.lon) > 180) return null;
  const { lat, lon } = coords;
  const label = venueName || item.name;
  const estimate = await uberEstimate(lat, lon, signal);
  return {
    ...rideLinks(lat, lon, label)!, // coords validated above
    estimate,
  };
}
