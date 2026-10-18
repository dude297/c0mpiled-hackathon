// User handoff only. Constructing these links performs no provider request,
// books no ride, and includes no personal pickup, contact or profile data.
export function rideLinks(lat: number, lon: number, venueName: string): {
  uberLink: string; lyftLink: string;
} | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const uber = new URLSearchParams({
    action: "setPickup",
    pickup: "my_location", // Uber resolves this on-device; we send no origin data
    "dropoff[latitude]": String(lat), "dropoff[longitude]": String(lon),
    "dropoff[nickname]": venueName, "dropoff[formatted_address]": venueName,
  });
  const lyft = new URLSearchParams({
    id: "lyft", "destination[latitude]": String(lat),
    "destination[longitude]": String(lon), "destination[address]": venueName,
  });
  // Pickup is selected/reviewed in the provider app, never a fake demo origin.
  // %20 not "+": the Uber redirect passes "+" through verbatim into the app, so names would show as "A+B".
  const q = (p: URLSearchParams) => p.toString().replaceAll("+", "%20");
  return { uberLink: `https://m.uber.com/ul/?${q(uber)}`, lyftLink: `https://lyft.com/ride?${q(lyft)}` };
}
