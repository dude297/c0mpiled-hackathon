// Hands-free interest cards: look or turn toward a screen half (1.2 s), or tilt (0.8 s).
// Runs in Expo Go: the camera + MediaPipe Face Landmarker live in a small WebView tile
// (lib/handsfreePage.ts) that posts progress / answer messages; everything you see here is native.
// Answers go through SwipeDeck's own swipe(), the same path as the No / Yes buttons, which keep working.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import type { Mode } from '@/lib/handsfree';
import { buildHandsFreeHtml, HANDSFREE_BASE_URL, parsePageMessage, type PageError } from '@/lib/handsfreePage';
import { INTEREST_META } from '@/lib/onboarding';
import { colors, radius, shadow, space, tap, type } from '@/lib/theme';

import { SwipeDeck, type SwipeDeckHandle } from './SwipeDeck';
import { PillButton, s as ui } from './ui';

type Interest = (typeof INTEREST_META)[number];
// The package types WebView as Component<WebViewProps & undefined> (= never props) under React 19 types.
type WebViewHandle = { injectJavaScript: (script: string) => void };
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;
type Phase = 'idle' | 'starting' | 'loading' | 'calibrating' | 'tracking' | 'error';
type Side = 'left' | 'right';

const PRIVACY = 'On-device camera · never recorded or sent.';
const ERRORS: Record<PageError | 'timeout', string> = {
  denied:
    Platform.OS === 'ios'
      ? 'The camera is blocked. To fix it: open the iPhone Settings app › Expo Go › turn on Camera, then come back and tap Try again. The ✕ / ❤️ buttons still work.'
      : "The camera is blocked. Allow the camera for this app in your phone's Settings, then tap Try again. The ✕ / ❤️ buttons still work.",
  nocamera: "We couldn't open the front camera. Tap Try again — the ✕ / ❤️ buttons still work.",
  load: "Hands-free couldn't load the face model. It needs the internet. Check your connection and tap Try again — the ✕ / ❤️ buttons still work.",
  timeout: "Hands-free couldn't start — use the ✕ / ❤️ buttons, or tap Try again.",
};
const START_TIMEOUT_MS = 15_000; // no word from the camera page for this long while starting → show the timeout

// Each entire screen-side half is an answer target. The fill rises from the bottom as the
// dwell progresses; the question sits above both halves and never intercepts their taps.
function SplitCard({ interest, mode, side, progress, onAnswer }: {
  interest: Interest;
  mode: Mode;
  side: Side | null;
  progress: number;
  onAnswer: (liked: boolean) => void;
}) {
  return (
    <View style={st.splitCard}>
      <View style={st.halves}>
        {(['left', 'right'] as const).map((half) => {
          const yes = half === 'right';
          const color = yes ? colors.like : colors.hard;
          const label = `${mode === 'look' ? 'Look or turn' : 'Tilt'} ${half} = ${yes ? 'Yes ❤️' : 'No ✕'}`;
          return (
            <Pressable
              key={half}
              accessibilityRole="button"
              accessibilityLabel={`${label}. ${interest.label}`}
              onPress={() => onAnswer(yes)}
              style={({ pressed }) => [st.half, yes && st.rightHalf, pressed && ui.pressed]}>
              <View
                pointerEvents="none"
                style={[st.halfFill, {
                  height: `${(side === half ? progress : 0) * 100}%`,
                  backgroundColor: yes ? '#b8e1c7' : '#f6bdb7',
                }]}
              />
              <Text style={[st.halfLabel, { color }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View pointerEvents="none" style={st.question}>
        <Text style={st.questionPrompt}>Would you enjoy this?</Text>
        <Text style={st.questionEmoji} importantForAccessibility="no">{interest.emoji}</Text>
        <Text style={st.questionTitle}>{interest.label}</Text>
      </View>
    </View>
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
  const [detail, setDetail] = useState(''); // latest step / technical reason from the page, shown as plain text
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
      if (quiet > START_TIMEOUT_MS) {
        webRef.current?.injectJavaScript('window.__hf && window.__hf.stop(); true;');
        setError('timeout');
        setPhase('error');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const start = () => {
    lastMsg.current = Date.now();
    setError(null);
    setDetail('Opening the camera page…');
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

  // Every answer lands here — gaze/yaw/tilt, the split halves, the No/Yes bar and a finger swipe —
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
      setDetail(m.detail ?? '');
      setPhase('error');
    } else if (m.state === 'stopped') setPhase('idle');
    else {
      setPhase(m.state);
      if (m.detail) setDetail(m.detail);
      if (m.face !== undefined) setFace(m.face);
      if (m.progress !== undefined) setCalib(m.progress);
    }
  };
  const pageFailed = (e?: { nativeEvent?: object }) => {
    const n = e?.nativeEvent as { description?: string; statusCode?: number } | undefined;
    setError('load');
    setDetail(n?.description ? `WebView: ${n.description}` : n?.statusCode ? `WebView HTTP ${n.statusCode}` : 'The camera page stopped.');
    setPhase('error');
  };

  // Reduced motion: the fill steps in quarters instead of rising smoothly.
  const shown = reduceMotion ? Math.floor(progress.value * 4) / 4 : progress.value;
  const tracking = phase === 'tracking';

  // statusText is a live region, so it only changes when the step changes; the calibration
  // percent (updates ~5×/s) sits in a separate, non-live Text so TalkBack doesn't repeat it.
  let statusText = '';
  let percent = '';
  if (phase === 'starting') statusText = detail || 'Starting the camera…';
  else if (phase === 'loading') statusText = detail || 'Getting ready… (a few seconds)';
  else if (face === false) statusText = "Can't see your face. Hold the phone in front of you, in good light.";
  else if (phase === 'calibrating') {
    statusText = 'Look at the middle of the screen…';
    percent = `${Math.round(calib * 100)}%`;
  } else if (tracking)
    statusText = mode === 'look' ? 'Hold a look or turn for 1.2s, then return to the middle.' : 'Tilt your head toward No or Yes and hold.';

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView style={st.panel} contentContainerStyle={st.panelContent}>
        {web ? (
          <Text style={[type.body, { color: colors.text }]}>
            Hands-free needs the phone app. Here, use the No and Yes buttons.
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
                <Text numberOfLines={2} style={[st.instruction, { fontWeight: '600' }]} accessibilityLiveRegion="polite">
                  {statusText}
                </Text>
                {percent ? (
                  <Text style={[type.label, { color: colors.textMuted }]} importantForAccessibility="no" accessibilityElementsHidden>
                    {percent}
                  </Text>
                ) : null}
                {said ? (
                  // Not a live region: announceForAccessibility already speaks it (avoids a double read on TalkBack).
                  <Text numberOfLines={1} style={[st.instruction, { color: colors.like }]}>
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
            {error ? (
              <Text style={[type.bodyStrong, { color: colors.hard }]} accessibilityLiveRegion="assertive" accessibilityRole="alert">
                {ERRORS[error]}
              </Text>
            ) : null}
            {error && detail ? <Text style={[type.label, { color: colors.textMuted }]}>{detail}</Text> : null}
            <PillButton
              icon={error ? 'refresh' : 'camera'}
              label={error ? 'Try again' : 'Turn on camera'}
              onPress={start}
              hint="Turns on the front camera for hands-free"
              style={st.bigStart}
            />
            <Text numberOfLines={2} style={st.instruction}>
              Look, turn or tilt left for No, right for Yes. You can also tap either half.
            </Text>
            <ModeSwitch mode={mode} onMode={pickMode} />
          </>
        )}
        {!web ? <Text numberOfLines={1} style={st.privacy}>{PRIVACY}</Text> : null}
      </ScrollView>

      <SwipeDeck
        compact
        ref={deckRef}
        cursor={cursor}
        enterFrom={enterFrom}
        canBack
        onAnswer={recordAnswer}
        onBack={onBack}
        cardContent={top ? (
          <SplitCard
            interest={top}
            mode={mode}
            side={tracking ? progress.side : null}
            progress={shown}
            onAnswer={answer}
          />
        ) : null}
      />
    </View>
  );
}

const st = StyleSheet.create({
  panel: {
    marginHorizontal: space.md,
    marginTop: space.xs,
    maxHeight: 212,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  panelContent: { padding: space.sm, gap: space.xs },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stop: { minHeight: tap.min, paddingHorizontal: space.md },
  instruction: { fontSize: 15, lineHeight: 19, color: colors.text },
  privacy: { fontSize: 13, lineHeight: 16, color: colors.textMuted },
  bigStart: { minHeight: 64 },
  preview: { width: 80, height: 60, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.text },
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
  splitCard: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadow.card,
  },
  halves: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row' },
  half: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: space.sm },
  rightHalf: { borderLeftWidth: 1, borderLeftColor: colors.border },
  halfFill: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  halfLabel: { fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center', marginBottom: space.sm },
  question: { alignItems: 'center', padding: space.sm, gap: space.xs },
  questionPrompt: { fontSize: 16, lineHeight: 20, color: colors.textMuted },
  questionEmoji: { fontSize: 48, lineHeight: 56 },
  questionTitle: { fontSize: 24, lineHeight: 28, fontWeight: '700', textAlign: 'center', color: colors.text },
});
