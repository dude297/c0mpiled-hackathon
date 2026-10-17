// First screen: name + the prominent "how do you want to answer" choice (swipe vs easier view).
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, space, tap, type } from '@/lib/theme';

import { OptionRow, PillButton, s as ui } from './ui';

export function NameStep({
  name,
  onName,
  easy,
  onEasy,
  onStart,
  bottomInset,
}: {
  name: string;
  onName: (v: string) => void;
  easy: boolean;
  onEasy: (v: boolean) => void;
  onStart: () => void;
  bottomInset: number;
}) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.content}>
        <Text accessibilityRole="header" style={[type.display, { color: colors.text }]}>
          Let&apos;s find things you&apos;ll love
        </Text>
        <Text style={[type.body, { color: colors.textMuted }]}>A few quick questions. About two minutes.</Text>

        <View style={{ gap: space.sm }}>
          <Text style={[type.label, { color: colors.text }]}>What should we call you?</Text>
          <TextInput
            value={name}
            onChangeText={onName}
            placeholder="Margaret"
            placeholderTextColor={colors.textMuted}
            maxLength={60}
            autoCapitalize="words"
            autoComplete="given-name"
            returnKeyType="done"
            accessibilityLabel="Your first name"
            accessibilityHint="Optional"
            style={st.input}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>How would you like to answer?</Text>
          <View accessibilityRole="radiogroup" style={{ gap: space.md }}>
            <OptionRow
              icon="albums-outline"
              label="Swipe cards"
              detail="One idea at a time. Swipe right for yes, left for no, or tap the buttons."
              selected={!easy}
              onPress={() => onEasy(false)}
            />
            <OptionRow
              icon="grid-outline"
              label="Easier view"
              detail="See every idea at once and tap the ones you like. No swiping."
              selected={easy}
              onPress={() => onEasy(true)}
            />
          </View>
        </View>
      </ScrollView>
      <View style={[ui.footer, { paddingBottom: bottomInset + space.md }]}>
        <PillButton label="Start" icon="arrow-forward" onPress={onStart} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  content: { padding: space.md, gap: space.lg },
  input: {
    minHeight: tap.min + 8,
    fontSize: 22,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
});
