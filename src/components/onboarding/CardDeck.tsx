"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
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

// Framer-free swipe: pointer events + transforms, spring-less so it feels predictable.
function SwipeCard({
  onSwipe,
  children,
}: {
  onSwipe: (dir: 1 | -1) => void;
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState({ x: 0, rot: 0, dragging: false });
  const start = useRef<number | null>(null);
  const id = useId();

  const end = useCallback(() => {
    if (start.current === null) return;
    const x = drag.x;
    start.current = null;
    if (Math.abs(x) > 90) {
      onSwipe(x > 0 ? 1 : -1);
      setDrag({ x: 0, rot: 0, dragging: false });
    } else {
      setDrag({ x: 0, rot: 0, dragging: false });
    }
  }, [drag.x, onSwipe]);

  const style = {
    transform: `translateX(${drag.x}px) rotate(${drag.rot}deg)`,
    touchAction: "none" as const,
    transition: drag.dragging ? "none" : "transform 180ms ease-out",
  };

  return (
    <div
      className="select-none"
      style={style}
      onPointerDown={(e) => {
        start.current = e.clientX;
        setDrag((d) => ({ ...d, dragging: true }));
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const dx = e.clientX - start.current;
        setDrag({ x: dx, rot: dx / 18, dragging: true });
      }}
      onPointerUp={end}
      onPointerCancel={end}
      data-card-id={id}
    >
      {children}
    </div>
  );
}

function ActionRow({
  onLike,
  onDislike,
  disabled,
}: {
  onLike: () => void;
  onDislike: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-center gap-6 py-4">
      <Button
        variant="outline"
        size="lg"
        className="size-16 rounded-full text-2xl"
        onClick={onDislike}
        disabled={disabled}
        aria-label="Not for me"
      >
        ✕
      </Button>
      <Button
        size="lg"
        className="size-16 rounded-full text-2xl"
        onClick={onLike}
        disabled={disabled}
        aria-label="Interested"
      >
        ❤️
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
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [name, setName] = useState(initialName);

  const record = (a: Answer) => setAnswers((prev) => [...prev, a]);
  const advance = () => setIndex((i) => i + 1);

  const swipeCard = (dir: 1 | -1, interest: CardDef & { type: "interest" }) => {
    record({ kind: "interest", key: interest.interest.key, liked: dir > 0 });
    advance();
  };

  if (index >= cards.length) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center">
        <div className="text-5xl">🎉</div>
        <p className="text-xl font-semibold">All set!</p>
        <p className="text-muted-foreground">
          We&apos;re finding {name.trim() || "your"} matches this week…
        </p>
        <Button onClick={() => onComplete(answersToProfile(answers, name))} disabled={loading}>
          {loading ? "Building plan…" : "See my matches"}
        </Button>
        <button
          className="text-sm text-muted-foreground underline"
          onClick={() => {
            setIndex(0);
            setAnswers([]);
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
    <div className="mx-auto w-full max-w-md p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-sm text-muted-foreground">
          {index + 1} / {cards.length}
        </span>
      </div>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium">First, what should we call you?</span>
        <input
          className="w-full rounded-md border bg-background px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Margaret"
          maxLength={60}
        />
      </label>

      {card.type === "interest" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="mb-4 text-sm font-medium text-muted-foreground">Would you enjoy this?</p>
          <div className="mb-6 text-center">
            <div className="text-7xl">{card.interest.emoji}</div>
            <p className="mt-3 text-2xl font-semibold">{card.interest.label}</p>
          </div>
          <ActionRow
            onLike={() => swipeCard(1, card)}
            onDislike={() => swipeCard(-1, card)}
            disabled={loading}
          />
        </div>
      )}

      {card.type === "times" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="mb-4 text-xl font-semibold">When are you usually free?</p>
          <div className="space-y-2">
            {TIME_OPTIONS.map((t) => (
              <TimeToggle
                key={t.key}
                option={t}
                onPick={(keys) => {
                  record({ kind: "times", keys });
                  advance();
                }}
              />
            ))}
          </div>
          <SkipRow onSkip={() => advance()} />
        </div>
      )}

      {card.type === "travel" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="mb-1 text-xl font-semibold">How far is too far?</p>
          <p className="mb-4 text-sm text-muted-foreground">Pick what feels right.</p>
          <div className="space-y-2">
            {TRAVEL_BUCKETS.map((b) => (
              <button
                key={b.min}
                className="w-full rounded-lg border bg-background px-4 py-3 text-left hover:bg-accent"
                onClick={() => {
                  record({ kind: "travel", min: b.min });
                  advance();
                }}
              >
                <span className="font-medium">{b.label}</span>
                <span className="ml-2 text-sm text-muted-foreground">{b.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {card.type === "mobility" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="mb-1 text-xl font-semibold">What about stairs?</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Just so we can match you with places you&apos;ll find easy to get into.
          </p>
          <div className="space-y-2">
            {STAIR_OPTIONS.map((s) => (
              <button
                key={s.key}
                className="w-full rounded-lg border bg-background px-4 py-3 text-left hover:bg-accent"
                onClick={() => {
                  record({ kind: "mobility", key: s.key });
                  advance();
                }}
              >
                <span className="font-medium">{s.label}</span>
                <span className="ml-2 text-sm text-muted-foreground">{s.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {card.type === "budget" && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="mb-1 text-xl font-semibold">What&apos;s a comfortable weekly budget?</p>
          <p className="mb-4 text-sm text-muted-foreground">Many of the best activities are free.</p>
          <div className="space-y-2">
            {BUDGET_OPTIONS.map((b) => (
              <button
                key={b.amount}
                className="w-full rounded-lg border bg-background px-4 py-3 text-left hover:bg-accent"
                onClick={() => {
                  record({ kind: "budget", amount: b.amount });
                  advance();
                }}
              >
                <span className="font-medium">{b.label}</span>
                <span className="ml-2 text-sm text-muted-foreground">{b.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeToggle({
  option,
  onPick,
}: {
  option: { key: Profile["times"][number]; emoji: string; label: string };
  onPick: (keys: Profile["times"][number][]) => void;
}) {
  const [on, setOn] = useState<Profile["times"][number][]>([]);
  const toggle = (k: Profile["times"][number]) =>
    setOn((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  return (
    <div className="flex items-center justify-between rounded-lg border bg-background px-4 py-3">
      <span className="font-medium">
        {option.emoji} {option.label}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={on.includes(option.key)}
          onClick={() => toggle(option.key)}
        >
          {on.includes(option.key) ? "✓ Picked" : "Pick"}
        </Button>
        <Button size="sm" disabled={!on.includes(option.key)} onClick={() => onPick(on)}>
          Next
        </Button>
      </div>
    </div>
  );
}

function SkipRow({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="pt-2 text-center">
      <button className="text-sm text-muted-foreground underline" onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}
