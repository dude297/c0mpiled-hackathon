// Native onboarding. Order:
// name → 10 interests → times → travel → walking aid → how you get places → anything else that helps
// (hearing / group size) → budget → review ("Here's what we heard", each answer with Change)
// → answersToProfile → analyze → Matches.
// Walking aid, transport, hearing and group size are always asked, never inferred or defaulted;
// analyze can't run until all are answered.
// Interests: swipe deck (default), the Easier view grid, or Hands-free (look / head tilt answers the
// same swipe cards). Switching modes keeps every answer.
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChoiceStep } from '@/components/onboarding/ChoiceStep';
import { HandsFreeDeck } from '@/components/onboarding/HandsFree';
import { InterestGrid } from '@/components/onboarding/InterestGrid';
import { NameStep, type AnswerMode, type DemoKey } from '@/components/onboarding/NameStep';
import { ReviewStep } from '@/components/onboarding/ReviewStep';
import { SwipeDeck } from '@/components/onboarding/SwipeDeck';
import { PillButton } from '@/components/onboarding/ui';
import {
  answersToProfile,
  BUDGET_OPTIONS,
  COMFORT_OPTIONS,
  INTEREST_META,
  MOBILITY_OPTIONS,
  reviewRows,
  TIME_OPTIONS,
  TRANSPORT_OPTIONS,
  TRAVEL_BUCKETS,
  toggleComfort,
  type Answer,
  type ComfortKey,
  type ReviewField,
} from '@/lib/onboarding';
import { DEMO_PROFILES } from '@/domain/activities';
import type { Profile } from '@/lib/schema';
import { useApp } from '@/lib/store';
import { colors, radius, space, tap, type } from '@/lib/theme';

type Key = (typeof INTEREST_META)[number]['key'];
type TimeSlot = (typeof TIME_OPTIONS)[number]['key'];
type MobilityKey = (typeof MOBILITY_OPTIONS)[number]['key'];
type TransportKey = (typeof TRANSPORT_OPTIONS)[number]['key'];

const STEPS = ['name', 'interests', 'times', 'travel', 'mobility', 'transport', 'comfort', 'budget', 'review'] as const;
const stepOf = (f: (typeof STEPS)[number]) => STEPS.indexOf(f);
const LAST = INTEREST_META.length - 1;

// Answers rebuilt from the last matched profile, so "Change my answers" / Back from Matches lands on the
// review with everything kept (also after a demo).
function draftFrom(p: Profile, first: string | null) {
  const comfort: ComfortKey[] = [...(p.hearingImpaired ? ['hearing' as const] : []), ...(p.prefersSmallGroups ? ['smallGroups' as const] : [])];
  return {
    name: first ?? '',
    liked: Object.fromEntries(INTEREST_META.map((i) => [i.key, p.interests.includes(i.key)])) as Partial<Record<Key, boolean>>,
    times: [...p.times] as TimeSlot[],
    travel: p.maxTravelMin,
    mobility: p.mobility as MobilityKey,
    transport: [...p.transport] as TransportKey[],
    comfort: comfort.length ? comfort : (['neither'] as ComfortKey[]),
    budget: p.budgetPerWeek,
  };
}

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { analyze, loading, profile, firstName } = useApp();
  const [d0] = useState(() => (profile ? draftFrom(profile, firstName) : null));

  const [step, setStep] = useState(d0 ? STEPS.length - 1 : 0);
  const [name, setName] = useState(d0?.name ?? '');
  const [easy, setEasy] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [liked, setLiked] = useState<Partial<Record<Key, boolean>>>(d0?.liked ?? {});
  const [cursor, setCursor] = useState(d0 ? INTEREST_META.length : 0); // swipe deck position
  const [enterFrom, setEnterFrom] = useState<1 | -1 | null>(null);
  const [times, setTimes] = useState<TimeSlot[]>(d0?.times ?? []);
  const [travel, setTravel] = useState<number | null>(d0?.travel ?? null);
  const [mobility, setMobility] = useState<MobilityKey | null>(d0?.mobility ?? null);
  const [transport, setTransport] = useState<TransportKey[]>(d0?.transport ?? []);
  const [comfort, setComfort] = useState<ComfortKey[]>(d0?.comfort ?? []);
  const [budget, setBudget] = useState<number | null>(d0?.budget ?? null);
  const [editing, setEditing] = useState(false); // came from the review's Change: Continue returns there
  const submitting = useRef(false); // double-tap lockout for See my matches
  const seen = useRef<Profile | null>(profile); // last profile these answers came from (ours or a demo's)

  // A demo matched while this screen stays mounted under the tabs: load its answers so Back / Change
  // lands on the review. Our own finish() already holds the answers (and keeps "(default)" labels).
  useEffect(() => {
    if (!profile || profile === seen.current) return;
    seen.current = profile;
    const d = draftFrom(profile, firstName);
    setName(d.name);
    setLiked(d.liked);
    setCursor(INTEREST_META.length);
    setTimes(d.times);
    setTravel(d.travel);
    setMobility(d.mobility);
    setTransport(d.transport);
    setComfort(d.comfort);
    setBudget(d.budget);
    setEditing(false);
    setStep(stepOf('review'));
  }, [profile, firstName]);

  const current = STEPS[step];
  const next = () => {
    if (editing) {
      setEditing(false);
      return setStep(stepOf('review'));
    }
    setStep((i) => Math.min(i + 1, STEPS.length - 1));
  };

  // "3 of 18" in swipe mode (name + 10 cards + 6 questions + review); "3 of 9" in easier view.
  const interestSpan = easy ? 1 : INTEREST_META.length;
  const total = 1 + interestSpan + STEPS.length - 2;
  const pos = current === 'name' ? 1 : current === 'interests' ? 2 + (easy ? 0 : cursor) : interestSpan + step;

  const undoCard = (to: number) => {
    const key = INTEREST_META[to].key;
    setEnterFrom(liked[key] === false ? -1 : 1);
    setLiked(({ [key]: _, ...rest }) => rest);
    setCursor(to);
  };

  // Back keeps `editing`: after a Change, stepping back (or undoing a swipe card) still returns to the review.
  const back = () => {
    if (current === 'interests' && !easy && cursor > 0) return undoCard(cursor - 1);
    if (current === 'times' && !easy) {
      undoCard(LAST);
      return setStep(1);
    }
    setStep((i) => Math.max(i - 1, 0));
  };

  const answerCard = (key: Key, yes: boolean) => {
    setLiked((p) => ({ ...p, [key]: yes }));
    setEnterFrom(null);
    if (cursor >= LAST) {
      setCursor(INTEREST_META.length);
      next();
    } else setCursor(cursor + 1);
  };

  const toggleEasy = (v: boolean) => {
    setEasy(v);
    if (v) setHandsFree(false);
    setEnterFrom(null);
    if (!v && cursor > LAST) setCursor(LAST); // back to cards: show the last one, answers kept
  };

  const mode: AnswerMode = easy ? 'easy' : handsFree ? 'hands' : 'swipe';
  const setMode = (m: AnswerMode) => {
    toggleEasy(m === 'easy');
    setHandsFree(m === 'hands');
  };

  const answers = (): Answer[] => [
    ...INTEREST_META.filter((i) => liked[i.key] !== undefined).map(
      (i): Answer => ({ kind: 'interest', key: i.key, liked: !!liked[i.key] }),
    ),
    ...(times.length ? [{ kind: 'times', keys: times } as const] : []),
    ...(travel !== null ? [{ kind: 'travel', min: travel } as const] : []),
    ...(mobility ? [{ kind: 'mobility', key: mobility } as const] : []),
    ...(transport.length ? [{ kind: 'transport', keys: transport } as const] : []),
    ...(comfort.length ? [{ kind: 'comfort', keys: comfort } as const] : []),
    ...(budget !== null ? [{ kind: 'budget', amount: budget } as const] : []),
  ];

  // Change on the review: jump to that card with every other answer kept; Continue comes back here.
  const change = (field: ReviewField) => {
    setEditing(true);
    if (field === 'interests') {
      setEnterFrom(null);
      setCursor(0); // swipe mode re-asks from the first card, overwriting one answer at a time
    }
    setStep(stepOf(field));
  };

  const finish = async () => {
    if (submitting.current || loading) return;
    const result = answersToProfile(answers(), name);
    if (!result.ok) {
      // Never guess walking aid, transport, hearing or group size: go ask the first missing one.
      setEditing(true);
      return setStep(stepOf(result.missing[0]));
    }
    submitting.current = true;
    seen.current = result.profile;
    try {
      await analyze(result.profile, name);
      router.push('/(tabs)/matches'); // push: Back from Matches returns to this review
    } finally {
      submitting.current = false;
    }
  };

  // Demo: skip the questions and match a sample person straight away.
  const runDemo = async (key: DemoKey) => {
    if (submitting.current || loading) return;
    const p = DEMO_PROFILES[key];
    if (!p) return;
    submitting.current = true;
    try {
      await analyze(p, p.name);
      router.push('/(tabs)/matches');
    } finally {
      submitting.current = false;
    }
  };

  const bottom = insets.bottom;
  const showTopBack = step > 0 && !(current === 'interests' && !easy); // swipe deck has its own Back
  // Came from the review's Change on "What sounds fun": return without re-answering every card.
  const showBackToReview = editing && current === 'interests';
  const backToReview = () => {
    setEditing(false);
    setEnterFrom(null);
    setCursor(INTEREST_META.length);
    setStep(stepOf('review'));
  };
  // The engine skips walking routes for walker / wheelchair users; if walking is their only way, say so.
  const walkOnly =
    (mobility === 'walker' || mobility === 'wheelchair') && transport.length > 0 && transport.every((t) => t === 'walk');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[st.header, { paddingTop: insets.top + space.sm, paddingLeft: insets.left + 56 + space.md, paddingRight: insets.right + space.md }]}>
        {showTopBack || showBackToReview ? (
          <View style={st.headerRow}>
            {showTopBack ? (
              <PillButton variant="outline" icon="arrow-back" label="Back" onPress={back} disabled={loading} style={st.backBtn} />
            ) : null}
            {showBackToReview ? (
              <PillButton variant="outline" icon="checkmark" label="Back to review" onPress={backToReview} disabled={loading} style={st.backBtn} />
            ) : null}
          </View>
        ) : null}
        <Text style={[type.label, { color: colors.text }]}>
          {pos} of {total}
        </Text>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Step ${pos} of ${total}`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={pos}
          style={st.track}>
          <View style={[st.fill, { width: `${(pos / total) * 100}%` }]} />
        </View>
      </View>

      {current === 'name' && (
        <NameStep
          name={name}
          onName={setName}
          mode={mode}
          onMode={setMode}
          onStart={next}
          onDemo={runDemo}
          busy={loading}
          bottomInset={bottom}
        />
      )}

      {current === 'interests' &&
        (easy ? (
          <InterestGrid
            picked={new Set(INTEREST_META.filter((i) => liked[i.key]).map((i) => i.key))}
            onToggle={(k) => setLiked((p) => ({ ...p, [k]: !p[k] }))}
            onClear={() => setLiked({})}
            onContinue={() => {
              setLiked((p) => Object.fromEntries(INTEREST_META.map((i) => [i.key, !!p[i.key]])));
              setCursor(INTEREST_META.length);
              next();
            }}
            bottomInset={bottom}
          />
        ) : handsFree ? (
          <View style={{ flex: 1, minHeight: 0, paddingBottom: bottom + space.sm }}>
            <HandsFreeDeck cursor={Math.min(cursor, LAST)} enterFrom={enterFrom} onAnswer={answerCard} onBack={back} />
          </View>
        ) : (
          <View style={{ flex: 1, minHeight: 0, paddingBottom: bottom + space.sm }}>
            <SwipeDeck
              cursor={Math.min(cursor, LAST)}
              enterFrom={enterFrom}
              canBack
              onAnswer={answerCard}
              onBack={back}
            />
          </View>
        ))}

      {current === 'times' && (
        <ChoiceStep
          title="When are you usually free?"
          multi
          options={TIME_OPTIONS.map((o) => ({ id: o.key, label: o.label, emoji: o.emoji }))}
          selected={times}
          onToggle={(id) =>
            setTimes((p) => (p.includes(id as TimeSlot) ? p.filter((k) => k !== id) : [...p, id as TimeSlot]))
          }
          onContinue={next}
          onSkip={() => {
            setTimes([]);
            next();
          }}
          bottomInset={bottom}
        />
      )}

      {current === 'travel' && (
        <ChoiceStep
          title="How far is too far?"
          subtitle="Pick what feels right."
          options={TRAVEL_BUCKETS.map((b) => ({ id: String(b.min), label: b.label, detail: b.detail }))}
          selected={travel === null ? [] : [String(travel)]}
          onToggle={(id) => setTravel(Number(id))}
          onContinue={next}
          bottomInset={bottom}
        />
      )}

      {current === 'mobility' && (
        <ChoiceStep
          title="Do you use anything to help you walk?"
          options={MOBILITY_OPTIONS.map((o) => ({ id: o.key, label: o.label }))}
          selected={mobility ? [mobility] : []}
          onToggle={(id) => setMobility(id as MobilityKey)}
          onContinue={next}
          bottomInset={bottom}
        />
      )}

      {current === 'transport' && (
        <ChoiceStep
          title="How do you usually get places?"
          subtitle="We'll only plan trips you can actually make."
          multi
          options={TRANSPORT_OPTIONS.map((o) => ({ id: o.key, label: o.label, emoji: o.emoji }))}
          selected={transport}
          onToggle={(id) =>
            setTransport((p) =>
              p.includes(id as TransportKey) ? p.filter((k) => k !== id) : [...p, id as TransportKey],
            )
          }
          onContinue={next}
          bottomInset={bottom}
        />
      )}

      {current === 'comfort' && (
        <ChoiceStep
          title="Anything else that helps?"
          multi
          helper="Pick any that apply."
          options={COMFORT_OPTIONS.map((o) => ({ id: o.key, label: o.label }))}
          selected={comfort}
          onToggle={(id) => setComfort((p) => toggleComfort(p, id as ComfortKey))}
          onContinue={next}
          bottomInset={bottom}
        />
      )}

      {current === 'budget' && (
        <ChoiceStep
          title="What's a comfortable weekly budget?"
          subtitle="Many of the best activities are free."
          options={BUDGET_OPTIONS.map((b) => ({ id: String(b.amount), label: b.label, detail: b.detail }))}
          selected={budget === null ? [] : [String(budget)]}
          onToggle={(id) => setBudget(Number(id))}
          onContinue={next}
          bottomInset={bottom}
        />
      )}

      {current === 'review' && (
        <ReviewStep
          name={name}
          onChangeName={() => {
            setEditing(true);
            setStep(stepOf('name'));
          }}
          rows={reviewRows(answers())}
          onChange={change}
          onConfirm={finish}
          note={
            walkOnly
              ? { text: 'Walking routes are skipped for walker/wheelchair users — add another way to get places', onChange: () => change('transport') }
              : undefined
          }
          busy={loading}
          bottomInset={bottom}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  header: { flexShrink: 0, gap: space.sm, paddingBottom: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: tap.min },
  backBtn: { minHeight: tap.min, paddingHorizontal: space.md },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: colors.tile, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },
});
