// Plain-language wording for everything the engine decides. Pure, no React, type-only imports, so
// scripts/check-copy.mjs can run it under plain node.
//
// Rules: built from structured data (activity facts vs the profile) wherever we have it; engine
// detail strings are only parsed as a fallback. `name` is the first name the person typed, or null.
// With no name we speak in the second person ("you") — the engine's placeholder name (the schema
// needs one) must never reach the screen.
import type { Barrier, Profile } from '@/lib/schema';

type Slot = Profile['times'][number];
type Mode = Profile['transport'][number];

/** The activity facts the wording needs (a subset of src/domain/activities Activity). */
export type ActivityFacts = {
  name: string;
  day: string;
  time: Slot;
  costPerWeek: number;
  stepFree: boolean;
  groupSize: 'small' | 'large';
  noisy: boolean;
  hearingLoop: boolean;
};
export type ProfileFacts = Pick<Profile, 'name' | 'times' | 'mobility' | 'transport' | 'maxTravelMin' | 'budgetPerWeek'>;
export type CopyCtx = { name: string | null; profile?: ProfileFacts | null; activity?: ActivityFacts | null };

/** Trimmed first name, or null when blank. */
export const cleanName = (raw: string | null | undefined): string | null => raw?.trim() || null;

// Grammar for "you" vs a name.
const isFree = (n: string | null) => (n ? `${n} is free` : "you're free");
const IsFree = (n: string | null) => (n ? `${n} is free` : "You're free");
const your = (n: string | null) => (n ? `${n}'s` : 'your');
const you = (n: string | null) => n ?? 'you';
const does = (n: string | null, v: string) => (n ? `${n} ${v}s` : `you ${v}`); // "you use" / "Pat uses"

const DAY_FULL: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
/** "Tue" / "tuesday" → "Tuesday". Unknown input comes back unchanged. */
export const fullDay = (d: string) => DAY_FULL[d.trim().slice(0, 3).toLowerCase()] ?? d;

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** Weekly meeting: ("Tue", "afternoon") → "Tuesday afternoons". */
export const meetsText = (day: string, time: string) => `${fullDay(day)} ${time.toLowerCase()}s`;

/** Engine `when` ("Tue afternoon") → "Tuesday afternoons". Unparseable input comes back unchanged. */
export function whenText(when: string): string {
  const m = /^\s*([a-z]{3})[a-z]*\s+(morning|afternoon|evening)\s*$/i.exec(when ?? '');
  return m && DAY_FULL[m[1].toLowerCase()] ? meetsText(m[1], m[2]) : when;
}

/** ["morning","evening"] → "mornings and evenings". */
export const timesText = (times: readonly string[]) => list(times.map((t) => `${t.toLowerCase()}s`));

const MODE_TEXT: Record<Mode, string> = {
  family: 'Family ride',
  bus: 'Bus',
  paratransit: 'Senior shuttle',
  drive: 'Drive',
  walk: 'Walk',
};
const MODE_LIST: Record<Mode, string> = {
  family: 'family ride',
  bus: 'bus',
  paratransit: 'senior shuttle',
  drive: 'driving',
  walk: 'walking',
};
const isMode = (m: string): m is Mode => m in MODE_TEXT;

/** ("family", 8) → "Family ride, about 8 min". */
export const travelText = (mode: string, min: number) => `${isMode(mode) ? MODE_TEXT[mode] : cap(mode)}, about ${min} min`;

/** Engine `travel` ("family, 8 min") → "Family ride, about 8 min". Unparseable input comes back unchanged. */
export function travelLabel(travel: string): string {
  const m = /^\s*([a-z]+)\s*,\s*(\d+(?:\.\d+)?)\s*min\s*$/i.exec(travel ?? '');
  return m ? travelText(m[1].toLowerCase(), Number(m[2])) : travel;
}

/** Weekly cost: 0 → "Free", 20 → "$20 a week". */
export const costText = (n: number) => (n === 0 ? 'Free' : `${money(n)} a week`);

/** Headline over the matches, built from the count (never the engine's sentence). */
export function summaryText(count: number, name: string | null): string {
  if (count === 0) return `Nothing fits ${your(name)} week yet. See what's blocking each one.`;
  return `${count} activit${count === 1 ? 'y' : 'ies'} ${you(name)} can actually attend this week.`;
}

// ---- Reasons -------------------------------------------------------------------------------------

const timeReason = (a: ActivityFacts, p: ProfileFacts, name: string | null) =>
  p.times.includes(a.time)
    ? `Meets ${meetsText(a.day, a.time)}, when ${isFree(name)}.`
    : `Meets ${meetsText(a.day, a.time)}. ${IsFree(name)} ${timesText(p.times)}.`;

const costReason = (a: ActivityFacts, p: ProfileFacts, name: string | null) => {
  if (a.costPerWeek <= p.budgetPerWeek) return a.costPerWeek === 0 ? 'Free.' : `Costs ${costText(a.costPerWeek)}, within ${your(name)} ${money(p.budgetPerWeek)} budget.`;
  if (p.budgetPerWeek === 0) return `Costs ${costText(a.costPerWeek)}. ${cap(does(name, 'want'))} free activities only.`;
  return `Costs ${costText(a.costPerWeek)}, over ${your(name)} ${money(p.budgetPerWeek)} budget.`;
};

const AID: Record<Profile['mobility'], string> = { full: '', cane: 'a cane', walker: 'a walker', wheelchair: 'a wheelchair' };
const accessReason = (a: ActivityFacts, p: ProfileFacts, name: string | null, ok: boolean) => {
  if (a.stepFree) return 'Step-free entrance.';
  if (!ok) return `The entrance has stairs, and ${does(name, 'use')} ${AID[p.mobility] || 'a mobility aid'}.`;
  return p.mobility === 'cane' ? 'The entrance has a few stairs.' : 'Stairs at the entrance.';
};

const hearingReason = (a: ActivityFacts) =>
  a.noisy && !a.hearingLoop ? 'Noisy room with no hearing loop.' : a.hearingLoop ? 'Has a hearing loop.' : 'Quiet setting.';

const socialReason = (name: string | null) => `Large group, and ${does(name, 'prefer')} small groups.`;

// Transport: the chosen route only exists in the engine detail, so it's parsed (patterns in engine.ts).
function transportReason(detail: string, ctx: CopyCtx): string | null {
  const name = ctx.name;
  let m = /^Only reachable by a family ride \((\d+(?:\.\d+)?) min\)$/.exec(detail);
  if (m) return `Only a family ride gets ${name ?? 'you'} there, about ${m[1]} min.`;
  m = /^Paratransit, (\d+(?:\.\d+)?) min$/.exec(detail);
  if (m) return `Senior shuttle ride, about ${m[1]} min.`;
  m = /^Fastest option is ([a-z]+) at (\d+(?:\.\d+)?) min; limit is (\d+(?:\.\d+)?) min$/.exec(detail);
  if (m) return `${travelText(m[1], Number(m[2]))}, longer than ${your(name)} ${m[3]}-minute limit.`;
  m = /^No way to get there using (.+)$/.exec(detail);
  if (m) {
    const modes = (ctx.profile?.transport ?? m[1].split('/')).map((x) => (isMode(x) ? MODE_LIST[x] : x));
    return `No way to get there by ${list(modes).replace(/ and /, ' or ')}.`;
  }
  m = /^([a-z]+), (\d+(?:\.\d+)?) min$/.exec(detail);
  if (m) return `${travelText(m[1], Number(m[2]))}.`;
  return null;
}

// Fallback for the other rules when the activity isn't known (e.g. a server result for a renamed activity).
function parseReason(rule: string, detail: string, ctx: CopyCtx): string | null {
  const name = ctx.name;
  let m: RegExpExecArray | null;
  if (rule === 'time') {
    m = /^Meets (\w+) (morning|afternoon|evening); .+ is only available (.+)$/.exec(detail);
    if (m) return `Meets ${meetsText(m[1], m[2])}. ${IsFree(name)} ${timesText(m[3].split('/'))}.`;
    m = /^Meets (\w+) (morning|afternoon|evening), when .+ is available$/.exec(detail);
    if (m) return `Meets ${meetsText(m[1], m[2])}, when ${isFree(name)}.`;
  }
  if (rule === 'cost') {
    m = /^\$(\d+(?:\.\d+)?)\/week (fits|exceeds) the \$(\d+(?:\.\d+)?) budget$/.exec(detail);
    if (m) {
      const [cost, budget] = [Number(m[1]), Number(m[3])];
      return costReason({ costPerWeek: cost } as ActivityFacts, { budgetPerWeek: budget } as ProfileFacts, name);
    }
  }
  if (rule === 'access') {
    m = /^Entrance has stairs; .+ uses a (\w+)$/.exec(detail);
    if (m) return `The entrance has stairs, and ${does(name, 'use')} a ${m[1]}.`;
  }
  if (rule === 'social' && /prefers small groups/.test(detail)) return socialReason(name);
  return null;
}

/**
 * One reason line for a check/barrier, in plain words. `detail` is the engine's string; `ok` is
 * whether the check passed (soft barriers count as passed).
 */
export function reasonText(rule: string, detail: string, ok: boolean, ctx: CopyCtx): string {
  const { name, profile: p, activity: a } = ctx;
  if (a && p) {
    if (rule === 'time') return timeReason(a, p, name);
    if (rule === 'cost') return costReason(a, p, name);
    if (rule === 'access') return accessReason(a, p, name, ok);
    if (rule === 'hearing') return hearingReason(a);
    if (rule === 'social') return socialReason(name);
  }
  const plain = (rule === 'transport' ? transportReason(detail, ctx) : null) ?? parseReason(rule, detail, ctx);
  if (plain) return plain;
  // Unknown wording: show it, but never with the engine's placeholder name standing in for "you".
  const engineName = p?.name?.trim();
  const out = !name && engineName ? detail.split(engineName).join('you') : detail;
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

/** Shorthand for a Barrier (hard = failed, soft = passed with a heads-up). */
export const barrierText = (b: Pick<Barrier, 'rule' | 'severity' | 'detail'>, ctx: CopyCtx) =>
  reasonText(b.rule, b.detail, b.severity !== 'hard', ctx);

/** Evidence source "activity:choir/rule:time" → { activityId, rule }. */
export function parseEvidenceSource(source: string): { activityId: string; rule: string } | null {
  const m = /^activity:([^/]+)\/rule:(.+)$/.exec(source);
  return m ? { activityId: m[1], rule: m[2] } : null;
}

/** Evidence claim "Choir: <detail>" → "<detail>" (activity name stripped). */
export const evidenceDetail = (claim: string, activityName: string | undefined) =>
  activityName && claim.startsWith(`${activityName}: `) ? claim.slice(activityName.length + 2) : claim;

// ---- Provenance pill -------------------------------------------------------------------------------

/** Compact header pill + the tap-to-read explanation. Honest about where and what made the result. */
export function provenanceCopy(source: 'server' | 'on-device' | null, dataSource: 'live' | 'mock') {
  const live = dataSource === 'live';
  const where = source === 'server' ? 'Matching ran on our server' : 'Matching runs on this phone';
  return {
    label: live ? 'Live AI' : 'Sample AI',
    info: `${where}; the explanation ${live ? 'comes from a live AI model' : 'is a sample, not a live model'}.`,
  };
}
