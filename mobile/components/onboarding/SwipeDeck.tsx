// Tinder-style interest deck: the top card follows the finger, tilts, shows LIKE / NOPE stamps,
// and flings off past 30% of the screen width or a fast flick. Every gesture has a button twin.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { INTEREST_META } from '@/lib/onboarding';
import { colors, radius, shadow, space, type } from '@/lib/theme';

import { CircleButton, haptic } from './ui';

type Interest = (typeof INTEREST_META)[number];
type Dir = 1 | -1;
type CardHandle = { swipe: (dir: Dir) => void };
export type SwipeDeckHandle = CardHandle; // answer the top card exactly like the No / Yes buttons

const FLICK_VELOCITY = 800;
const tick = haptic.tick; // plain function so the gesture worklet can schedule it on the JS thread
const MAX_ROTATE = 12;

function CardFace({ interest, compact = false }: { interest: Interest; compact?: boolean }) {
  return (
    <ScrollView
      style={st.cardFrame}
      contentContainerStyle={[st.card, compact && st.compactCard]}
      accessible={false}>
      <Text style={[type.heading, { color: colors.textMuted }, compact && st.compactPrompt]}>Would you enjoy this?</Text>
      <View style={[st.center, compact && st.compactCenter]}>
        <Text style={[st.emoji, compact && st.compactEmoji]} importantForAccessibility="no">{interest.emoji}</Text>
        <Text style={[type.display, { color: colors.text, textAlign: 'center' }, compact && st.compactTitle]}>{interest.label}</Text>
      </View>
      {!compact && <View style={st.hint} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Ionicons name="arrow-back" size={22} color={colors.textMuted} />
        <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>Swipe to answer</Text>
        <Ionicons name="arrow-forward" size={22} color={colors.textMuted} />
      </View>}
    </ScrollView>
  );
}

function Stamp({ like }: { like: boolean }) {
  const c = like ? colors.like : colors.hard;
  return (
    <View style={[st.stamp, { borderColor: c, transform: [{ rotate: like ? '-12deg' : '12deg' }] }]}>
      <Ionicons name={like ? 'heart' : 'close'} size={28} color={c} />
      <Text style={[st.stampText, { color: c }]}>{like ? 'LIKE' : 'NOPE'}</Text>
    </View>
  );
}

function SwipeCard({
  interest,
  compact,
  drag,
  enterFrom,
  reduceMotion,
  onCommit,
  ref,
}: {
  interest: Interest;
  compact: boolean;
  drag: SharedValue<number>; // 0..1, how far the top card is toward a commit — drives the card behind
  enterFrom: Dir | null; // after Undo, slide back in from the side it left
  reduceMotion: boolean;
  onCommit: (dir: Dir) => void;
  ref: Ref<CardHandle>;
}) {
  const { width } = useWindowDimensions();
  const threshold = width * 0.3;
  const offscreen = width * 1.4;
  const x = useSharedValue(enterFrom && !reduceMotion ? enterFrom * offscreen : 0);
  const y = useSharedValue(0);
  const armed = useSharedValue(false);
  const done = useSharedValue(false);

  useEffect(() => {
    drag.set(0);
    if (x.get() !== 0) x.set(withSpring(0, { damping: 18, stiffness: 160 }));
  }, [drag, x]);

  // Fling the card away, then report the answer. Runs on the UI thread (gesture) or JS (buttons).
  const fling = (dir: Dir, velocity: number) => {
    'worklet';
    if (done.get()) return;
    done.set(true);
    if (reduceMotion) {
      scheduleOnRN(onCommit, dir);
      return;
    }
    const remaining = Math.max(offscreen - Math.abs(x.get()), 0);
    const speed = Math.max(Math.abs(velocity), 1600);
    const duration = Math.min(Math.max((remaining / speed) * 1000, 140), 280);
    drag.set(withTiming(1, { duration }));
    y.set(withTiming(y.get() + 40, { duration }));
    x.set(
      withTiming(dir * offscreen, { duration }, (finished) => {
        if (finished) scheduleOnRN(onCommit, dir);
      }),
    );
  };

  // Button / screen-reader path (JS thread).
  const swipe = (dir: Dir) => {
    if (done.get()) return;
    if (reduceMotion) {
      done.set(true);
      onCommit(dir);
      return;
    }
    fling(dir, 0);
  };
  useImperativeHandle(ref, () => ({ swipe }));

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-16, 16]) // Long or enlarged card text remains vertically scrollable.
    .onUpdate((e) => {
      if (done.get()) return;
      x.set(e.translationX);
      y.set(e.translationY * 0.25);
      drag.set(Math.min(Math.abs(e.translationX) / threshold, 1));
      const over = Math.abs(e.translationX) > threshold;
      if (over !== armed.get()) {
        armed.set(over);
        scheduleOnRN(tick);
      }
    })
    .onEnd((e) => {
      if (done.get()) return;
      const flick = Math.abs(e.velocityX) > FLICK_VELOCITY;
      if (flick || Math.abs(e.translationX) > threshold) {
        fling((flick ? e.velocityX : e.translationX) > 0 ? 1 : -1, e.velocityX);
        return;
      }
      armed.set(false);
      if (reduceMotion) {
        x.set(0);
        y.set(0);
        drag.set(0);
      } else {
        const spring = { damping: 16, stiffness: 180, velocity: e.velocityX };
        x.set(withSpring(0, spring));
        y.set(withSpring(0, { damping: 16, stiffness: 180 }));
        drag.set(withSpring(0, { damping: 16, stiffness: 180 }));
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      { rotate: `${reduceMotion ? 0 : interpolate(x.get(), [-width, 0, width], [-MAX_ROTATE, 0, MAX_ROTATE], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const likeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [0, threshold], [0, 1], Extrapolation.CLAMP),
  }));
  const nopeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [-threshold, 0], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[{ flex: 1, minHeight: 0 }, cardStyle]}
        accessible
        accessibilityLabel={`${interest.label}. Would you enjoy this?`}
        accessibilityHint="Use the Yes or No actions, or the Yes and No buttons below."
        accessibilityActions={[
          { name: 'like', label: `Yes, I would enjoy ${interest.label}` },
          { name: 'nope', label: `No, not ${interest.label}` },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'like') swipe(1);
          else if (e.nativeEvent.actionName === 'nope') swipe(-1);
        }}>
        <CardFace interest={interest} compact={compact} />
        <Animated.View style={[st.stampSpot, { left: space.lg }, likeStyle]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Stamp like />
        </Animated.View>
        <Animated.View style={[st.stampSpot, { right: space.lg }, nopeStyle]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Stamp like={false} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

export function SwipeDeck({
  cursor,
  enterFrom,
  canBack,
  compact = false,
  onAnswer,
  onBack,
  left,
  right,
  ref,
}: {
  cursor: number; // index into INTEREST_META of the top card
  enterFrom: Dir | null;
  canBack: boolean;
  compact?: boolean; // hands-free presentation; gestures and answers stay the same
  onAnswer: (key: Interest['key'], liked: boolean) => void;
  onBack: () => void;
  left?: ReactNode; // hands-free No / Yes targets replace the action buttons in the bottom row
  right?: ReactNode;
  ref?: Ref<SwipeDeckHandle>;
}) {
  const reduceMotion = useReducedMotion();
  const drag = useSharedValue(0);
  const cardRef = useRef<CardHandle>(null);
  const top = INTEREST_META[cursor];
  const next = INTEREST_META[cursor + 1];
  useImperativeHandle(ref, () => ({ swipe: (dir: Dir) => cardRef.current?.swipe(dir) }));

  const commit = (dir: Dir) => {
    haptic.impact();
    if (top) onAnswer(top.key, dir > 0);
  };

  const behindStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(drag.get(), [0, 1], [18, 0], Extrapolation.CLAMP) },
      { scale: interpolate(drag.get(), [0, 1], [0.93, 1], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={st.cardArea}>
        <View style={[st.stack, compact && st.compactStack]}>
          {next && !compact && (
            <Animated.View
              style={[StyleSheet.absoluteFill, behindStyle]}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden>
              <CardFace interest={next} />
            </Animated.View>
          )}
          {top && (
            <SwipeCard
              key={top.key}
              ref={cardRef}
              interest={top}
              compact={compact}
              drag={drag}
              enterFrom={enterFrom}
              reduceMotion={reduceMotion}
              onCommit={commit}
            />
          )}
        </View>
      </View>
      <View style={[st.bar, compact && st.compactBar]}>
        <CircleButton icon="arrow-undo" label="Back" a11yLabel="Back: undo last answer" color={colors.text} size={60} disabled={!canBack} onPress={onBack} />
        {left ?? <CircleButton icon="close" label="No" a11yLabel={top ? `No, not ${top.label}` : 'No'} color={colors.hard} size={84} onPress={() => cardRef.current?.swipe(-1)} />}
        {right ?? <CircleButton icon="heart" label="Yes" a11yLabel={top ? `Yes, I'd enjoy ${top.label}` : 'Yes'} color={colors.like} size={84} onPress={() => cardRef.current?.swipe(1)} />}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  cardArea: { flex: 1, minHeight: 0, overflow: 'hidden' },
  compactStack: { marginTop: space.sm, marginBottom: space.sm },
  compactCard: { padding: space.sm, justifyContent: 'center', gap: space.xs },
  compactPrompt: { fontSize: 18, lineHeight: 24 },
  compactCenter: { gap: 0, justifyContent: 'center' },
  compactEmoji: { fontSize: 64, lineHeight: 76 },
  compactTitle: { fontSize: 24, lineHeight: 28 },
  compactBar: { flexShrink: 0, paddingTop: space.xs },
  stack: { flex: 1, marginHorizontal: space.md, marginTop: space.sm, marginBottom: space.md },
  cardFrame: { flex: 1, borderRadius: radius.lg, backgroundColor: colors.surface },
  card: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    justifyContent: 'space-between',
    alignItems: 'center',
    ...shadow.card,
  },
  center: { alignSelf: 'stretch', alignItems: 'center', gap: space.md },
  emoji: { fontSize: 104, lineHeight: 124 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stampSpot: { position: 'absolute', top: space.xl },
  stamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 4,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colors.surface,
  },
  stampText: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: 2 },
  bar: {
    flexShrink: 0,
    paddingTop: space.sm,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-end',
    paddingHorizontal: space.md,
  },
});
