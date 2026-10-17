// Ported from web src/components/onboarding/CardDeck.tsx (a "use client" React DOM file, so it
// can't be imported here). Same keys, defaults and mapping — keep in sync. Pure, no React.
import type { Profile } from '@/lib/schema';

type Interest = Profile['interests'][number];
type TimeSlot = Profile['times'][number];

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

export const STAIR_OPTIONS = [
  { key: 'fine', label: 'No big deal', detail: 'Stairs are fine' },
  { key: 'hassle', label: 'A hassle', detail: 'I can, but prefer not to' },
  { key: 'avoid', label: 'Hard for me', detail: "I'd rather avoid them" },
] as const;

export const BUDGET_OPTIONS = [
  { amount: 0, label: 'Free only', detail: '$0 a week' },
  { amount: 10, label: 'A little', detail: 'up to $10 a week' },
  { amount: 25, label: 'Flexible', detail: 'up to $25 a week' },
  { amount: 50, label: "Whatever's worth it", detail: 'up to $50 a week' },
] as const;

export type Answer =
  | { kind: 'interest'; key: Interest; liked: boolean }
  | { kind: 'travel'; min: number }
  | { kind: 'mobility'; key: (typeof STAIR_OPTIONS)[number]['key'] }
  | { kind: 'times'; keys: TimeSlot[] }
  | { kind: 'budget'; amount: number };

// Card order, same as web: one card per interest, then times, travel, stairs, budget.
export type CardDef =
  | { type: 'interest'; interest: (typeof INTEREST_META)[number] }
  | { type: 'times' }
  | { type: 'travel' }
  | { type: 'mobility' }
  | { type: 'budget' };

export const CARDS: CardDef[] = [
  ...INTEREST_META.map((interest): CardDef => ({ type: 'interest', interest })),
  { type: 'times' },
  { type: 'travel' },
  { type: 'mobility' },
  { type: 'budget' },
];

export function answersToProfile(answers: Answer[], name: string): Profile {
  const likedInterests = answers
    .filter((a): a is Extract<Answer, { kind: 'interest' }> => a.kind === 'interest' && a.liked)
    .map((a) => a.key);
  const times = new Set<TimeSlot>();
  for (const a of answers) if (a.kind === 'times') a.keys.forEach((k) => times.add(k));
  const travel = answers.find((a): a is Extract<Answer, { kind: 'travel' }> => a.kind === 'travel');
  const mobility = answers.find((a): a is Extract<Answer, { kind: 'mobility' }> => a.kind === 'mobility');
  const budget = answers.find((a): a is Extract<Answer, { kind: 'budget' }> => a.kind === 'budget');

  const mobilityValue: Profile['mobility'] =
    mobility?.key === 'avoid' ? 'walker' : mobility?.key === 'hassle' ? 'cane' : 'full';

  return {
    name: name.trim() || 'Friend',
    interests: likedInterests.length ? likedInterests : ['learning'],
    mobility: mobilityValue,
    transport: mobilityValue === 'full' ? ['drive', 'walk', 'bus'] : ['bus', 'paratransit', 'family'],
    maxTravelMin: travel?.min ?? 30,
    times: times.size ? [...times] : ['morning', 'afternoon'],
    budgetPerWeek: budget?.amount ?? 10,
    hearingImpaired: false,
    prefersSmallGroups: false,
  };
}

// A null entry records a skipped card, so Back always undoes exactly one card.
export function undoAnswer(history: readonly (Answer | null)[]): (Answer | null)[] {
  return history.slice(0, -1);
}
