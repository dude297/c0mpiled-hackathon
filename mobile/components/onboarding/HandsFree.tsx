// Hands-free interest cards: look toward ✕ / ❤️ (hold 1.5 s) or tilt your head toward it (0.8 s).
// Runs in Expo Go: the camera + MediaPipe Face Landmarker live in a small WebView tile
// (lib/handsfreePage.ts) that posts progress / answer messages; everything you see here is native.
// Answers go through SwipeDeck's own swipe(), the same path as the No / Yes buttons, which keep working.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import type { Mode } from '@/lib/handsfree';
import { buildHandsFreeHtml, HANDSFREE_BASE_URL, parsePageMessage, type PageError } from '@/lib/handsfreePage';
import { INTEREST_META } from '@/lib/onboarding';
import { colors, radius, space, tap, type } from '@/lib/theme';

import { SwipeDeck, type SwipeDeckHandle } from './SwipeDeck';
import { PillButton, s as ui } from './ui';

type Interest = (typeof INTEREST_META)[number];
// The package types WebView as Component<WebViewProps & undefined> (= never props) under React 19 types.
type WebViewHandle = { injectJavaScript: (script: string) => void };
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;
type Phase = 'idle' | 'starting' | 'loading' | 'calibrating' | 'tracking' | 'error';
type Side = 'left' | 'right';

const PRIVACY = 'Your camera stays on this device — nothing is recorded or sent.';
const ERRORS: Record<PageError | 'timeout', string> = {
  denied: "The camera is turned off for this app. To use hands-free, allow the camera in your phone's Settings. The No and Yes buttons still work.",
  nocamera: "We couldn't find a front camera on this phone. The No and Yes buttons still work.",
  load: "Hands-free couldn't start. It needs the internet the first time. Check your connection and try again — the No and Yes buttons still work.",
  timeout: "Hands-free is taking too long to start. Try again — the No and Yes buttons still work.",
};

// Progress ring from plain Views (no SVG dependency): two clipped half-rings rotated into view.
function Ring({ size, width, progress, color, track }: { size: number; width: number; progress: number; color: string; track: string }) {
  const deg = Math.max(0, Math.min(1, progress)) * 360;
  const half = size / 2;
  const ring = { position: 'absolute' as const, width: size, height: size, borderRadius: half, borderWidth: width, borderColor: color };
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={[ring, { borderColor: track }]} />
      {/* 0–180°: a left half-ring, clipped to the right half, rotated clockwise into view */}
      <View style={{ position: 'absolute', left: half, width: half, height: size, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: -half, width: size, height: size, transform: [{ rotate: `${Math.min(deg, 180)}deg` }] }}>
          <View style={{ position: 'absolute', left: 0, width: half, height: size, overflow: 'hidden' }}>
            <View style={ring} />
          </View>
        </View>
      </View>
      {/* 180–360°: a right half-ring, clipped to the left half */}
      <View style={{ position: 'absolute', left: 0, width: half, height: size, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, width: size, height: size, transform: [{ rotate: `${Math.max(deg - 180, 0)}deg` }] }}>
          <View style={{ position: 'absolute', left: half, width: half, height: size, overflow: 'hidden' }}>
            <View style={[ring, { left: -half }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const TARGET = 68;

function Target({ side, progress, active, label, onPress }: { side: Side; progress: number; active: boolean; label?: string; onPress: () => void }) {
  const yes = side === 'right';
  const color = yes ? colors.like : colors.hard;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={yes ? `Yes, I'd enjoy ${label ?? 'this'}` : `No, not ${label ?? 'this'}`}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [st.target, pressed && ui.pressed]}>
      <View style={{ width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' }}>
        <View style={StyleSheet.absoluteFill}>
          <Ring size={TARGET} width={7} progress={active ? progress : 0} color={color} track={colors.border} />
        </View>
        <View style={[st.targetFace, active && progress > 0 && { backgroundColor: yes ? '#e3f1e8' : colors.hardBg }]}>
          <Ionicons name={yes ? 'heart' : 'close'} size={34} color={color} />
        </View>
      </View>
      <Text style={[type.label, st.targetLabel]}>{yes ? 'Yes' : 'No'}</Text>
    </Pressable>
  );
}

function ModeSwitch({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  return (
    <View style={st.seg} accessibilityRole="radiogroup" accessibilityLabel="Hands-free style">
      {(
        [
          ['look', 'Look', 'eye-outline'],
          ['tilt', 'Tilt', 'swap-horizontal'],
        ] as const
      ).map(([m, label, icon]) => {
        const on = mode === m;
        return (
          <Pressable
            key={m}
            accessibilityRole="radio"
            aria-checked={on}
            accessibilityLabel={m === 'look' ? 'Look to answer' : 'Tilt your head to answer'}
            onPress={() => onMode(m)}
            style={({ pressed }) => [st.segBtn, on && st.segOn, pressed && ui.pressed]}>
            <Ionicons name={icon} size={22} color={on ? colors.onTileSelected : colors.text} />
            <Text style={[type.label, { color: on ? colors.onTileSelected : colors.text }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function HandsFreeDeck({
  cursor,
  enterFrom,
  onAnswer,
  onBack,
}: {
  cursor: number;
  enterFrom: 1 | -1 | null;
  onAnswer: (key: Interest['key'], liked: boolean) => void;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const deckRef = useRef<SwipeDeckHandle>(null);
  const webRef = useRef<WebViewHandle>(null);
  const [mode, setMode] = useState<Mode>('look');
  const [phase, setPhase] = useState<Phase>('idle');
  const [attempt, setAttempt] = useState(0); // bump to (re)mount the camera page
  const [html, setHtml] = useState(''); // built per start; later mode changes are sent to the running page
  const [face, setFace] = useState<boolean | null>(null);
  const [calib, setCalib] = useState(0);
  const [error, setError] = useState<PageError | 'timeout' | null>(null);
  const [progress, setProgress] = useState<{ side: Side | null; value: number }>({ side: null, value: 0 });
  const [said, setSaid] = useState('');
  const top = INTEREST_META[cursor];

  const web = Platform.OS === 'web';
  const live = phase !== 'idle' && phase !== 'error';

  // Never a stuck screen: if the page goes quiet while starting / loading, show an error.
  const lastMsg = useRef(0);
  useEffect(() => {
    if (phase !== 'starting' && phase !== 'loading') return;
    const id = setInterval(() => {
      const quiet = Date.now() - lastMsg.current;
      if (quiet > (phase === 'loading' ? 100_000 : 60_000)) {
        setError('timeout');
        setPhase('error');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const start = () => {
    lastMsg.current = Date.now();
    setError(null);
    setFace(null);
    setCalib(0);
    setProgress({ side: null, value: 0 });
    setHtml(buildHandsFreeHtml(mode));
    setAttempt((a) => a + 1);
    setPhase('starting');
  };
  const stop = () => {
    webRef.current?.injectJavaScript('window.__hf && window.__hf.stop(); true;');
    setPhase('idle');
    setProgress({ side: null, value: 0 });
  };
  const pickMode = (m: Mode) => {
    setMode(m);
    setProgress({ side: null, value: 0 });
    webRef.current?.injectJavaScript(`window.__hf && window.__hf.setMode(${JSON.stringify(m)}); true;`);
  };

  // Every answer lands here — gaze/tilt, the ✕/❤️ targets, the No/Yes bar and a finger swipe —
  // so each one is announced ("Liked Gardening") before it's recorded.
  const recordAnswer = (key: Interest['key'], liked: boolean) => {
    const label = INTEREST_META.find((i) => i.key === key)?.label;
    if (label) {
      const msg = `${liked ? 'Liked' : 'Passed on'} ${label}`;
      setSaid(msg);
      AccessibilityInfo.announceForAccessibility(msg);
    }
    onAnswer(key, liked);
  };
  // Same path as the No / Yes buttons (fling + haptic + recordAnswer).
  const answer = (liked: boolean) => deckRef.current?.swipe(liked ? 1 : -1);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = parsePageMessage(e.nativeEvent.data);
    if (!m) return;
    lastMsg.current = Date.now();
    if (m.type === 'progress') setProgress({ side: m.side, value: m.value });
    else if (m.type === 'answer') answer(m.liked);
    else if (m.state === 'error') {
      setError(m.error);
      setPhase('error');
    } else if (m.state === 'stopped') setPhase('idle');
    else {
      setPhase(m.state);
      if (m.face !== undefined) setFace(m.face);
      if (m.progress !== undefined) setCalib(m.progress);
    }
  };
  const pageFailed = () => {
    setError('load');
    setPhase('error');
  };

  // Reduced motion: the ring steps in quarters instead of sweeping smoothly.
  const shown = reduceMotion ? Math.floor(progress.value * 4) / 4 : progress.value;
  const tracking = phase === 'tracking';
  const target = (side: Side) => (
    <Target
      side={side}
      label={top?.label}
      active={tracking && progress.side === side}
      progress={shown}
      onPress={() => answer(side === 'right')}
    />
  );

  // statusText is a live region, so it only changes when the step changes; the calibration
  // percent (updates ~5×/s) sits in a separate, non-live Text so TalkBack doesn't repeat it.
  let statusText = '';
  let percent = '';
  if (phase === 'starting') statusText = 'Starting the camera…';
  else if (phase === 'loading') statusText = 'Getting ready… (a few seconds)';
  else if (face === false) statusText = "Can't see your face. Hold the phone in front of you, in good light.";
  else if (phase === 'calibrating') {
    statusText = 'Look at the middle of the screen…';
    percent = `${Math.round(calib * 100)}%`;
  } else if (tracking)
    statusText = mode === 'look' ? 'Look toward No or Yes and hold.' : 'Tilt your head toward No or Yes and hold.';

  return (
    <View style={{ flex: 1 }}>
      <View style={st.panel}>
        {web ? (
          <Text style={[type.body, { color: colors.text }]}>
            Hands-free needs the phone app. Here, use the No and Yes buttons, or Swipe / Easier view.
          </Text>
        ) : live ? (
          <>
            <View style={st.liveRow}>
              <View style={st.preview} accessible accessibilityLabel={face ? 'Camera preview. Face found.' : 'Camera preview. Looking for your face.'}>
                <WebView
                  key={attempt}
                  ref={webRef}
                  source={{ html, baseUrl: HANDSFREE_BASE_URL }}
                  originWhitelist={['*']}
                  javaScriptEnabled
                  mediaCapturePermissionGrantType="grant"
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  scrollEnabled={false}
                  bounces={false}
                  webviewDebuggingEnabled={__DEV__}
                  onMessage={onMessage}
                  onError={pageFailed}
                  onHttpError={pageFailed}
                  onContentProcessDidTerminate={pageFailed}
                  onRenderProcessGone={pageFailed}
                  style={st.web}
                  importantForAccessibility="no-hide-descendants"
                />
                <View style={[st.faceDot, { backgroundColor: face ? colors.like : colors.soft }]} />
              </View>
              <View style={{ flex: 1, gap: space.xs }}>
                <View style={st.faceRow}>
                  <Ionicons name={face ? 'checkmark-circle' : 'scan-outline'} size={22} color={face ? colors.like : colors.soft} />
                  <Text style={[type.label, { color: colors.text, flexShrink: 1 }]}>{face ? 'Face found' : 'Looking for your face'}</Text>
                </View>
                <Text style={[type.bodyStrong, { color: colors.text }]} accessibilityLiveRegion="polite">
                  {statusText}
                </Text>
                {percent ? (
                  <Text style={[type.label, { color: colors.textMuted }]} importantForAccessibility="no" accessibilityElementsHidden>
                    {percent}
                  </Text>
                ) : null}
                {said ? (
                  // Not a live region: announceForAccessibility already speaks it (avoids a double read on TalkBack).
                  <Text style={[type.bodyStrong, { color: colors.like }]}>
                    {said}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={st.liveRow}>
              <View style={{ flex: 1 }}>
                <ModeSwitch mode={mode} onMode={pickMode} />
              </View>
              <PillButton variant="outline" icon="stop-circle-outline" label="Stop" onPress={stop} hint="Turns the camera off" style={st.stop} />
            </View>
          </>
        ) : (
          <>
            <Text style={[type.body, { color: colors.text }]}>
              Look toward No or Yes, or tilt your head toward it, and hold. Hands-free works on the interest cards.
            </Text>
            <ModeSwitch mode={mode} onMode={pickMode} />
            {error ? (
              <Text style={[type.bodyStrong, { color: colors.hard }]} accessibilityLiveRegion="assertive" accessibilityRole="alert">
                {ERRORS[error]}
              </Text>
            ) : null}
            <PillButton icon="camera-outline" label={error ? 'Try again' : 'Start hands-free'} onPress={start} hint="Turns on the front camera" />
          </>
        )}
        {!web ? <Text style={st.privacy}>{PRIVACY}</Text> : null}
      </View>

      <SwipeDeck
        ref={deckRef}
        cursor={cursor}
        enterFrom={enterFrom}
        canBack
        onAnswer={recordAnswer}
        onBack={onBack}
        left={live ? target('left') : null}
        right={live ? target('right') : null}
      />
    </View>
  );
}

const st = StyleSheet.create({
  panel: {
    marginHorizontal: space.md,
    marginTop: space.xs,
    padding: space.sm + 4,
    gap: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stop: { minHeight: tap.min, paddingHorizontal: space.md },
  privacy: { fontSize: 16, lineHeight: 22, color: colors.textMuted },
  preview: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.text },
  web: { flex: 1, backgroundColor: colors.text },
  faceDot: { position: 'absolute', top: 6, right: 6, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  faceRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  seg: { flexDirection: 'row', gap: space.sm },
  segBtn: {
    flex: 1,
    minHeight: tap.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: colors.tile,
  },
  segOn: { backgroundColor: colors.tileSelected, borderColor: colors.tileSelected },
  target: { alignItems: 'center', gap: 2, paddingHorizontal: 2 },
  targetLabel: { color: colors.text, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: space.sm, overflow: 'hidden' },
  targetFace: {
    width: TARGET - 16,
    height: TARGET - 16,
    borderRadius: (TARGET - 16) / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
