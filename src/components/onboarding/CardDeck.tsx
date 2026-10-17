"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Heart, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/schema";

// Swipe-card onboarding: produces the same Profile as the manual form.
// Dislike on an interest card only removes it from the running set — never blocks.
// Walking aid, transport, hearing and group size are asked directly and required; a review step shows every answer before analyze.

export const INTEREST_META = [
  { key: "music", emoji: "🎵", label: "Music & singing" },
  { key: "gardening", emoji: "🌱", label: "Gardening" },
  { key: "cards", emoji: "🃏", label: "Cards & games" },
  { key: "walking", emoji: "🚶", label: "Walking groups" },
  { key: "crafts", emoji: "🧶", label: "Crafts" },
  { key: "faith", emoji: "🕊️", label: "Faith community" },
  { key: "learning", emoji: "📚", label: "Learning new things" },
  { key: "volunteering", emoji: "🤝", label: "Volunteering" },
  { key: "cooking", emoji: "🍳", label: "Cooking" },
  { key: "tech", emoji: "📱", label: "Technology help" },
] as const;

export const TRAVEL_BUCKETS = [
  { label: "Down the block", detail: "within 5 minutes", min: 5 },
  { label: "A short drive", detail: "about 15 minutes", min: 15 },
  { label: "Across town is fine", detail: "about 30 minutes", min: 30 },
  { label: "I'd go further for the right fit", detail: "45+ minutes", min: 45 },
  { label: "Distance is no big deal", detail: "an hour or more", min: 90 },
] as const;

// Asked directly — mobility and transport are never inferred from any other answer.
export const WALKING_AID_OPTIONS: readonly { key: Profile["mobility"]; label: string }[] = [
  { key: "full", label: "No, I walk on my own" },
  { key: "cane", label: "A cane" },
  { key: "walker", label: "A walker" },
  { key: "wheelchair", label: "A wheelchair" },
];

export const TRANSPORT_OPTIONS: readonly { key: Profile["transport"][number]; emoji: string; label: string }[] = [
  { key: "drive", emoji: "🚗", label: "I drive myself" },
  { key: "bus", emoji: "🚌", label: "Bus or train" },
  { key: "paratransit", emoji: "🚐", label: "Senior shuttle (paratransit)" },
  { key: "family", emoji: "👨‍👩‍👧", label: "Family or friends drive me" },
  { key: "walk", emoji: "🚶", label: "I walk there" },
];

// Asked directly — hearingImpaired and prefersSmallGroups only ever come from this answer.
// "Neither" is exclusive, so "both false" is an explicit answer, never a default.
export type ComfortKey = "hearing" | "smallGroups" | "neither";
export const COMFORT_OPTIONS: readonly { key: ComfortKey; label: string }[] = [
  { key: "hearing", label: "Noisy rooms are hard for me to hear in" },
  { key: "smallGroups", label: "I prefer small groups" },
  { key: "neither", label: "Neither of these" },
];
export const COMFORT_NEITHER: ComfortKey = "neither";

export function comfortFromKeys(keys: readonly ComfortKey[]): Extract<Answer, { kind: "comfort" }> {
  return { kind: "comfort", hearing: keys.includes("hearing"), smallGroups: keys.includes("smallGroups") };
}

export function comfortToKeys(answer: { hearing: boolean; smallGroups: boolean }): ComfortKey[] {
  const keys: ComfortKey[] = [];
  if (answer.hearing) keys.push("hearing");
  if (answer.smallGroups) keys.push("smallGroups");
  return keys.length ? keys : [COMFORT_NEITHER];
}

// Multi-select toggle with one exclusive option: picking it clears the rest, picking another clears it.
export function toggleChoice<K extends string>(prev: readonly K[], key: K, exclusive?: K): K[] {
  if (prev.includes(key)) return prev.filter((k) => k !== key);
  if (key === exclusive) return [key];
  return [...prev.filter((k) => k !== exclusive), key];
}

export type Answer =
  | { kind: "interest"; key: Profile["interests"][number]; liked: boolean }
  | { kind: "travel"; min: number }
  | { kind: "mobility"; key: Profile["mobility"] }
  | { kind: "transport"; modes: Profile["transport"] }
  | { kind: "comfort"; hearing: boolean; smallGroups: boolean }
  | { kind: "times"; keys: Profile["times"][number][] }
  | { kind: "budget"; amount: number };

type CardDef =
  | { type: "interest"; interest: (typeof INTEREST_META)[number] }
  | { type: "travel" }
  | { type: "mobility" }
  | { type: "transport" }
  | { type: "comfort" }
  | { type: "times" }
  | { type: "budget" };

const TIME_OPTIONS: { key: Profile["times"][number]; emoji: string; label: string }[] = [
  { key: "morning", emoji: "🌅", label: "Mornings" },
  { key: "afternoon", emoji: "☀️", label: "Afternoons" },
  { key: "evening", emoji: "🌆", label: "Evenings" },
];

function buildCards(): CardDef[] {
  const interestCards: CardDef[] = INTEREST_META.map((interest) => ({ type: "interest", interest }));
  return [
    ...interestCards,
    { type: "times" },
    { type: "travel" },
    { type: "mobility" },
    { type: "transport" },
    { type: "comfort" },
    { type: "budget" },
  ];
}

const BUDGET_OPTIONS = [
  { amount: 0, label: "Free only", detail: "$0 a week" },
  { amount: 10, label: "A little", detail: "up to $10 a week" },
  { amount: 25, label: "Flexible", detail: "up to $25 a week" },
  { amount: 50, label: "Whatever's worth it", detail: "up to $50 a week" },
] as const;

const DEFAULT_INTERESTS: Profile["interests"] = ["learning"];
const DEFAULT_TIMES: Profile["times"] = ["morning", "afternoon"];
const DEFAULT_TRAVEL_MIN = 30;
const DEFAULT_BUDGET = 10;

export type RequiredField = "mobility" | "transport" | "comfort";
export type DefaultedField = "interests" | "times" | "travel" | "budget";
export type ProfileResult =
  | { ok: true; profile: Profile; defaults: DefaultedField[] }
  | { ok: false; missing: RequiredField[] };

// Reads each field from its own explicit answer. Unknown mobility keys count as unanswered, never guessed.
function collect(answers: readonly Answer[]) {
  const liked = answers.flatMap((a) => (a.kind === "interest" && a.liked ? [a.key] : []));
  const times = new Set<Profile["times"][number]>();
  for (const a of answers) if (a.kind === "times") a.keys.forEach((k) => times.add(k));
  const travel = answers.find((a): a is Extract<Answer, { kind: "travel" }> => a.kind === "travel");
  const budget = answers.find((a): a is Extract<Answer, { kind: "budget" }> => a.kind === "budget");
  const mobility = answers.find((a): a is Extract<Answer, { kind: "mobility" }> =>
    a.kind === "mobility" && WALKING_AID_OPTIONS.some((o) => o.key === a.key));
  const transportAnswer = answers.find((a): a is Extract<Answer, { kind: "transport" }> => a.kind === "transport");
  const transport = TRANSPORT_OPTIONS.filter((o) => transportAnswer?.modes.includes(o.key)).map((o) => o.key);
  const comfort = answers.find((a): a is Extract<Answer, { kind: "comfort" }> =>
    a.kind === "comfort" && typeof a.hearing === "boolean" && typeof a.smallGroups === "boolean");
  return {
    interests: liked.length ? liked : null,
    times: times.size ? TIME_OPTIONS.filter((o) => times.has(o.key)).map((o) => o.key) : null,
    travelMin: travel?.min ?? null,
    budget: budget?.amount ?? null,
    mobility: mobility?.key ?? null,
    transport: transport.length ? transport : null,
    comfort: comfort ? { hearing: comfort.hearing, smallGroups: comfort.smallGroups } : null,
  };
}

const MISSING_LABEL: Record<RequiredField, string> = {
  mobility: "walking aid",
  transport: "how you get places",
  comfort: "anything else that helps",
};

export function answersToProfile(answers: readonly Answer[], name: string): ProfileResult {
  const c = collect(answers);
  if (!c.mobility || !c.transport || !c.comfort) {
    const missing: RequiredField[] = [];
    if (!c.mobility) missing.push("mobility");
    if (!c.transport) missing.push("transport");
    if (!c.comfort) missing.push("comfort");
    return { ok: false, missing };
  }
  const defaults: DefaultedField[] = [];
  if (!c.interests) defaults.push("interests");
  if (!c.times) defaults.push("times");
  if (c.travelMin === null) defaults.push("travel");
  if (c.budget === null) defaults.push("budget");
  return {
    ok: true,
    defaults,
    profile: {
      name: name.trim() || "Friend",
      interests: c.interests ?? DEFAULT_INTERESTS,
      mobility: c.mobility,
      transport: c.transport,
      maxTravelMin: c.travelMin ?? DEFAULT_TRAVEL_MIN,
      times: c.times ?? DEFAULT_TIMES,
      budgetPerWeek: c.budget ?? DEFAULT_BUDGET,
      hearingImpaired: c.comfort.hearing,
      prefersSmallGroups: c.comfort.smallGroups,
    },
  };
}

export type ReviewField = DefaultedField | "mobility" | "transport" | "hearing" | "groupSize";
export type ReviewRow = { field: ReviewField; label: string; value: string; isDefault: boolean };

// Plain-words summary for the "Here's what we heard" step. Defaults are flagged, never presented as answers.
export function reviewRows(answers: readonly Answer[]): ReviewRow[] {
  const c = collect(answers);
  const labelOf = <K extends string>(opts: readonly { key: K; label: string }[], keys: readonly K[]) =>
    opts.filter((o) => keys.includes(o.key)).map((o) => o.label).join(", ");
  const travelBucket = (min: number) => TRAVEL_BUCKETS.find((b) => b.min === min);
  const travelText = (min: number) => { const b = travelBucket(min); return b ? `${b.label} (${b.detail})` : `About ${min} minutes`; };
  const budgetText = (amount: number) => { const b = BUDGET_OPTIONS.find((o) => o.amount === amount); return b ? `${b.label} (${b.detail})` : `Up to $${amount} a week`; };
  return [
    { field: "interests", label: "What you enjoy", value: labelOf(INTEREST_META, c.interests ?? DEFAULT_INTERESTS), isDefault: !c.interests },
    { field: "times", label: "When you're free", value: labelOf(TIME_OPTIONS, c.times ?? DEFAULT_TIMES), isDefault: !c.times },
    { field: "travel", label: "How far", value: travelText(c.travelMin ?? DEFAULT_TRAVEL_MIN), isDefault: c.travelMin === null },
    { field: "mobility", label: "Walking aid", value: c.mobility ? labelOf(WALKING_AID_OPTIONS, [c.mobility]) : "Not answered yet", isDefault: false },
    { field: "transport", label: "How you get places", value: c.transport ? labelOf(TRANSPORT_OPTIONS, c.transport) : "Not answered yet", isDefault: false },
    { field: "hearing", label: "Hearing", value: c.comfort ? (c.comfort.hearing ? "Noisy rooms are hard to hear in" : "No trouble hearing") : "Not answered yet", isDefault: false },
    { field: "groupSize", label: "Group size", value: c.comfort ? (c.comfort.smallGroups ? "Prefers small groups" : "Any size is fine") : "Not answered yet", isDefault: false },
    { field: "budget", label: "Weekly budget", value: budgetText(c.budget ?? DEFAULT_BUDGET), isDefault: c.budget === null },
  ];
}

// Change from the review step: swap one card's answer, keep every other answer as it was.
export function replaceAnswer(history: readonly (Answer | null)[], index: number, answer: Answer | null): (Answer | null)[] {
  return history.map((a, i) => (i === index ? answer : a));
}

type InterestKey = Profile["interests"][number];
export const INTEREST_COUNT = INTEREST_META.length;

export function toggleKey(picked: readonly InterestKey[], key: InterestKey): InterestKey[] {
  return picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
}

export function likedInterests(history: readonly (Answer | null)[]): InterestKey[] {
  return history.flatMap((a) => (a?.kind === "interest" && a.liked ? [a.key] : []));
}

// Grid picks -> one interest answer per card, in deck order. Covers at least the first
// `answeredCount` cards and every picked tile, so switching views never drops a pick.
export function pickedToHistory(picked: readonly InterestKey[], answeredCount: number): Answer[] {
  const lastPicked = Math.max(-1, ...INTEREST_META.map((m, i) => (picked.includes(m.key) ? i : -1)));
  return INTEREST_META.slice(0, Math.max(answeredCount, lastPicked + 1)).map((m) => ({
    kind: "interest",
    key: m.key,
    liked: picked.includes(m.key),
  }));
}

// Change "What you enjoy" from the review: new interest picks, every later answer kept.
export function replaceInterests(history: readonly (Answer | null)[], picked: readonly InterestKey[]): (Answer | null)[] {
  return [...pickedToHistory(picked, INTEREST_COUNT), ...history.slice(INTEREST_COUNT)];
}

// Fast double-taps land on the next card's button (same spot), so ignore answers
// arriving within this window of the previous one.
export const ANSWER_LOCKOUT_MS = 350;

export function isLockedOut(lastAt: number, now: number): boolean {
  return now - lastAt < ANSWER_LOCKOUT_MS;
}

// Read-only: true inside the lockout window, without claiming a slot.
function inLockout(lastAt: { current: number }): boolean {
  return isLockedOut(lastAt.current, Date.now());
}

// Claims the next answer slot, or returns false inside the lockout window.
function takeTurn(lastAt: { current: number }): boolean {
  const now = Date.now();
  if (isLockedOut(lastAt.current, now)) return false;
  lastAt.current = now;
  return true;
}

// Strong focus ring (outline-solid overrides the shadcn Button's outline-none).
const RING =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground";

export const SWIPE_THRESHOLD = 48;

export function swipeDirection(distance: number): 1 | -1 | null {
  return Math.abs(distance) >= SWIPE_THRESHOLD ? (distance > 0 ? 1 : -1) : null;
}

// A null entry records a skipped card, so Back always undoes exactly one card.
export function undoAnswer(history: readonly (Answer | null)[]): (Answer | null)[] {
  return history.slice(0, -1);
}

function SwipeCard({ onSwipe, disabled, children }: {
  onSwipe: (dir: 1 | -1) => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState({ x: 0, active: false });
  const pointer = useRef<{ id: number; start: number } | null>(null);
  const reset = () => {
    pointer.current = null;
    setDrag({ x: 0, active: false });
  };
  return (
    <div
      className="relative select-none motion-reduce:!transform-none motion-reduce:!transition-none"
      style={{
        transform: `translateX(${drag.x}px) rotate(${drag.x / 20}deg)`,
        touchAction: disabled ? "auto" : "pan-y",
        transition: drag.active ? "none" : "transform 180ms ease-out",
      }}
      onPointerDown={(e) => {
        if (disabled || !e.isPrimary || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
        pointer.current = { id: e.pointerId, start: e.clientX };
        setDrag({ x: 0, active: true });
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (pointer.current?.id !== e.pointerId) return;
        setDrag({ x: e.clientX - pointer.current.start, active: true });
      }}
      onPointerUp={(e) => {
        if (pointer.current?.id !== e.pointerId) return;
        const dir = swipeDirection(e.clientX - pointer.current.start);
        reset();
        if (dir && !disabled) onSwipe(dir);
      }}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute right-4 top-4 z-10 rounded-xl border-2 bg-background px-3 py-2 text-xl font-bold ${drag.x > 0 ? "border-green-800 text-green-800" : "border-red-800 text-red-800"}`}
        style={{ opacity: Math.min(Math.abs(drag.x) / SWIPE_THRESHOLD, 1) }}
      >
        {drag.x > 0 ? "LIKE" : "NOPE"}
      </span>
      {children}
    </div>
  );
}

function ActionRow({ onLike, onDislike, disabled, bigButtons }: {
  onLike: () => void;
  onDislike: () => void;
  disabled?: boolean;
  bigButtons: boolean;
}) {
  const size = bigButtons ? "min-h-20 text-2xl [&_svg]:!size-7" : "min-h-14 text-lg";
  return (
    <div className={`grid ${bigButtons ? "grid-cols-1" : "grid-cols-2"} gap-3 py-4`}>
      <Button variant="outline" size="lg" className={`${size} rounded-xl ${RING}`} onClick={onDislike} disabled={disabled}>
        <X aria-hidden="true" /> No
      </Button>
      <Button size="lg" className={`${size} rounded-xl ${RING}`} onClick={onLike} disabled={disabled}>
        <Heart aria-hidden="true" /> Yes
      </Button>
    </div>
  );
}

function InterestGrid({ picked, onToggle, onClear, onContinue, disabled }: {
  picked: readonly InterestKey[];
  onToggle: (key: InterestKey) => void;
  onClear: () => void;
  onContinue: () => void;
  disabled: boolean;
}) {
  const pill = `min-h-12 shrink-0 whitespace-nowrap rounded-full border-2 border-[#121212] px-4 text-lg sm:px-6 font-semibold disabled:opacity-50 dark:border-white ${RING}`;
  return (
    <section aria-labelledby="interest-grid-heading">
      <h2 id="interest-grid-heading" tabIndex={-1} data-step-focus className="mb-4 text-xl font-semibold outline-none md:text-2xl">
        What do you enjoy? Pick as many as you like.
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {INTEREST_META.map((m) => {
          const on = picked.includes(m.key);
          return (
            <button
              key={m.key}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(m.key)}
              // Tab doesn't scroll a tile that is already in the viewport, even when the sticky bar covers it.
              onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) e.currentTarget.scrollIntoView({ block: "nearest" }); }}
              className={`relative flex min-h-24 min-w-0 scroll-mb-32 flex-col items-center justify-center gap-1 rounded-xl p-3 text-center text-lg font-bold leading-tight break-words transition-colors motion-reduce:transition-none md:text-xl ${RING} ${on ? "bg-[#5a594e] text-white" : "bg-[#efefe6] text-[#121212] hover:bg-[#e2e2d6]"}`}
            >
              {on && <Check aria-hidden="true" className="absolute right-2 top-2 size-6" strokeWidth={3} />}
              <span aria-hidden="true" className="text-3xl">{m.emoji}</span>
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>
      {picked.length === 0 && (
        <p className="mt-4 text-center text-base text-muted-foreground">Not sure? Continue and we&apos;ll start you with learning new things.</p>
      )}
      {/* Sticky so Continue stays on screen on short laptop viewports; tiles carry scroll-mb-32 so a keyboard-focused tile scrolls clear of this bar (WCAG 2.4.11). */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center gap-2 border-t bg-background px-4 py-3 sm:gap-3">
        <p className="mr-auto whitespace-nowrap font-medium" aria-live="polite">{picked.length} picked</p>
        <button type="button" className={`${pill} bg-background`} onClick={onClear} disabled={disabled || picked.length === 0}>
          Clear all
        </button>
        <button type="button" className={`${pill} bg-[#121212] text-white dark:bg-white dark:text-[#121212]`} onClick={onContinue} disabled={disabled}>
          Continue
        </button>
      </div>
    </section>
  );
}

export function CardDeck({
  onComplete,
  initialName = "",
  loading = false,
  onDemo,
}: {
  onComplete: (profile: Profile) => void;
  initialName?: string;
  loading?: boolean;
  onDemo?: (key: string) => void;
}) {
  const cards = useMemo(() => buildCards(), []);
  const [history, setHistory] = useState<(Answer | null)[]>([]);
  const [bigButtons, setBigButtons] = useState(false);
  const [picked, setPicked] = useState<InterestKey[]>([]);
  // Card index being changed from the review step; null = normal forward flow.
  const [editing, setEditing] = useState<number | null>(null);
  const index = history.length;
  const at = editing ?? index;
  const showGrid = editing !== null ? editing < INTEREST_COUNT : bigButtons && index < INTEREST_COUNT;
  const answers = history.filter((answer): answer is Answer => answer !== null);
  const [name, setName] = useState(initialName);
  const lastRecordAt = useRef(-Infinity);
  const rootRef = useRef<HTMLDivElement>(null);
  // Set by user-driven step changes only, so first mount and view toggles never steal focus.
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    rootRef.current?.querySelector<HTMLElement>("[data-step-focus]")?.focus();
  }, [history, editing]);

  const changeStep = (next: (Answer | null)[] | ((prev: (Answer | null)[]) => (Answer | null)[])) => {
    moveFocus.current = true;
    setHistory(next);
  };
  // Double-tap lockout shared by every step-changing control.
  const guard = () => !loading && takeTurn(lastRecordAt);
  // Read-only check for picks inside a card: a tap that lands right after a step change
  // (the double-tap's second half) must not pre-select an answer on the new card.
  const locked = () => inLockout(lastRecordAt);
  const record = (answer: Answer | null) => {
    if (!guard()) return;
    if (editing !== null) {
      const target = editing;
      changeStep((prev) => replaceAnswer(prev, target, answer));
      setEditing(null);
    } else changeStep((prev) => [...prev, answer]);
  };
  const startEdit = (cardIndex: number) => {
    if (!guard()) return;
    if (cardIndex < INTEREST_COUNT) setPicked(likedInterests(history));
    moveFocus.current = true;
    setEditing(cardIndex);
  };
  const back = () => {
    if (editing !== null) {
      moveFocus.current = true;
      setEditing(null);
    } else if (bigButtons && index === INTEREST_COUNT) {
      // Easier view: Back from the times card reopens the grid with picks kept.
      setPicked(likedInterests(history));
      changeStep([]);
    } else changeStep(undoAnswer);
  };
  const toggleView = () => {
    if (editing === null && index < INTEREST_COUNT) {
      if (bigButtons) setHistory(pickedToHistory(picked, index));
      else setPicked(likedInterests(history));
    }
    setBigButtons((value) => !value);
  };

  const swipeCard = (dir: 1 | -1, interest: CardDef & { type: "interest" }) => {
    record({ kind: "interest", key: interest.interest.key, liked: dir > 0 });
  };

  if (editing === null && index >= cards.length) {
    const result = answersToProfile(answers, name);
    const cardFor = (field: ReviewField) =>
      field === "interests" ? 0 : cards.findIndex((c) => c.type === (field === "hearing" || field === "groupSize" ? "comfort" : field));
    return (
      <div ref={rootRef} className="db-fade-up mx-auto w-full max-w-md rounded-xl border bg-card p-6 text-base md:text-lg">
        <h2 tabIndex={-1} data-step-focus className="mb-1 text-2xl font-semibold outline-none">Here&apos;s what we heard</h2>
        <p className="mb-4 text-muted-foreground">Check your answers. Tap Change to fix anything.</p>
        <dl className="divide-y">
          {reviewRows(answers).map((row) => (
            <div key={row.field} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <dt className="font-medium text-muted-foreground">{row.label}</dt>
                <dd className="text-lg font-semibold break-words md:text-xl">
                  {row.value}
                  {row.isDefault && <span className="ml-1 font-normal text-muted-foreground">(default)</span>}
                </dd>
              </div>
              <Button
                size="lg"
                variant="outline"
                className={`min-h-14 shrink-0 rounded-xl px-4 text-lg ${RING}`}
                aria-label={`Change ${row.label.toLowerCase()}`}
                onClick={() => startEdit(cardFor(row.field))}
                disabled={loading}
              >
                Change
              </Button>
            </div>
          ))}
        </dl>
        {!result.ok && (
          <p className="mt-3 font-medium text-destructive" role="alert">
            Please answer {result.missing.map((m) => MISSING_LABEL[m]).join(" and ")} first.
          </p>
        )}
        <p className="mt-4 flex items-center gap-2 text-muted-foreground" aria-live="polite">
          {loading ? (
            <><LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" /> Finding matches…</>
          ) : (
            <>Ready to see {name.trim() ? `${name.trim()}'s` : "your"} matches?</>
          )}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <Button
            size="lg"
            className={`min-h-14 rounded-xl text-lg ${RING}`}
            onClick={() => { if (result.ok && guard()) onComplete(result.profile); }}
            disabled={loading || !result.ok}
          >
            See my matches
          </Button>
          <Button size="lg" variant="outline" className={`min-h-14 rounded-xl text-lg ${RING}`} onClick={back} disabled={loading}><ArrowLeft aria-hidden="true" /> Back</Button>
          <button
            disabled={loading}
            className={`min-h-11 rounded-xl px-3 text-base underline ${RING}`}
            onClick={() => {
              changeStep([]);
              setPicked([]);
            }}
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  const card = cards[at];
  const current = editing !== null ? history[editing] : null;
  // In the easier view the 10 interest cards collapse into one grid step.
  const stepCount = bigButtons ? cards.length - INTEREST_COUNT + 1 : cards.length;
  const step = bigButtons ? Math.max(0, index - INTEREST_COUNT + 1) : index;
  const progress = Math.round((step / stepCount) * 100);
  const option = `w-full rounded-xl border bg-background text-left hover:bg-accent ${RING} ${bigButtons ? "min-h-20 px-5 py-4 text-xl md:text-2xl" : "min-h-14 px-4 py-3"}`;
  const optionDetail = `mt-1 block text-muted-foreground ${bigButtons ? "text-lg md:text-xl" : "text-base md:text-lg"}`;

  return (
    <div ref={rootRef} className={`mx-auto w-full min-w-0 ${showGrid ? "max-w-3xl" : "max-w-md"} overflow-x-clip p-4 text-base md:text-lg`}>
      {onDemo && index === 0 && !showGrid && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Button size="lg" className={`min-h-14 rounded-xl text-lg ${RING}`} onClick={() => onDemo("margaret")} disabled={loading}>Demo: Margaret</Button>
          <Button size="lg" variant="outline" className={`min-h-14 rounded-xl text-lg ${RING}`} onClick={() => onDemo("harold")} disabled={loading}>Demo: Harold</Button>
        </div>
      )}
      <Button
        size="lg"
        variant={bigButtons ? "default" : "outline"}
        aria-pressed={bigButtons}
        onClick={toggleView}
        className={`mb-3 min-h-14 w-full rounded-xl text-lg ${RING}`}
      >
        {bigButtons && <Check aria-hidden="true" />} Easier view (big tiles): {bigButtons ? "on" : "off"}
      </Button>
      <div className="mb-3">
        <Button size="lg" variant="outline" className={RING} onClick={back} disabled={editing === null && (index === 0 || showGrid || loading)}>
          <ArrowLeft aria-hidden="true" /> {editing !== null ? "Back to review" : "Back"}
        </Button>
      </div>
      {editing !== null ? (
        <p className="mb-4 font-medium" aria-live="polite">Changing one answer — the rest stay as they are.</p>
      ) : (
        <>
          <p className="mb-2 font-medium" aria-live="polite">{bigButtons ? "Step" : "Card"} {step + 1} of {stepCount}</p>
          <div role="progressbar" aria-label="Cards completed" aria-valuemin={0} aria-valuemax={stepCount} aria-valuenow={step} className="mb-4 h-3 overflow-hidden rounded-full bg-muted">
            <div className="db-progress h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        </>
      )}

      <label className="mb-4 block">
        <span className="mb-1 block text-base md:text-lg font-medium">First, what should we call you?</span>
        <input
          className={`w-full min-h-11 rounded-xl border bg-background px-3 py-2 text-base md:text-lg ${RING}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Margaret"
          maxLength={60}
        />
      </label>

      {/* Re-keyed per step so each new card fades up once; focus still moves via data-step-focus after commit. */}
      <div key={showGrid ? "grid" : `card-${at}`} className="db-fade-up">
      {showGrid && (
        <InterestGrid
          picked={picked}
          disabled={loading}
          onToggle={(key) => setPicked((prev) => toggleKey(prev, key))}
          onClear={() => setPicked([])}
          onContinue={() => {
            if (!guard()) return;
            if (editing !== null) {
              changeStep((prev) => replaceInterests(prev, picked));
              setEditing(null);
            } else changeStep(pickedToHistory(picked, INTEREST_COUNT));
          }}
        />
      )}

      {!showGrid && card.type === "interest" && (
        <div
          tabIndex={0}
          data-step-focus
          role="group"
          aria-label={`${card.interest.label}. Left arrow for no, right arrow for yes.`}
          className={`rounded-xl ${RING}`}
          onKeyDown={(event) => {
            if (loading || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              swipeCard(event.key === "ArrowRight" ? 1 : -1, card);
            }
          }}
        >
        <SwipeCard key={index} disabled={loading || bigButtons} onSwipe={(dir) => swipeCard(dir, card)}>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="mb-4 text-base md:text-lg font-medium text-muted-foreground">Would you enjoy this?</p>
          <div className="mb-6 text-center">
            <div className="text-7xl">{card.interest.emoji}</div>
            <p className="mt-3 text-2xl font-semibold">{card.interest.label}</p>
          </div>
          <ActionRow
            onLike={() => swipeCard(1, card)}
            onDislike={() => swipeCard(-1, card)}
            disabled={loading}
            bigButtons={bigButtons}
          />
          {!bigButtons && <p className="text-center text-base">Swipe or use ← No / Yes →</p>}
        </div>
        </SwipeCard>
        </div>
      )}

      {card.type === "times" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 tabIndex={-1} data-step-focus className="mb-4 text-xl font-semibold outline-none">When are you usually free?</h2>
          <TimeChoices
            key={at}
            initial={current?.kind === "times" ? current.keys : []}
            onPick={(keys) => record({ kind: "times", keys })}
            disabled={loading}
            bigButtons={bigButtons}
          />
          <SkipRow onSkip={() => record(null)} />
        </div>
      )}

      {card.type === "travel" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 tabIndex={-1} data-step-focus className="mb-1 text-xl font-semibold outline-none">How far is too far?</h2>
          <p className="mb-4 text-base md:text-lg text-muted-foreground">Pick what feels right.</p>
          <div className="space-y-2">
            {TRAVEL_BUCKETS.map((b) => (
              <button
                disabled={loading}
                key={b.min}
                className={option}
                onClick={() => {
                  record({ kind: "travel", min: b.min });
                }}
              >
                <span className="font-medium">{b.label}</span>
                <span className={optionDetail}>{b.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {card.type === "mobility" && (
        <ChoiceCard
          key={at}
          multi={false}
          heading="Do you use anything to help you walk?"
          helper="Pick one."
          options={WALKING_AID_OPTIONS}
          initial={current?.kind === "mobility" ? [current.key] : []}
          disabled={loading}
          locked={locked}
          bigButtons={bigButtons}
          onDone={([key]) => record({ kind: "mobility", key })}
        />
      )}

      {card.type === "transport" && (
        <ChoiceCard
          key={at}
          multi
          heading="How do you usually get places?"
          helper="Pick all that apply. We'll only plan trips you can actually make."
          options={TRANSPORT_OPTIONS}
          initial={current?.kind === "transport" ? current.modes : []}
          disabled={loading}
          locked={locked}
          bigButtons={bigButtons}
          onDone={(modes) => record({ kind: "transport", modes })}
        />
      )}

      {card.type === "comfort" && (
        <ChoiceCard
          key={at}
          multi
          exclusive={COMFORT_NEITHER}
          heading="Anything else that helps?"
          helper="Pick any that apply."
          options={COMFORT_OPTIONS}
          initial={current?.kind === "comfort" ? comfortToKeys(current) : []}
          disabled={loading}
          locked={locked}
          bigButtons={bigButtons}
          onDone={(keys) => record(comfortFromKeys(keys))}
        />
      )}

      {card.type === "budget" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 tabIndex={-1} data-step-focus className="mb-1 text-xl font-semibold outline-none">What&apos;s a comfortable weekly budget?</h2>
          <p className="mb-4 text-base md:text-lg text-muted-foreground">Many of the best activities are free.</p>
          <div className="space-y-2">
            {BUDGET_OPTIONS.map((b) => (
              <button
                disabled={loading}
                key={b.amount}
                className={option}
                onClick={() => {
                  record({ kind: "budget", amount: b.amount });
                }}
              >
                <span className="font-medium">{b.label}</span>
                <span className={optionDetail}>{b.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// Required question: native radios (single) or checkboxes (multi); Continue stays disabled until something is picked.
function ChoiceCard<K extends string>({ multi, exclusive, heading, helper, options, initial, disabled, locked, bigButtons, onDone }: {
  multi: boolean;
  // Multi only: an option that clears the others when picked (and is cleared by any other pick).
  exclusive?: K;
  heading: string;
  helper: string;
  options: readonly { key: K; label: string; emoji?: string }[];
  initial: readonly K[];
  disabled: boolean;
  // True inside the double-tap lockout window; picks are ignored (the controlled input stays as it was).
  locked: () => boolean;
  bigButtons: boolean;
  onDone: (keys: [K, ...K[]]) => void;
}) {
  const [selected, setSelected] = useState<K[]>([...initial]);
  const headingId = useId();
  const choice = `flex w-full cursor-pointer items-center gap-4 rounded-xl border-2 bg-background text-left font-medium hover:bg-accent has-[:checked]:border-foreground has-[:checked]:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground ${bigButtons ? "min-h-20 px-5 py-4 text-xl md:text-2xl" : "min-h-14 px-4 py-3 text-lg"}`;
  const ordered = options.filter((o) => selected.includes(o.key)).map((o) => o.key);
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h2 id={headingId} tabIndex={-1} data-step-focus className="mb-1 text-xl font-semibold outline-none">{heading}</h2>
      <p className="mb-4 text-base md:text-lg text-muted-foreground">{helper}</p>
      <div role={multi ? "group" : "radiogroup"} aria-labelledby={headingId} aria-required="true" className="space-y-2">
        {options.map((o) => (
          <label key={o.key} className={choice}>
            <input
              type={multi ? "checkbox" : "radio"}
              name={headingId}
              value={o.key}
              checked={selected.includes(o.key)}
              disabled={disabled}
              onChange={() => {
                if (locked()) return;
                setSelected((prev) => (multi ? toggleChoice(prev, o.key, exclusive) : [o.key]));
              }}
              className="size-6 shrink-0 accent-foreground outline-none"
            />
            {o.emoji && <span aria-hidden="true" className="text-2xl">{o.emoji}</span>}
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {ordered.length === 0 && (
        <p className="mt-3 text-base text-muted-foreground">{multi ? "Pick at least one to continue." : "Pick one to continue."}</p>
      )}
      <Button
        size="lg"
        className={`mt-4 w-full rounded-xl ${bigButtons ? "min-h-20 text-xl md:text-2xl" : "min-h-14 text-lg"} ${RING}`}
        disabled={disabled || ordered.length === 0}
        onClick={() => { if (ordered.length) onDone(ordered as [K, ...K[]]); }}
      >
        Continue
      </Button>
    </div>
  );
}

function TimeChoices({ initial, onPick, disabled, bigButtons }: {
  initial: readonly Profile["times"][number][];
  onPick: (keys: Profile["times"][number][]) => void;
  disabled: boolean;
  bigButtons: boolean;
}) {
  const size = bigButtons ? "min-h-20 text-xl md:text-2xl" : "min-h-14 text-base md:text-lg";
  const [selected, setSelected] = useState<Profile["times"][number][]>([...initial]);
  return (
    <div className="space-y-3">
      {TIME_OPTIONS.map((option) => (
        <Button key={option.key} size="lg" variant={selected.includes(option.key) ? "default" : "outline"}
          className={`${size} w-full justify-start rounded-xl ${RING}`}
          aria-pressed={selected.includes(option.key)} disabled={disabled}
          onClick={() => setSelected((prev) => prev.includes(option.key) ? prev.filter((key) => key !== option.key) : [...prev, option.key])}>
          <span aria-hidden="true">{option.emoji}</span> {option.label}
        </Button>
      ))}
      <Button size="lg" className={`${bigButtons ? "min-h-20 text-xl md:text-2xl" : "min-h-11"} w-full rounded-xl ${RING}`} disabled={disabled || selected.length === 0} onClick={() => onPick(selected)}>Next</Button>
    </div>
  );
}

function SkipRow({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="pt-2 text-center">
      <button type="button" className={`min-h-11 rounded-xl px-3 text-base underline ${RING}`} onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}
