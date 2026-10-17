// Easier view: NYT-Connections-style grid. Tap a tile to pick it; no swiping anywhere.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { INTEREST_META } from '@/lib/onboarding';
import { colors, radius, space, type } from '@/lib/theme';

import { PillButton, s as ui, useHeadingFocus } from './ui';

type Key = (typeof INTEREST_META)[number]['key'];

export function InterestGrid({
  sampleInterests,
  picked,
  onToggle,
  onClear,
  onContinue,
  bottomInset,
}: {
  sampleInterests?: readonly Key[];
  picked: ReadonlySet<Key>;
  onToggle: (key: Key) => void;
  onClear: () => void;
  onContinue: () => void;
  bottomInset: number;
}) {
  const heading = useHeadingFocus();
  const n = picked.size;
  const { fontScale } = useWindowDimensions();
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={st.content}>
        <Text ref={heading} accessibilityRole="header" style={[type.title, { color: colors.text }]}>What sounds fun?</Text>
        <Text style={[type.body, { color: colors.textMuted }]}>Tap everything you would enjoy. Tap again to remove it.</Text>
        <Text accessibilityLiveRegion="polite" style={[type.bodyStrong, { color: colors.text }]}>
          {n} picked
        </Text>
        <View style={st.grid}>
          {INTEREST_META.map((i) => {
            const on = picked.has(i.key);
            const fg = on ? colors.onTileSelected : colors.text;
            const presenterHint = sampleInterests ? `Margaret would say: ${sampleInterests.includes(i.key) ? 'Yes' : 'No'}` : undefined;
            return (
              <Pressable
                key={i.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={i.label}
                accessibilityHint={presenterHint}
                onPress={() => onToggle(i.key)}
                style={({ pressed }) => [st.tile, fontScale > 1.3 && { flexBasis: '100%' }, on && st.tileOn, pressed && ui.pressed]}>
                {on && <Ionicons name="checkmark-circle" size={28} color={fg} style={st.check} />}
                <Text style={st.emoji} importantForAccessibility="no">{i.emoji}</Text>
                <Text style={[type.label, { color: fg, fontWeight: '700', fontSize: 20, lineHeight: 24, textAlign: 'center' }]}>
                  {i.label}
                </Text>
                {presenterHint ? <Text style={[st.presenterHint, { color: on ? colors.onTileSelected : colors.textMuted }]}>{presenterHint}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={[ui.footer, { paddingBottom: bottomInset + space.md }]}>
        <PillButton variant="outline" label="Clear all" onPress={onClear} disabled={n === 0} style={{ flex: 1 }} />
        <PillButton label="Continue" icon="arrow-forward" onPress={onContinue} style={{ flex: 1.3 }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  content: { padding: space.md, gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    flexBasis: '40%',
    flexGrow: 1,
    minHeight: 128,
    borderRadius: radius.lg,
    backgroundColor: colors.tile,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.md,
    gap: space.sm,
  },
  tileOn: { backgroundColor: colors.tileSelected },
  check: { position: 'absolute', top: space.sm, right: space.sm },
  emoji: { fontSize: 40, lineHeight: 48 },
  presenterHint: { fontSize: 15, lineHeight: 20, textAlign: 'center' },
});
