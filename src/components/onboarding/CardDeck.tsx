"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Heart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/schema";

// Swipe-card onboarding: produces the same Profile as the manual form.
// Dislike on an interest card only removes it from the running set — never blocks.

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

export const STAIR_OPTIONS = [
  { key: "fine", label: "No big deal", detail: "Stairs are fine" },
  { key: "hassle", label: "A hassle", detail: "I can, but prefer not to" },
  { key: "avoid", label: "Hard for me", detail: "I'd rather avoid them" },
] as const;

export type Answer =
  | { kind: "interest"; key: Profile["interests"][number]; liked: boolean }
  | { kind: "travel"; min: number }
  | { kind: "mobility"; key: (typeof STAIR_OPTIONS)[number]["key"] }
  | { kind: "times"; keys: Profile["times"][number][] }
  | { kind: "budget"; amount: number };

type CardDef =
  | { type: "interest"; interest: (typeof INTEREST_META)[number] }
  | { type: "travel" }
  | { type: "mobility" }
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
    { type: "budget" },
  ];
}

const BUDGET_OPTIONS = [
  { amount: 0, label: "Free only", detail: "$0 a week" },
  { amount: 10, label: "A little", detail: "up to $10 a week" },
  { amount: 25, label: "Flexible", detail: "up to $25 a week" },
  { amount: 50, label: "Whatever's worth it", detail: "up to $50 a week" },
] as const;

export function answersToProfile(answers: Answer[], name: string): Profile {
  const likedInterests = answers
    .filter((a): a is Extract<Answer, { kind: "interest" }> => a.kind === "interest" && a.liked)
    .map((a) => a.key);
  const times = new Set<Profile["times"][number]>();
  for (const a of answers) if (a.kind === "times") a.keys.forEach((k) => times.add(k));
  const travel = answers.find((a): a is Extract<Answer, { kind: "travel" }> => a.kind === "travel");
  const mobility = answers.find((a): a is Extract<Answer, { kind: "mobility" }> => a.kind === "mobility");
  const budget = answers.find((a): a is Extract<Answer, { kind: "budget" }> => a.kind === "budget");

  const mobilityValue: Profile["mobility"] =
    mobility?.key === "avoid" ? "walker" : mobility?.key === "hassle" ? "cane" : "full";

  return {
    name: name.trim() || "Friend",
    interests: likedInterests.length ? likedInterests : ["learning"],
    mobility: mobilityValue,
    transport: mobilityValue === "full" ? ["drive", "walk", "bus"] : ["bus", "paratransit", "family"],
    maxTravelMin: travel?.min ?? 30,
    times: times.size ? [...times] : ["morning", "afternoon"],
    budgetPerWeek: budget?.amount ?? 10,
    hearingImpaired: false,
    prefersSmallGroups: false,
  };
}

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
  return (
    <div className="grid grid-cols-2 gap-3 py-4">
      <Button variant="outline" size="lg" className={`${bigButtons ? "min-h-16" : "min-h-14"} rounded-xl text-lg`} onClick={onDislike} disabled={disabled}>
        <X aria-hidden="true" /> No
      </Button>
      <Button size="lg" className={`${bigButtons ? "min-h-16" : "min-h-14"} rounded-xl text-lg`} onClick={onLike} disabled={disabled}>
        <Heart aria-hidden="true" /> Yes
      </Button>
    </div>
  );
}

export function CardDeck({
  onComplete,
  initialName = "",
  loading = false,
}: {
  onComplete: (profile: Profile) => void;
  initialName?: string;
  loading?: boolean;
}) {
  const cards = useMemo(() => buildCards(), []);
  const [history, setHistory] = useState<(Answer | null)[]>([]);
  const [bigButtons, setBigButtons] = useState(false);
  const index = history.length;
  const answers = history.filter((answer): answer is Answer => answer !== null);
  const [name, setName] = useState(initialName);

  const record = (answer: Answer | null) => {
    if (!loading) setHistory((prev) => [...prev, answer]);
  };
  const back = () => setHistory(undoAnswer);

  const swipeCard = (dir: 1 | -1, interest: CardDef & { type: "interest" }) => {
    record({ kind: "interest", key: interest.interest.key, liked: dir > 0 });
  };

  if (index >= cards.length) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center text-base md:text-lg">
        <div className="text-5xl">🎉</div>
        <p className="text-xl font-semibold">All set!</p>
        <p className="text-muted-foreground">
          We&apos;re finding {name.trim() || "your"} matches this week…
        </p>
        <Button size="lg" onClick={() => onComplete(answersToProfile(answers, name))} disabled={loading}>
          {loading ? "Building plan…" : "See my matches"}
        </Button>
        <Button size="lg" variant="outline" onClick={back} disabled={loading}><ArrowLeft aria-hidden="true" /> Back</Button>
        <button
          disabled={loading}
          className="min-h-11 rounded-xl px-3 text-base underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => {
            setHistory([]);
          }}
        >
          Start over
        </button>
      </div>
    );
  }

  const card = cards[index];
  const progress = Math.round((index / cards.length) * 100);

  return (
    <div className="mx-auto w-full min-w-0 max-w-md overflow-x-clip p-4 text-base md:text-lg [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-ring">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Button size="lg" variant="outline" onClick={back} disabled={index === 0 || loading}>
          <ArrowLeft aria-hidden="true" /> Back
        </Button>
        <Button size="lg" variant="outline" aria-pressed={bigButtons} onClick={() => setBigButtons((value) => !value)}>
          Big buttons{bigButtons ? ": on" : ": off"}
        </Button>
      </div>
      <p className="mb-2 font-medium" aria-live="polite">Card {index + 1} of {cards.length}</p>
      <div role="progressbar" aria-label="Cards completed" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={index} className="mb-4 h-3 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
      </div>

      <label className="mb-4 block">
        <span className="mb-1 block text-base md:text-lg font-medium">First, what should we call you?</span>
        <input
          className="w-full min-h-11 rounded-xl border bg-background px-3 py-2 text-base md:text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Margaret"
          maxLength={60}
        />
      </label>

      {card.type === "interest" && (
        <div
          tabIndex={0}
          role="group"
          aria-label={`${card.interest.label}. Left arrow for no, right arrow for yes.`}
          className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
          <p className="mb-4 text-xl font-semibold">When are you usually free?</p>
          <TimeChoices onPick={(keys) => record({ kind: "times", keys })} disabled={loading} />
          <SkipRow onSkip={() => record(null)} />
        </div>
      )}

      {card.type === "travel" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="mb-1 text-xl font-semibold">How far is too far?</p>
          <p className="mb-4 text-base md:text-lg text-muted-foreground">Pick what feels right.</p>
          <div className="space-y-2">
            {TRAVEL_BUCKETS.map((b) => (
              <button
                disabled={loading}
                key={b.min}
                className="w-full min-h-14 rounded-xl border bg-background px-4 py-3 text-left hover:bg-accent"
                onClick={() => {
                  record({ kind: "travel", min: b.min });
                }}
              >
                <span className="font-medium">{b.label}</span>
                <span className="mt-1 block text-base md:text-lg text-muted-foreground">{b.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {card.type === "mobility" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="mb-1 text-xl font-semibold">What about stairs?</p>
          <p className="mb-4 text-base md:text-lg text-muted-foreground">
            Just so we can match you with places you&apos;ll find easy to get into.
          </p>
          <div className="space-y-2">
            {STAIR_OPTIONS.map((s) => (
              <button
                disabled={loading}
                key={s.key}
                className="w-full min-h-14 rounded-xl border bg-background px-4 py-3 text-left hover:bg-accent"
                onClick={() => {
                  record({ kind: "mobility", key: s.key });
                }}
              >
                <span className="font-medium">{s.label}</span>
                <span className="mt-1 block text-base md:text-lg text-muted-foreground">{s.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {card.type === "budget" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="mb-1 text-xl font-semibold">What&apos;s a comfortable weekly budget?</p>
          <p className="mb-4 text-base md:text-lg text-muted-foreground">Many of the best activities are free.</p>
          <div className="space-y-2">
            {BUDGET_OPTIONS.map((b) => (
              <button
                disabled={loading}
                key={b.amount}
                className="w-full min-h-14 rounded-xl border bg-background px-4 py-3 text-left hover:bg-accent"
                onClick={() => {
                  record({ kind: "budget", amount: b.amount });
                }}
              >
                <span className="font-medium">{b.label}</span>
                <span className="mt-1 block text-base md:text-lg text-muted-foreground">{b.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeChoices({ onPick, disabled }: {
  onPick: (keys: Profile["times"][number][]) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<Profile["times"][number][]>([]);
  return (
    <div className="space-y-3">
      {TIME_OPTIONS.map((option) => (
        <Button key={option.key} size="lg" variant={selected.includes(option.key) ? "default" : "outline"}
          className="min-h-14 w-full justify-start rounded-xl text-base md:text-lg"
          aria-pressed={selected.includes(option.key)} disabled={disabled}
          onClick={() => setSelected((prev) => prev.includes(option.key) ? prev.filter((key) => key !== option.key) : [...prev, option.key])}>
          <span aria-hidden="true">{option.emoji}</span> {option.label}
        </Button>
      ))}
      <Button size="lg" className="min-h-11 w-full rounded-xl" disabled={disabled || selected.length === 0} onClick={() => onPick(selected)}>Next</Button>
    </div>
  );
}

function SkipRow({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="pt-2 text-center">
      <button className="min-h-11 rounded-xl px-3 text-base underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}
