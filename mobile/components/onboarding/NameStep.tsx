// First screen: sample-person demos, name, and all three ways to answer (swipe / easier view / hands-free).
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { colors, radius, space, tap, type } from '@/lib/theme';

import { PillButton, s as ui, useHeadingFocus } from './ui';

export type AnswerMode = 'swipe' | 'easy' | 'hands';
export type DemoKey = 'margaret' | 'harold';

type IconName = keyof typeof Ionicons.glyphMap;

const MODES: { key: AnswerMode; icon: IconName; label: string; detail: string }[] = [
  { key: 'swipe', icon: 'albums-outline', label: 'Swipe cards', detail: 'One idea at a time. Swipe or tap No / Yes.' },
  { key: 'easy', icon: 'grid-outline', label: 'Easier view (big tiles)', detail: 'See every idea at once. Tap the ones you like.' },
  { key: 'hands', icon: 'eye-outline', label: 'Hands-free (eye tracker)', detail: 'Look or tilt your head toward No or Yes. Next screen: tap “Turn on camera”.' },
];

const DEMOS: { key: DemoKey; label: string }[] = [
  { key: 'margaret', label: 'Demo: Margaret' },
  { key: 'harold', label: 'Demo: Harold' },
];

export function NameStep({
  name,
  onName,
  mode,
  onMode,
  onStart,
  onDemo,
  busy,
  bottomInset,
}: {
  name: string;
  onName: (v: string) => void;
  mode: AnswerMode;
  onMode: (m: AnswerMode) => void;
  onStart: () => void;
  onDemo: (key: DemoKey) => void;
  busy?: boolean;
  bottomInset: number;
}) {
  const heading = useHeadingFocus();
  const { fontScale } = useWindowDimensions();
  return (
    <View style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.content}>
        <Text ref={heading} accessibilityRole="header" style={[type.title, { color: colors.text }]}>
          Let&apos;s find things you&apos;ll love
        </Text>

        <View style={[st.demos, fontScale > 1.3 && { flexDirection: 'column' }]}>
          {DEMOS.map((d) => (
            <Pressable
              key={d.key}
              accessibilityRole="button"
              accessibilityLabel={`${d.label}, sample person`}
              accessibilityHint="Skips the questions and shows matches for this sample person"
              accessibilityState={{ disabled: !!busy }}
              disabled={busy}
              onPress={() => onDemo(d.key)}
              style={({ pressed }) => [st.demo, busy && ui.disabled, pressed && ui.pressed]}>
              <Text style={[type.button, { color: colors.onPrimary }]}>{d.label}</Text>
              <Text style={st.demoSub}>Sample person</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ gap: space.xs }}>
          <Text style={[type.label, { color: colors.text }]}>Or answer yourself. What should we call you?</Text>
          <TextInput
            value={name}
            onChangeText={onName}
            placeholder="Your first name"
            placeholderTextColor={colors.textMuted}
            maxLength={60}
            autoCapitalize="words"
            autoComplete="given-name"
            returnKeyType="done"
            onSubmitEditing={busy ? undefined : onStart} // Enter / Done starts the questions
            accessibilityLabel="Your first name"
            accessibilityHint="Optional"
            editable={!busy}
            accessibilityState={{ disabled: !!busy }}
            style={st.input}
          />
        </View>

        <View style={{ gap: space.xs }}>
          <Text accessibilityRole="header" style={[type.label, { color: colors.text }]}>How would you like to answer?</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="How would you like to answer?" style={{ gap: space.sm }}>
            {MODES.map((m) => {
              const on = m.key === mode;
              const fg = on ? colors.onTileSelected : colors.text;
              return (
                <Pressable
                  key={m.key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: !!busy }}
                  accessibilityLabel={`${m.label}, ${m.detail}`}
                  disabled={busy}
                  onPress={() => onMode(m.key)}
                  style={({ pressed }) => [st.mode, on && st.modeOn, pressed && ui.pressed]}>
                  <Ionicons name={m.icon} size={26} color={fg} />
                  <View style={{ flex: 1 }}>
                    <Text style={[st.modeLabel, { color: fg }]}>{m.label}</Text>
                    <Text style={[st.modeHint, { color: on ? colors.onTileSelected : colors.textMuted }]}>{m.detail}</Text>
                  </View>
                  <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={fg} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={[ui.footer, { paddingBottom: bottomInset + space.md }]}>
        <PillButton label="Start" icon="arrow-forward" onPress={onStart} disabled={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  content: { padding: space.md, gap: space.md },
  demos: { flexDirection: 'row', gap: space.sm },
  demo: {
    flex: 1,
    minHeight: tap.min + 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
  },
  demoSub: { fontSize: 16, lineHeight: 22, fontWeight: '500', color: colors.onPrimary },
  input: {
    minHeight: tap.min,
    fontSize: 22,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  mode: {
    minHeight: tap.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.tile,
  },
  modeOn: { backgroundColor: colors.tileSelected, borderColor: colors.tileSelected },
  modeLabel: { fontSize: 19, lineHeight: 24, fontWeight: '600' },
  modeHint: { fontSize: 16, lineHeight: 22 },
});
