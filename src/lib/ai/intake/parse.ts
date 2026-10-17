import { Profile } from "@/lib/schema";

// Deterministic, offline caregiver-text → Partial<Profile> parser. Suggestions only: the UI must confirm.
// Never infers diagnoses, medications or other sensitive facts; only the Profile keys below.

export type ProfileKey = keyof typeof Profile.shape;
export const PROFILE_KEYS = Object.keys(Profile.shape) as ProfileKey[];
export type Suggestion = Partial<Profile>;

// Keep only known keys whose value passes that key's own schema; arrays are deduped first.
export function sanitize(raw: unknown): Suggestion {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of PROFILE_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    let v = (raw as Record<string, unknown>)[key];
    if (Array.isArray(v)) v = [...new Set(v)];
    const r = Profile.shape[key].safeParse(v);
    if (r.success) out[key] = r.data;
  }
  return out as Suggestion;
}

const NEGATION = /(?:\bnot|n't|\bno longer|\bnever|\bstopped|\bgave up|\bcannot|\bunable to|\bno)\s+(?:\w+\s+){0,2}$/i;

// True when some match of `re` is not preceded (in the same clause) by a negation word.
function affirmed(text: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of text.matchAll(g)) {
    const before = text.slice(0, m.index).split(/[.;!?,]/).pop() ?? "";
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

const INTERESTS: [Profile["interests"][number], RegExp][] = [
  ["gardening", /\bgarden\w*/i],
  ["music", /\b(?:music|sing(?:s|ing)?|choir)\b/i],
  ["cards", /\b(?:cards|bridge|canasta|poker)\b/i],
  ["walking", /\b(?:go(?:es|ing)? for walks|walking (?:group|club)|(?:enjoys?|loves?|likes?) (?:\w+ )?walk(?:s|ing)|(?:nature|daily|morning|evening|long) walks)\b/i],
  ["crafts", /\b(?:knit\w*|sew\w*|crochet\w*|quilt\w*|crafts?)\b/i],
  ["faith", /\b(?:church|faith|temple|synagogue|mosque|bible)\b/i],
  ["learning", /\b(?:class(?:es)?|learning|lectures?|courses?)\b/i],
  ["volunteering", /\bvolunteer\w*/i],
  ["cooking", /\b(?:cook\w*|baking)\b/i],
  ["tech", /\b(?:phones?|computers?|tablets?|ipads?|email)\b/i],
];

const RELATIONS = "mom|mother|dad|father|grandma|grandmother|grandpa|grandfather|aunt|uncle|neighbou?r|husband|wife|friend|client";
const NOT_NAMES = new Set(["She", "He", "They", "It", "I", "My", "Mom", "Dad", "Mother", "Father", "Grandma", "Grandpa", "Her", "His", "This", "The"]);

function findName(text: string): string | undefined {
  const res = [
    /\b(?:named|name is|called)\s+([a-z][a-z'-]+)/gi,
    new RegExp(`\\bmy (?:${RELATIONS}),?\\s+([a-z][a-z'-]+)`, "gi"),
    /(?:^|[.!?]\s+)([A-Z][a-z'-]+)(?:,\s*|\s+is\s+)\d{2}\b/g, // "Margaret is 82" / "Frank, 79"
  ];
  for (const re of res) {
    for (const m of text.matchAll(re)) {
      const n = m[1];
      // With /i, [a-z] also matches uppercase/lowercase alike: require a real capital in the original text.
      if (/^[A-Z]/.test(n) && !NOT_NAMES.has(n)) return n;
    }
  }
}

export function parseRules(text: string): Suggestion {
  const s: Record<string, unknown> = {};

  const name = findName(text);
  if (name) s.name = name;

  const interests = INTERESTS.filter(([, re]) => affirmed(text, re)).map(([k]) => k);
  if (interests.length) s.interests = interests;

  if (/\bwheelchair\b/i.test(text)) s.mobility = "wheelchair";
  else if (/\bwalker\b/i.test(text)) s.mobility = "walker";
  else if (/\bcane\b/i.test(text)) s.mobility = "cane";
  else if (/\b(?:walks|gets around) (?:just )?(?:fine|well|ok(?:ay)?)\b|\bno mobility (?:issues|problems)\b/i.test(text)) s.mobility = "full";

  const transport: string[] = [];
  if (affirmed(text, /\b(?:she|he)\s+(?:still\s+|can\s+|can still\s+)?drives\b(?!\s+(?:her|him)\b)|\bdriv(?:es|ing) (?:herself|himself)\b/i)) transport.push("drive");
  if (affirmed(text, /\b(?:bus|transit|metro|subway)\b/i)) transport.push("bus");
  if (affirmed(text, /\bpara-?transit\b/i)) transport.push("paratransit");
  if (
    /\bi\s*(?:can |will |'ll |could )?drive (?:her|him)\b/i.test(text) ||
    /\b(?:son|daughter|grandson|granddaughter|niece|nephew|brother|sister|family)\s+(?:can\s+|will\s+|could\s+)?(?:drives?|takes?|give)\s+(?:her|him)\b/i.test(text) ||
    /\bfamily (?:can )?(?:drive|rides?)\b|\brides? from (?:family|me|my)\b/i.test(text)
  ) transport.push("family");
  if (affirmed(text, /\bwalk(?:s|ing)? (?:to|there|over)\b|\bwalking distance\b/i)) transport.push("walk");
  if (transport.length) s.transport = transport;

  const mins = text.match(/\b(\d{1,3})\s*-?\s*(?:min|mins|minutes)\b/i);
  if (mins) s.maxTravelMin = Number(mins[1]);
  else if (/\bhalf an hour\b/i.test(text)) s.maxTravelMin = 30;
  else if (/\b(?:an|one) hour\b/i.test(text)) s.maxTravelMin = 60;

  const times = (["morning", "afternoon", "evening"] as const).filter((t) => affirmed(text, new RegExp(`\\b${t}s?\\b`, "i")));
  if (times.length) s.times = times;

  // Budget only from explicit money per week; "free afternoons" is availability, not $0.
  const budget =
    text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/|a|per|each)?\s*(?:week|wk)\b/i) ??
    text.match(/\b(\d+(?:\.\d+)?)\s*dollars?\s*(?:\/|a|per|each)?\s*(?:week|wk)\b/i);
  if (budget) s.budgetPerWeek = Number(budget[1]);

  if (/\bhard of hearing\b|\bhearing aids?\b/i.test(text)) s.hearingImpaired = true;
  if (/\bcrowds?\b|\bsmall groups?\b|\boverwhelmed\b/i.test(text)) s.prefersSmallGroups = true;

  return sanitize(s);
}

export function describe(s: Suggestion): string[] {
  return PROFILE_KEYS.filter((k) => s[k] !== undefined).map((k) => {
    const v = s[k];
    return `I heard: ${k} = ${Array.isArray(v) ? v.join(", ") : String(v)}`;
  });
}
