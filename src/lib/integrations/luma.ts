// Read-only public city discovery via Luma's documented iCal subscription.
// No guests, registrations, private calendars, or writes. Candidates are not
// planner Activities: missing feasibility facts must remain unknown.
export const LUMA_DISCOVERY_URL = "https://luma.com/sf";
const CITY_FEED = "https://api.luma.com/ics/get?entity=discover&id=discplace-BDj7GNbGlsF7Cka";
export type LumaCandidate = {
  id: string; name: string; startsAt: string; endsAt: string | null;
  location: string | null; url: string; source: "luma"; verified: false; checkedAt: string;
};

function eventUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["luma.com", "lu.ma"].includes(url.hostname) &&
      !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}
function utcDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return null; // Floating/local/all-day dates need a separate contract.
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso ? iso : null;
}
const unescapeText = (text: string) => text.replace(/\\([nN,;\\])/g, (_, c: string) => /[nN]/.test(c) ? "\n" : c);

const MAX_FEED_BYTES = 2_000_000;

// Reject truncated/misnested components before interpreting any event fields.
function calendarLines(ics: string): string[] | null {
  if (new TextEncoder().encode(ics).byteLength > MAX_FEED_BYTES) return null;
  const lines = ics.replace(/\r?\n[ \t]/g, "").trim().split(/\r?\n/);
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR") return null;
  const stack: string[] = [];
  let roots = 0;
  for (const line of lines) {
    if (line.startsWith("BEGIN:")) {
      const component = line.slice(6);
      if (!stack.length && ++roots > 1) return null;
      if ((!stack.length && component !== "VCALENDAR") ||
          (component === "VCALENDAR" && stack.length) ||
          (component === "VEVENT" && stack.at(-1) !== "VCALENDAR")) return null;
      stack.push(component);
    } else if (line.startsWith("END:")) {
      if (stack.pop() !== line.slice(4)) return null;
    } else if (line && !stack.length) return null;
  }
  return stack.length ? null : lines;
}

async function readFeed(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_FEED_BYTES) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  } finally { reader.releaseLock(); }
}

export function parseLumaFeed(ics: string, now = new Date()): LumaCandidate[] {
  const lines = calendarLines(ics);
  if (!lines) return [];
  const unfolded = lines.join("\n");
  const results = new Map<string, LumaCandidate>();
  const seen = new Set<string>();
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const end = block.indexOf("END:VEVENT");
    if (end < 0) continue;
    const fields = new Map<string, string>();
    let invalid = false;
    let depth = 0;
    const singleFields = new Set(["UID", "SUMMARY", "DTSTART", "DTEND", "URL", "STATUS", "CLASS", "LOCATION", "RRULE", "RECURRENCE-ID"]);
    for (const line of block.slice(0, end).split(/\r?\n/)) {
      if (line.startsWith("BEGIN:")) { depth++; continue; }
      if (line.startsWith("END:")) { depth--; continue; }
      if (depth) continue; // Alarm descriptions/URLs must not replace event data.
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const property = line.slice(0, colon);
      const key = property.split(";")[0].toUpperCase();
      if (!singleFields.has(key)) continue; // ATTENDEE, CATEGORIES, etc. may repeat.
      if (fields.has(key)) invalid = true;
      // Unsupported time parameters remain unknown, rather than assumed UTC.
      if ((key === "DTSTART" || key === "DTEND") && property !== key) invalid = true;
      fields.set(key, line.slice(colon + 1));
    }
    if (invalid || fields.has("RRULE") || fields.has("RECURRENCE-ID") ||
        fields.get("STATUS") === "CANCELLED" ||
        (fields.has("CLASS") && fields.get("CLASS") !== "PUBLIC")) continue;
    const id = fields.get("UID");
    const name = unescapeText(fields.get("SUMMARY") ?? "").trim();
    const startsAt = utcDate(fields.get("DTSTART") ?? "");
    const endsAt = fields.has("DTEND") ? utcDate(fields.get("DTEND")!) : null;
    const url = eventUrl(fields.get("URL") ?? "");
    if (!id || !name || !startsAt || !url || Date.parse(startsAt) < now.getTime() ||
        (fields.has("DTEND") && (!endsAt || endsAt <= startsAt))) continue;
    // Reject ambiguous duplicate UIDs instead of guessing which occurrence wins.
    if (seen.has(id)) { results.delete(id); continue; }
    seen.add(id);
    results.set(id, { id, name, startsAt, endsAt, location: fields.has("LOCATION")
      ? unescapeText(fields.get("LOCATION")!) : null, url, source: "luma", verified: false,
      checkedAt: now.toISOString() });
  }
  return [...results.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 100);
}

export async function discoverLumaEvents(): Promise<{
  status: "live" | "disabled" | "unavailable"; events: LumaCandidate[]; sourceUrl: string;
}> {
  const fallback = { events: [], sourceUrl: LUMA_DISCOVERY_URL };
  if (process.env.DAYBRIDGE_LUMA !== "1") return { ...fallback, status: "disabled" };
  try {
    const response = await fetch(CITY_FEED, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: AbortSignal.timeout(2500) });
    if (!response.ok || Number(response.headers.get("content-length")) > MAX_FEED_BYTES) {
      await response.body?.cancel();
      return { ...fallback, status: "unavailable" };
    }
    const text = await readFeed(response);
    if (text === null || !calendarLines(text)) return { ...fallback, status: "unavailable" };
    return { status: "live", events: parseLumaFeed(text), sourceUrl: LUMA_DISCOVERY_URL };
  } catch { return { ...fallback, status: "unavailable" }; }
}
