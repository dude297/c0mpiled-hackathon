// Native onboarding. Same questions, order and mapping as web CardDeck:
// name → 10 interests → times → travel → stairs → budget → answersToProfile → analyze → Matches.
// Interests: swipe deck (default) or the Easier view grid. Switching modes keeps every answer.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChoiceStep } from '@/components/onboarding/ChoiceStep';
import { InterestGrid } from '@/components/onboarding/InterestGrid';
import { NameStep } from '@/components/onboarding/NameStep';
import { SwipeDeck } from '@/components/onboarding/SwipeDeck';
import { PillButton, s as ui } from '@/components/onboarding/ui';
import {
  answersToProfile,
  BUDGET_OPTIONS,
  INTEREST_META,
  STAIR_OPTIONS,
  TIME_OPTIONS,
  TRAVEL_BUCKETS,
  type Answer,
} from '@/lib/onboarding';
import { useApp } from '@/lib/store';
import { colors, radius, space, tap, type } from '@/lib/theme';

type Key = (typeof INTEREST_META)[number]['key'];
type TimeSlot = (typeof TIME_OPTIONS)[number]['key'];
type StairKey = (typeof STAIR_OPTIONS)[number]['key'];

const STEPS = ['name', 'interests', 'times', 'travel', 'mobility', 'budget'] as const;
const LAST = INTEREST_META.length - 1;

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { analyze, loading } = useApp();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [easy, setEasy] = useState(false);
  const [liked, setLiked] = useState<Partial<Record<Key, boolean>>>({});
  const [cursor, setCursor] = useState(0); // swipe deck position
  const [enterFrom, setEnterFrom] = useState<1 | -1 | null>(null);
  const [times, setTimes] = useState<TimeSlot[]>([]);
  const [travel, setTravel] = useState<number | null>(null);
  const [mobility, setMobility] = useState<StairKey | null>(null);
  const [budget, setBudget] = useState<number | null>(null);

  const current = STEPS[step];
  const next = () => setStep((i) => Math.min(i + 1, STEPS.length - 1));

  // "3 of 15" in swipe mode (name + 10 cards + 4 questions); "3 of 6" in easier view.
  const interestSpan = easy ? 1 : INTEREST_META.length;
  const total = 1 + interestSpan + 4;
  const pos = current === 'name' ? 1 : current === 'interests' ? 2 + (easy ? 0 : cursor) : interestSpan + step;

  const undoCard = (to: number) => {
    const key = INTEREST_META[to].key;
    setEnterFrom(liked[key] === false ? -1 : 1);
    setLiked(({ [key]: _, ...rest }) => rest);
    setCursor(to);
  };

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
    setEnterFrom(null);
    if (!v && cursor > LAST) setCursor(LAST); // back to cards: show the last one, answers kept
  };

  const finish = async () => {
    const answers: Answer[] = [
      ...INTEREST_META.filter((i) => liked[i.key] !== undefined).map(
        (i): Answer => ({ kind: 'interest', key: i.key, liked: !!liked[i.key] }),
      ),
      ...(times.length ? [{ kind: 'times', keys: times } as const] : []),
      ...(travel !== null ? [{ kind: 'travel', min: travel } as const] : []),
      ...(mobility ? [{ kind: 'mobility', key: mobility } as const] : []),
      ...(budget !== null ? [{ kind: 'budget', amount: budget } as const] : []),
    ];
    await analyze(answersToProfile(answers, name));
    router.replace('/(tabs)/matches');
  };

  const bottom = insets.bottom;
  const showTopBack = step > 0 && !(current === 'interests' && !easy); // swipe deck has its own Back

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[st.header, { paddingTop: insets.top + space.sm }]}>
        {(showTopBack || current === 'interests') && (
        <View style={st.headerRow}>
          {showTopBack ? (
            <PillButton variant="outline" icon="arrow-back" label="Back" onPress={back} disabled={loading} style={st.backBtn} />
          ) : null}
          <View style={{ flex: 1 }} />
          {current === 'interests' ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Easier view"
              accessibilityHint="Shows every idea at once as tap tiles instead of swipe cards"
              aria-checked={easy}
              onPress={() => toggleEasy(!easy)}
              style={({ pressed }) => [st.toggle, easy && st.toggleOn, pressed && ui.pressed]}>
              <Ionicons name={easy ? 'grid' : 'grid-outline'} size={22} color={easy ? colors.onTileSelected : colors.text} />
              <Text style={[type.label, { color: easy ? colors.onTileSelected : colors.text }]}>
                Easier view: {easy ? 'On' : 'Off'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        )}
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
          title="What about stairs?"
          subtitle="So we can match you with places that are easy to get into."
          options={STAIR_OPTIONS.map((o) => ({ id: o.key, label: o.label, detail: o.detail }))}
          selected={mobility ? [mobility] : []}
          onToggle={(id) => setMobility(id as StairKey)}
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
          onContinue={finish}
          continueLabel="See my matches"
          busy={loading}
          bottomInset={bottom}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  header: { paddingHorizontal: space.md, gap: space.sm, paddingBottom: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: tap.min },
  backBtn: { minHeight: tap.min, paddingHorizontal: space.md },
  toggle: {
    minHeight: tap.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: colors.tile,
  },
  toggleOn: { backgroundColor: colors.tileSelected, borderColor: colors.tileSelected },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: colors.tile, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },
});
