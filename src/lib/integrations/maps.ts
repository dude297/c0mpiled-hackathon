// Free Maps URLs: constructing links makes no request and needs no API key.
// Origin is omitted; the user chooses it in Maps. Never include profile data.
export function mapLinks(lat: number, lon: number): { mapLink: string; directionsLink: string } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const destination = `${lat},${lon}`;
  return {
    mapLink: `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: destination })}`,
    directionsLink: `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination })}`,
  };
}
