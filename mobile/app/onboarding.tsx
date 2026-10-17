// Native onboarding. Order:
// name → 10 interests → times → travel → walking aid → how you get places → budget → review
// ("Here's what we heard", each answer with Change) → answersToProfile → analyze → Matches.
// Walking aid and transport are always asked, never inferred; analyze can't run until both are answered.
// Interests: swipe deck (default), the Easier view grid, or Hands-free (look / head tilt answers the
// same swipe cards). Switching modes keeps every answer.
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChoiceStep } from '@/components/onboarding/ChoiceStep';
import { HandsFreeDeck } from '@/components/onboarding/HandsFree';
import { InterestGrid } from '@/components/onboarding/InterestGrid';
import { NameStep } from '@/components/onboarding/NameStep';
import { ReviewStep } from '@/components/onboarding/ReviewStep';
import { SwipeDeck } from '@/components/onboarding/SwipeDeck';
import { PillButton, s as ui } from '@/components/onboarding/ui';
import {
  answersToProfile,
  BUDGET_OPTIONS,
  INTEREST_META,
  MOBILITY_OPTIONS,
  reviewRows,
  TIME_OPTIONS,
  TRANSPORT_OPTIONS,
  TRAVEL_BUCKETS,
  type Answer,
  type ReviewField,
} from '@/lib/onboarding';
import { useApp } from '@/lib/store';
import { colors, radius, space, tap, type } from '@/lib/theme';

type Key = (typeof INTEREST_META)[number]['key'];
type TimeSlot = (typeof TIME_OPTIONS)[number]['key'];
type MobilityKey = (typeof MOBILITY_OPTIONS)[number]['key'];
type TransportKey = (typeof TRANSPORT_OPTIONS)[number]['key'];

const STEPS = ['name', 'interests', 'times', 'travel', 'mobility', 'transport', 'budget', 'review'] as const;
const stepOf = (f: (typeof STEPS)[number]) => STEPS.indexOf(f);
const VIEWS = [
  { key: 'swipe', label: 'Swipe', hint: 'One card at a time. Swipe or use the No and Yes buttons.' },
  { key: 'easy', label: 'Easier view', hint: 'Shows every idea at once as tap tiles instead of swipe cards' },
  { key: 'hands', label: 'Hands-free', hint: 'Answer each card by looking or tilting your head toward No or Yes' },
] as const;
const LAST = INTEREST_META.length - 1;

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { analyze, loading } = useApp();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [easy, setEasy] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [liked, setLiked] = useState<Partial<Record<Key, boolean>>>({});
  const [cursor, setCursor] = useState(0); // swipe deck position
  const [enterFrom, setEnterFrom] = useState<1 | -1 | null>(null);
  const [times, setTimes] = useState<TimeSlot[]>([]);
  const [travel, setTravel] = useState<number | null>(null);
  const [mobility, setMobility] = useState<MobilityKey | null>(null);
  const [transport, setTransport] = useState<TransportKey[]>([]);
  const [budget, setBudget] = useState<number | null>(null);
  const [editing, setEditing] = useState(false); // came from the review's Change: Continue returns there
  const submitting = useRef(false); // double-tap lockout for See my matches

  const current = STEPS[step];
  const next = () => {
    if (editing) {
      setEditing(false);
      return setStep(stepOf('review'));
    }
    setStep((i) => Math.min(i + 1, STEPS.length - 1));
  };

  // "3 of 17" in swipe mode (name + 10 cards + 5 questions + review); "3 of 8" in easier view.
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

  const answers = (): Answer[] => [
    ...INTEREST_META.filter((i) => liked[i.key] !== undefined).map(
      (i): Answer => ({ kind: 'interest', key: i.key, liked: !!liked[i.key] }),
    ),
    ...(times.length ? [{ kind: 'times', keys: times } as const] : []),
    ...(travel !== null ? [{ kind: 'travel', min: travel } as const] : []),
    ...(mobility ? [{ kind: 'mobility', key: mobility } as const] : []),
    ...(transport.length ? [{ kind: 'transport', keys: transport } as const] : []),
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
      // Never guess walking aid or transport: go ask the first missing one.
      setEditing(true);
      return setStep(stepOf(result.missing[0]));
    }
    submitting.current = true;
    try {
      await analyze(result.profile);
      router.replace('/(tabs)/matches');
    } finally {
      submitting.current = false;
    }
  };

  const bottom = insets.bottom;
  const showTopBack = step > 0 && !(current === 'interests' && !easy); // swipe deck has its own Back

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[st.header, { paddingTop: insets.top + space.sm }]}>
        {showTopBack ? (
          <View style={st.headerRow}>
            <PillButton variant="outline" icon="arrow-back" label="Back" onPress={back} disabled={loading} style={st.backBtn} />
          </View>
        ) : null}
        {current === 'interests' ? (
          <View style={st.views} accessibilityRole="radiogroup" accessibilityLabel="How to answer">
            {VIEWS.map((v) => {
              const on = v.key === (easy ? 'easy' : handsFree ? 'hands' : 'swipe');
              return (
                <Pressable
                  key={v.key}
                  accessibilityRole="radio"
                  accessibilityLabel={v.label}
                  accessibilityHint={v.hint}
                  aria-checked={on}
                  onPress={() => {
                    toggleEasy(v.key === 'easy');
                    setHandsFree(v.key === 'hands');
                  }}
                  style={({ pressed }) => [st.toggle, on && st.toggleOn, pressed && ui.pressed]}>
                  <Text style={[st.viewText, { color: on ? colors.onTileSelected : colors.text }]}>{v.label}</Text>
                </Pressable>
              );
            })}
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
        <NameStep name={name} onName={setName} easy={easy} onEasy={toggleEasy} onStart={next} bottomInset={bottom} />
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
          <View style={{ flex: 1, paddingBottom: bottom + space.md }}>
            <HandsFreeDeck cursor={Math.min(cursor, LAST)} enterFrom={enterFrom} onAnswer={answerCard} onBack={back} />
          </View>
        ) : (
          <View style={{ flex: 1, paddingBottom: bottom + space.md }}>
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
        <ReviewStep rows={reviewRows(answers())} onChange={change} onConfirm={finish} busy={loading} bottomInset={bottom} />
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  header: { paddingHorizontal: space.md, gap: space.sm, paddingBottom: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: tap.min },
  backBtn: { minHeight: tap.min, paddingHorizontal: space.md },
  views: { flexDirection: 'row', gap: space.xs },
  viewText: { fontSize: 17, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  toggle: {
    flex: 1,
    minHeight: tap.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: colors.tile,
  },
  toggleOn: { backgroundColor: colors.tileSelected, borderColor: colors.tileSelected },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: colors.tile, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },
});
