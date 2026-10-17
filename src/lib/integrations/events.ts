import { mapLinks } from "./maps";
import { isLocalCoordinate } from "./places";

export const EVENTS_SOURCE_URL = "https://events.berkeley.edu/";
export const EVENTS_FEED_URL = "https://events.berkeley.edu/live/json/events/max/100/hide_repeats/true/response_fields/location,tags,summary";
export type EventCandidate = {
  id: string; name: string; url: string; startsAt: string; endsAt: string | null;
  mapLink: string | null; directionsLink: string | null;
  allDay: boolean; location: string | null; proximity: "local" | "unknown";
  tags: string[]; source: "uc-berkeley"; verified: false; checkedAt: string;
  accessibility: "unknown"; cost: "unknown"; eligibility: "check-source";
};
export type DiscoveryResult = {
  status: "live" | "unavailable"; events: EventCandidate[];
  sourceUrl: string; checkedAt: string | null;
};
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
// Provider markup is reduced to plain text, never returned as renderable HTML.
const plain = (value: string) => value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function parsePublicEvents(payload: unknown, now = new Date()): EventCandidate[] | null {
  if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) return null;
  const events = new Map<string, EventCandidate>();
  const todayLA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  for (const entry of payload.data.slice(0, 100)) {
    if (!entry || typeof entry !== "object" || entry.is_canceled) continue;
    if (!(typeof entry.id === "number" && Number.isSafeInteger(entry.id) && entry.id > 0)) continue;
    const name = text(entry.title); const rawUrl = text(entry.url); const startsAt = timestamp(entry.date_iso);
    if (!name || !rawUrl || !startsAt) continue;
    let url: URL;
    try { url = new URL(rawUrl); } catch { continue; }
    if (url.protocol !== "https:" || url.hostname !== "events.berkeley.edu" || url.username || url.password || url.port) continue;
    const allDay = entry.is_all_day === 1 || entry.is_all_day === true;
    const endsAt = entry.date2_iso == null ? null : timestamp(entry.date2_iso);
    if (entry.date2_iso != null && (!endsAt || endsAt <= startsAt)) continue;
    if (allDay ? entry.date_iso.slice(0, 10) < todayLA : Date.parse(endsAt ?? startsAt) <= now.getTime()) continue;
    const lat = entry.location_latitude, lon = entry.location_longitude;
    const hasCoordinates = typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon);
    // Known distant events (e.g. away games) must not appear as local suggestions.
    if (hasCoordinates && !isLocalCoordinate(lat, lon)) continue;
    const location = text(entry.location);
    if (entry.is_online) continue; // This endpoint serves in-person social discovery.
    const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag: unknown): tag is string => typeof tag === "string").slice(0, 20).map(plain) : [];
    const links = hasCoordinates ? mapLinks(lat, lon) : null;
    const id = `uc-berkeley:${entry.id}:${startsAt}`;
    events.set(id, { id, mapLink: links?.mapLink ?? null, directionsLink: links?.directionsLink ?? null, name: plain(name), url: url.href, startsAt, endsAt, allDay,
      location: location ? plain(location) : null, proximity: hasCoordinates ? "local" : "unknown", tags,
      source: "uc-berkeley", verified: false, checkedAt: now.toISOString(),
      accessibility: "unknown", cost: "unknown", eligibility: "check-source" });
  }
  return [...events.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

let cached: { expires: number; result: DiscoveryResult } | undefined;
let pending: Promise<DiscoveryResult> | undefined;
async function retrieve(): Promise<DiscoveryResult> {
  const unavailable: DiscoveryResult = { status: "unavailable", events: [], sourceUrl: EVENTS_SOURCE_URL, checkedAt: null };
  try {
    const response = await fetch(EVENTS_FEED_URL, {
      cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || Number(response.headers.get("content-length")) > 2_000_000) {
      await response.body?.cancel(); return unavailable;
    }
    if (!response.body) return unavailable;
    const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, body = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { body += decoder.decode(); break; }
        bytes += chunk.value.byteLength;
        if (bytes > 2_000_000) { await reader.cancel(); return unavailable; }
        body += decoder.decode(chunk.value, { stream: true });
      }
    } finally { reader.releaseLock(); }
    const now = new Date(); const events = parsePublicEvents(JSON.parse(body), now);
    if (events === null) return unavailable;
    // The default local feed excludes unlocated listings, including away games.
    const result: DiscoveryResult = { status: "live", events: events.filter((event) => event.proximity === "local"), sourceUrl: EVENTS_SOURCE_URL, checkedAt: now.toISOString() };
    cached = { result, expires: Date.now() + 300_000 };
    return result;
  } catch { return unavailable; }
}
export async function discoverPublicEvents(): Promise<DiscoveryResult> {
  if (cached && cached.expires > Date.now()) return cached.result;
  // Coalesce concurrent visitors into one provider request per process.
  if (!pending) pending = retrieve().finally(() => { pending = undefined; });
  return pending;
}
