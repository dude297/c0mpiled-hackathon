// Plain-language copy for the app-shell screens. Pure: unit-tested in copy.test.ts.
// The engine (src/domain) writes terse detail strings with the profile name baked in ("Meets Tue afternoon; Friend is
// only available morning/evening"). Screens never show those raw: they go through barrierText / whenText / travelText here.

/** Onboarding stores a blank name as "Friend" (frozen code). It is a fallback, never a name we show. */
export const NO_NAME = "Friend";

/** The person's real first name, or null when they left it blank. */
export function realName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  return n && n !== NO_NAME ? n : null;
}

/** "your" / "Margaret's" (mid-sentence). */
export const whose = (name: string | null) => (name ? `${name}'s` : "your");

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const trimDot = (s: string) => s.trim().replace(/\.+$/, "");

const DAYS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};
/** "Tue" / "tuesday" → "Tuesday"; anything else as given. */
export const dayFull = (d: string) => DAYS[d.trim().slice(0, 3).toLowerCase()] ?? d;

const WHEN = /^\s*([a-z]{3})[a-z]*\s+(morning|afternoon|evening)\s*$/i;
/** "Wed afternoon" → "Wednesday afternoon"; unknown shapes as given. */
export function whenText(when: string): string {
  const m = WHEN.exec(when ?? "");
  return m && DAYS[m[1].toLowerCase()] ? `${DAYS[m[1].toLowerCase()]} ${m[2].toLowerCase()}` : when;
}

/** ["morning","evening"] → "mornings and evenings". */
export function timesList(times: readonly string[]): string {
  const t = times.map((x) => `${x.trim().toLowerCase()}s`);
  return t.length <= 1 ? (t[0] ?? "") : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
}

export const TRAVEL_WORDS: Record<string, string> = {
  drive: "Drive", bus: "Bus", paratransit: "Senior shuttle", family: "Family ride", walk: "Walk",
};
/** Mode inside a sentence: "the bus takes about 45 min". */
const MODE_SUBJECT: Record<string, string> = {
  drive: "driving", bus: "the bus", paratransit: "the senior shuttle", family: "a family ride", walk: "walking",
};
/** Mode after "by": "No way to get there by bus or family ride". */
const MODE_BY: Record<string, string> = {
  drive: "car", bus: "bus", paratransit: "senior shuttle", family: "family ride", walk: "walking",
};
const modeKey = (m: string) => m.trim().toLowerCase();

/** ("family", 8) → "Family ride, about 8 min". */
export const travelText = (mode: string, min: number | string) => `${TRAVEL_WORDS[modeKey(mode)] ?? cap(mode.trim())}, about ${min} min`;

const ENGINE_TRAVEL = /^\s*([a-z]+)\s*,\s*(\d+)\s*min\s*$/i;
/** Engine travel "bus, 25 min" → { mode: "Bus", text: "Bus, about 25 min" }. Unknown shapes as given. */
export function travelPlain(travel: string): { mode: string; text: string } {
  const m = ENGINE_TRAVEL.exec(trimDot(travel ?? ""));
  if (!m) return { mode: cap(travel ?? ""), text: cap(travel ?? "") };
  return { mode: TRAVEL_WORDS[modeKey(m[1])] ?? cap(m[1]), text: travelText(m[1], m[2]) };
}

const money = (n: string) => `$${n}`;

/**
 * One engine barrier / check detail in plain words, second person when there is no name.
 * No trailing period: callers end the sentence. Unknown details pass through with the fallback name removed.
 */
export function barrierText(b: { rule?: string; detail: string }, name: string | null): string {
  const d = trimDot(b.detail ?? "");
  const who = name ? `${name} is` : "You're";
  let m: RegExpExecArray | null;

  if ((m = /^(.*?);\s*no available driver or paratransit option left$/i.exec(d))) {
    return `${barrierText({ rule: b.rule, detail: m[1] }, name)}. No driver or senior shuttle is free`;
  }
  if ((m = /^Meets (\w+) (morning|afternoon|evening); .+ is only available (.+)$/i.exec(d))) {
    return `Meets ${dayFull(m[1])} ${m[2].toLowerCase()}s. ${who} free ${timesList(m[3].split("/"))}`;
  }
  if ((m = /^Meets (\w+) (morning|afternoon|evening), when .+ is available$/i.exec(d))) {
    return `Meets ${dayFull(m[1])} ${m[2].toLowerCase()}s, when ${name ? `${name} is` : "you're"} free`;
  }
  if (/^Entrance has stairs;/i.test(d)) return "Entrance has stairs, no step-free way in";
  if (/^Stairs at entrance, no mobility limits$/i.test(d)) return "Stairs at the entrance";
  if ((m = /^No way to get there using (.+)$/i.exec(d))) {
    return `No way to get there by ${m[1].split("/").map((x) => MODE_BY[modeKey(x)] ?? x.trim()).join(" or ")}`;
  }
  if ((m = /^Fastest option is (\w+) at (\d+) min; limit is (\d+) min$/i.exec(d))) {
    return `Too far: ${MODE_SUBJECT[modeKey(m[1])] ?? m[1]} takes about ${m[2]} min, over ${whose(name)} ${m[3]}-minute limit`;
  }
  if ((m = /^Only reachable by a family ride \((\d+) min\)$/i.exec(d))) return `Family ride only, about ${m[1]} min`;
  if ((m = ENGINE_TRAVEL.exec(d))) return travelText(m[1], m[2]);
  if ((m = /^\$(\d+(?:\.\d+)?)\/week exceeds the \$(\d+(?:\.\d+)?) budget$/i.exec(d))) {
    return `Costs ${money(m[1])} a week, over ${whose(name)} ${money(m[2])} budget`;
  }
  if ((m = /^\$(\d+(?:\.\d+)?)\/week fits the \$(\d+(?:\.\d+)?) budget$/i.exec(d))) {
    return `${Number(m[1]) === 0 ? "Free" : `Costs ${money(m[1])} a week`}, within ${whose(name)} ${money(m[2])} budget`;
  }
  if (b.rule === "social" || /^Large group; prefers small groups$/i.test(d)) return "Large group";
  return withoutFallbackName(d, name);
}

/** A soft barrier as what to expect + what helps (same words on every screen). */
export function headsUp(b: { rule?: string; detail: string; mitigation?: string }, name: string | null): { detail: string; tip: string | null } {
  return { detail: barrierText(b, name), tip: b.mitigation ? trimDot(b.mitigation) : null };
}

/**
 * Free text (e.g. the sample AI explanation) with the "Friend" fallback turned into "you" / "your".
 * Only when the person has no real name; capitalized at the start of a sentence.
 */
export function withoutFallbackName(text: string, name: string | null): string {
  if (name) return text;
  return text.replace(/\bFriend('s)?\b/g, (_m, poss: string | undefined, at: number) => {
    const word = poss ? "your" : "you";
    return /(^|[.!?\]]\s*)$/.test(text.slice(0, at)) ? cap(word) : word;
  });
}
