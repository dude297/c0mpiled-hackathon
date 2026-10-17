// Choose a person, then a mode. Only Start advances into the intake.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, space, tap, type } from '@/lib/theme';
import { canStartIntake, type AnswerMode, type PersonChoice } from '@/lib/onboarding';

import { PillButton, s as ui, useHeadingFocus } from './ui';

type IconName = keyof typeof Ionicons.glyphMap;

const MODES: { key: AnswerMode; icon: IconName; label: string; detail: string }[] = [
  { key: 'swipe', icon: 'albums-outline', label: 'Swipe cards', detail: 'One idea at a time. Swipe or tap No / Yes.' },
  { key: 'easy', icon: 'grid-outline', label: 'Easier view (big tiles)', detail: 'See every idea at once. Tap the ones you like.' },
  { key: 'hands', icon: 'eye-outline', label: 'Hands-free (eye tracker)', detail: 'Look or tilt your head toward No or Yes. Next screen: tap “Turn on camera”.' },
];

export function NameStep({
  person,
  onPerson,
  name,
  onName,
  mode,
  onMode,
  onStart,
  onSkipDemo,
  busy,
  bottomInset,
}: {
  person: PersonChoice | null;
  onPerson: (person: PersonChoice) => void;
  name: string;
  onName: (v: string) => void;
  mode: AnswerMode | null;
  onMode: (m: AnswerMode) => void;
  onStart: () => void;
  onSkipDemo: () => void;
  busy?: boolean;
  bottomInset: number;
}) {
  const heading = useHeadingFocus();
  const canStart = canStartIntake(person, name, mode);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.content}>
        <Text ref={heading} accessibilityRole="header" style={[type.title, { color: colors.text }]}>
          Who is this for?
        </Text>

        <View accessibilityRole="radiogroup" accessibilityLabel="Who is this for?" style={{ gap: space.sm }}>
          {([{ key: 'margaret', label: 'Margaret (sample person)' }, { key: 'self', label: 'Answer as myself' }] as const).map((p) => (
            <Pressable
              key={p.key}
              accessibilityRole="radio"
              aria-checked={person === p.key}
              accessibilityLabel={p.label}
              accessibilityHint={p.key === 'margaret' ? 'Pre-fills sample answers for you to review and change' : 'Enter your first name below'}
              aria-disabled={!!busy}
              disabled={busy}
              onPress={() => onPerson(p.key)}
              style={({ pressed }) => [st.person, person === p.key && st.modeOn, busy && ui.disabled, pressed && ui.pressed]}>
              <Text style={[type.heading, { flex: 1, color: person === p.key ? colors.onTileSelected : colors.text }]}>{p.label}</Text>
              <Ionicons name={person === p.key ? 'checkmark-circle' : 'ellipse-outline'} size={28} color={person === p.key ? colors.onTileSelected : colors.text} />
            </Pressable>
          ))}
        </View>

        {person === 'self' ? <View style={{ gap: space.xs }}>
          <Text style={[type.label, { color: colors.text }]}>What should we call you?</Text>
          <TextInput
            value={name}
            onChangeText={onName}
            placeholder="Your first name"
            placeholderTextColor={colors.textMuted}
            maxLength={60}
            autoCapitalize="words"
            autoComplete="given-name"
            returnKeyType="done"
            editable={!busy}
            onSubmitEditing={!busy && canStart ? onStart : undefined}
            accessibilityLabel="Your first name"
            accessibilityHint="Enter your name, then choose how you would like to answer"
            style={st.input}
          />
        </View> : null}

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
                  aria-checked={on}
                  accessibilityLabel={`${m.label}, ${m.detail}`}
                  aria-disabled={!!busy}
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
        {person === 'margaret' ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Skip to Margaret's results"
            accessibilityHint="Skips the intake and uses Margaret's original sample profile"
            aria-disabled={!!busy}
            disabled={busy}
            onPress={onSkipDemo}
            style={({ pressed }) => [st.skip, busy && ui.disabled, pressed && ui.pressed]}>
            <Text style={st.skipText}>Skip to Margaret&apos;s results</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={[ui.footer, { paddingBottom: bottomInset + space.md }]}>
        <PillButton label="Start" icon="arrow-forward" onPress={onStart} disabled={busy || !canStart} hint={!canStart ? 'Choose a person and an answer mode first' : undefined} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  content: { padding: space.md, gap: space.md },
  person: {
    minHeight: 80,
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.tile,
    borderWidth: 2,
    borderColor: colors.border,
  },
  skip: { minHeight: tap.min, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: space.sm },
  skipText: { fontSize: 16, lineHeight: 22, color: colors.textMuted, textDecorationLine: 'underline' },
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
  modeHint: { fontSize: 15, lineHeight: 20 },
});
