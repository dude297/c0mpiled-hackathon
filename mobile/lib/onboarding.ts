// Ported from web src/components/onboarding/CardDeck.tsx (a "use client" React DOM file, so it
// can't be imported here). Same keys, defaults and mapping — keep in sync. Pure, no React.
import type { Profile } from '@/lib/schema';

type Interest = Profile['interests'][number];
type TimeSlot = Profile['times'][number];
type Mobility = Profile['mobility'];
type Transport = Profile['transport'][number];

export const INTEREST_META = [
  { key: 'music', emoji: '🎵', label: 'Music & singing' },
  { key: 'gardening', emoji: '🌱', label: 'Gardening' },
  { key: 'cards', emoji: '🃏', label: 'Cards & games' },
  { key: 'walking', emoji: '🚶', label: 'Walking groups' },
  { key: 'crafts', emoji: '🧶', label: 'Crafts' },
  { key: 'faith', emoji: '🕊️', label: 'Faith community' },
  { key: 'learning', emoji: '📚', label: 'Learning new things' },
  { key: 'volunteering', emoji: '🤝', label: 'Volunteering' },
  { key: 'cooking', emoji: '🍳', label: 'Cooking' },
  { key: 'tech', emoji: '📱', label: 'Technology help' },
] as const satisfies readonly { key: Interest; emoji: string; label: string }[];

export const TIME_OPTIONS = [
  { key: 'morning', emoji: '🌅', label: 'Mornings' },
  { key: 'afternoon', emoji: '☀️', label: 'Afternoons' },
  { key: 'evening', emoji: '🌆', label: 'Evenings' },
] as const satisfies readonly { key: TimeSlot; emoji: string; label: string }[];

export const TRAVEL_BUCKETS = [
  { label: 'Down the block', detail: 'within 5 minutes', min: 5 },
  { label: 'A short drive', detail: 'about 15 minutes', min: 15 },
  { label: 'Across town is fine', detail: 'about 30 minutes', min: 30 },
  { label: "I'd go further for the right fit", detail: '45+ minutes', min: 45 },
  { label: 'Distance is no big deal', detail: 'an hour or more', min: 90 },
] as const;

// Asked directly — never inferred from anything else. Maps 1:1 to Profile['mobility'].
export const MOBILITY_OPTIONS = [
  { key: 'full', label: 'No, I walk on my own' },
  { key: 'cane', label: 'A cane' },
  { key: 'walker', label: 'A walker' },
  { key: 'wheelchair', label: 'A wheelchair' },
] as const satisfies readonly { key: Mobility; label: string }[];

// Asked directly (pick all that apply) — never inferred. Maps 1:1 to Profile['transport'].
export const TRANSPORT_OPTIONS = [
  { key: 'drive', emoji: '🚗', label: 'I drive myself' },
  { key: 'bus', emoji: '🚌', label: 'Bus or train' },
  { key: 'paratransit', emoji: '🚐', label: 'Senior shuttle (paratransit)' },
  { key: 'family', emoji: '👨‍👩‍👧', label: 'Family or friends drive me' },
  { key: 'walk', emoji: '🚶', label: 'I walk there' },
] as const satisfies readonly { key: Transport; emoji: string; label: string }[];

// Asked directly (pick any that apply) — never defaulted. "Neither of these" is exclusive, so both
// Profile.hearingImpaired and Profile.prefersSmallGroups always come from an explicit answer.
export const COMFORT_OPTIONS = [
  { key: 'hearing', label: 'Noisy rooms are hard for me to hear in' },
  { key: 'smallGroups', label: 'I prefer small groups' },
  { key: 'neither', label: 'Neither of these' },
] as const;
export type ComfortKey = (typeof COMFORT_OPTIONS)[number]['key'];

export type AnswerMode = 'swipe' | 'easy' | 'hands';
export type PersonChoice = 'margaret' | 'self';

export function canStartIntake(person: PersonChoice | null, name: string, mode: AnswerMode | null): boolean {
  return mode !== null && (person === 'margaret' || (person === 'self' && name.trim().length > 0));
}

// Existing matches restore every answer. A new demo leaves swipe/hands-free interests for the cards;
// Easier view starts with editable sample selections. Later sample answers are explicit, not defaults.
export function profileToDraft(p: Profile, name = p.name, includeInterests = true) {
  const comfort: ComfortKey[] = [
    ...(p.hearingImpaired ? ['hearing' as const] : []),
    ...(p.prefersSmallGroups ? ['smallGroups' as const] : []),
  ];
  return {
    name,
    liked: (includeInterests
      ? Object.fromEntries(INTEREST_META.map((i) => [i.key, p.interests.includes(i.key)]))
      : {}) as Partial<Record<Interest, boolean>>,
    times: [...p.times],
    travel: p.maxTravelMin,
    mobility: p.mobility,
    transport: [...p.transport],
    comfort: comfort.length ? comfort : (['neither'] as ComfortKey[]),
    budget: p.budgetPerWeek,
  };
}

export function prefillDemo(p: Profile, mode: AnswerMode | null) {
  return profileToDraft(p, p.name, mode === 'easy');
}

// Tap on the comfort card: "Neither" clears the others; any other option clears "Neither".
export function toggleComfort(prev: readonly ComfortKey[], key: ComfortKey): ComfortKey[] {
  if (prev.includes(key)) return prev.filter((k) => k !== key);
  if (key === 'neither') return ['neither'];
  return [...prev.filter((k) => k !== 'neither'), key];
}

export const BUDGET_OPTIONS = [
  { amount: 0, label: 'Free only', detail: '$0 a week' },
  { amount: 10, label: 'A little', detail: 'up to $10 a week' },
  { amount: 25, label: 'Flexible', detail: 'up to $25 a week' },
  { amount: 50, label: "Whatever's worth it", detail: 'up to $50 a week' },
] as const;

export type Answer =
  | { kind: 'interest'; key: Interest; liked: boolean }
  | { kind: 'travel'; min: number }
  | { kind: 'mobility'; key: Mobility }
  | { kind: 'transport'; keys: Transport[] }
  | { kind: 'comfort'; keys: ComfortKey[] }
  | { kind: 'times'; keys: TimeSlot[] }
  | { kind: 'budget'; amount: number };

// Card order, same as web: one card per interest, then times, travel, walking aid, how you get places,
// anything else that helps (hearing / group size), budget, then a review of every answer before matching.
export type CardDef =
  | { type: 'interest'; interest: (typeof INTEREST_META)[number] }
  | { type: 'times' }
  | { type: 'travel' }
  | { type: 'mobility' }
  | { type: 'transport' }
  | { type: 'comfort' }
  | { type: 'budget' };

export const CARDS: CardDef[] = [
  ...INTEREST_META.map((interest): CardDef => ({ type: 'interest', interest })),
  { type: 'times' },
  { type: 'travel' },
  { type: 'mobility' },
  { type: 'transport' },
  { type: 'comfort' },
  { type: 'budget' },
];

// Fields that may fall back to a default. Mobility, transport and comfort (hearing + group size)
// never do: they must be answered.
export type DefaultField = 'interests' | 'times' | 'travel' | 'budget';
export type RequiredField = 'mobility' | 'transport' | 'comfort';
export type ProfileResult =
  | { ok: true; profile: Profile; defaulted: DefaultField[] }
  | { ok: false; missing: RequiredField[] };

const DEFAULTS = { interests: ['learning'] as Interest[], times: ['morning', 'afternoon'] as TimeSlot[], travel: 30, budget: 10 };
const MOBILITY_KEYS: readonly string[] = MOBILITY_OPTIONS.map((o) => o.key);
const TRANSPORT_KEYS: readonly string[] = TRANSPORT_OPTIONS.map((o) => o.key);

function pick<K extends Answer['kind']>(answers: readonly Answer[], kind: K) {
  return answers.find((a): a is Extract<Answer, { kind: K }> => a.kind === kind);
}

function readAnswers(answers: readonly Answer[]) {
  const likedInterests = answers
    .filter((a): a is Extract<Answer, { kind: 'interest' }> => a.kind === 'interest' && a.liked)
    .map((a) => a.key);
  const times = new Set<TimeSlot>();
  for (const a of answers) if (a.kind === 'times') a.keys.forEach((k) => times.add(k));
  const mobilityKey = pick(answers, 'mobility')?.key;
  const mobility = mobilityKey && MOBILITY_KEYS.includes(mobilityKey) ? mobilityKey : null;
  // Keep option order and drop anything that isn't a real choice.
  const chosen = new Set<string>(pick(answers, 'transport')?.keys ?? []);
  const transport = TRANSPORT_OPTIONS.map((o) => o.key).filter((k) => chosen.has(k));
  // Comfort: only real keys count; "neither" must stand alone (with another option it's contradictory).
  const said = new Set<string>(pick(answers, 'comfort')?.keys ?? []);
  const ck = COMFORT_OPTIONS.map((o) => o.key).filter((k) => said.has(k));
  const comfort =
    ck.length === 0 || (ck.includes('neither') && ck.length > 1)
      ? null
      : { hearingImpaired: ck.includes('hearing'), prefersSmallGroups: ck.includes('smallGroups') };
  return {
    interests: likedInterests.length ? likedInterests : null,
    times: times.size ? [...times] : null,
    travel: pick(answers, 'travel')?.min ?? null,
    budget: pick(answers, 'budget')?.amount ?? null,
    mobility,
    transport: transport.length ? transport : null,
    comfort,
  };
}

// Mobility, transport, hearing and group size come ONLY from the explicit answers. If any is missing,
// nothing is invented: the result says what's missing and the caller must ask before analyzing.
export function answersToProfile(answers: readonly Answer[], name: string): ProfileResult {
  const r = readAnswers(answers);
  const missing: RequiredField[] = [];
  if (!r.mobility) missing.push('mobility');
  if (!r.transport) missing.push('transport');
  if (!r.comfort) missing.push('comfort');
  if (!r.mobility || !r.transport || !r.comfort) return { ok: false, missing };

  const defaulted: DefaultField[] = [];
  if (!r.interests) defaulted.push('interests');
  if (!r.times) defaulted.push('times');
  if (r.travel === null) defaulted.push('travel');
  if (r.budget === null) defaulted.push('budget');
  return {
    ok: true,
    defaulted,
    profile: {
      name: name.trim() || 'Friend', // engine/schema placeholder only — screens use store.firstName, never this
      interests: r.interests ?? DEFAULTS.interests,
      mobility: r.mobility,
      transport: r.transport,
      maxTravelMin: r.travel ?? DEFAULTS.travel,
      times: r.times ?? DEFAULTS.times,
      budgetPerWeek: r.budget ?? DEFAULTS.budget,
      hearingImpaired: r.comfort.hearingImpaired,
      prefersSmallGroups: r.comfort.prefersSmallGroups,
    },
  };
}

// "Here's what we heard": every answer in plain words, in card order. `text` carries "(default)"
// when the value wasn't chosen; `field` is the card the Change button jumps back to (Hearing and
// Group size both come from the comfort card); `id` is unique per row.
export type ReviewField = DefaultField | RequiredField;
export type ReviewRow = { id: string; field: ReviewField; title: string; value: string; isDefault: boolean; text: string };

const labelOf = <T extends { key: string; label: string }>(opts: readonly T[], keys: readonly string[]) =>
  opts.filter((o) => keys.includes(o.key)).map((o) => o.label).join(', ');
const travelText = (min: number) => {
  const b = TRAVEL_BUCKETS.find((x) => x.min === min);
  return b ? `${b.label} (${b.detail})` : `About ${min} minutes`;
};
const budgetText = (amount: number) => {
  const b = BUDGET_OPTIONS.find((x) => x.amount === amount);
  return b ? `${b.label} (${b.detail})` : `Up to $${amount} a week`;
};

// Plain words for the two comfort answers (review + Details screen).
export const HEARING_TEXT = { yes: 'Noisy rooms are hard to hear in', no: 'No trouble hearing' } as const;
export const GROUP_TEXT = { yes: 'Prefers small groups', no: 'Any size is fine' } as const;

export function reviewRows(answers: readonly Answer[]): ReviewRow[] {
  const r = readAnswers(answers);
  const row = (field: ReviewField, title: string, value: string, isDefault: boolean, id: string = field): ReviewRow => ({
    id,
    field,
    title,
    value,
    isDefault,
    text: isDefault ? `${value} (default)` : value,
  });
  return [
    row('interests', 'What sounds fun', labelOf(INTEREST_META, r.interests ?? DEFAULTS.interests), !r.interests),
    row('times', "When you're free", labelOf(TIME_OPTIONS, r.times ?? DEFAULTS.times), !r.times),
    row('travel', 'How far is too far', travelText(r.travel ?? DEFAULTS.travel), r.travel === null),
    row('mobility', 'Help with walking', r.mobility ? labelOf(MOBILITY_OPTIONS, [r.mobility]) : 'Not answered yet', false),
    row('transport', 'How you get places', r.transport ? labelOf(TRANSPORT_OPTIONS, r.transport) : 'Not answered yet', false),
    row('comfort', 'Hearing', !r.comfort ? 'Not answered yet' : r.comfort.hearingImpaired ? HEARING_TEXT.yes : HEARING_TEXT.no, false, 'hearing'),
    row('comfort', 'Group size', !r.comfort ? 'Not answered yet' : r.comfort.prefersSmallGroups ? GROUP_TEXT.yes : GROUP_TEXT.no, false, 'groups'),
    row('budget', 'Weekly budget', budgetText(r.budget ?? DEFAULTS.budget), r.budget === null),
  ];
}

// A null entry records a skipped card, so Back always undoes exactly one card.
export function undoAnswer(history: readonly (Answer | null)[]): (Answer | null)[] {
  return history.slice(0, -1);
}
