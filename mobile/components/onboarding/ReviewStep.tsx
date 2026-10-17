// "Here's what we heard": every answer in plain words, each with a Change button, before matching.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ReviewField, ReviewRow } from '@/lib/onboarding';
import { colors, radius, space, type } from '@/lib/theme';

import { PillButton, s as ui, useHeadingFocus } from './ui';

export function ReviewStep({
  rows,
  onChange,
  onConfirm,
  busy,
  bottomInset,
}: {
  rows: readonly ReviewRow[];
  onChange: (field: ReviewField) => void;
  onConfirm: () => void;
  busy?: boolean;
  bottomInset: number;
}) {
  const heading = useHeadingFocus();
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md }}>
        <Text ref={heading} accessibilityRole="header" style={[type.title, { color: colors.text }]}>
          Here's what we heard
        </Text>
        <Text style={[type.body, { color: colors.textMuted }]}>Check each answer. Tap Change to fix one.</Text>
        {rows.map((r) => (
          <View key={r.id} style={st.row} accessible={false}>
            <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${r.title}: ${r.text}`}>
              <Text style={[type.label, { color: colors.textMuted }]}>{r.title}</Text>
              <Text style={[type.heading, { color: colors.text }]}>{r.value}</Text>
              {r.isDefault ? <Text style={[type.bodyStrong, { color: colors.soft }]}>(default)</Text> : null}
            </View>
            <PillButton
              variant="outline"
              label="Change"
              a11yLabel={`Change ${r.title.toLowerCase()}`}
              onPress={() => onChange(r.field)}
              disabled={busy}
              style={st.change}
            />
          </View>
        ))}
      </ScrollView>
      <View style={[ui.footer, { paddingBottom: bottomInset + space.md }]}>
        <PillButton
          label={busy ? 'Finding matches…' : 'See my matches'}
          icon={busy ? undefined : 'arrow-forward'}
          onPress={onConfirm}
          disabled={busy}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  change: { paddingHorizontal: space.md },
});
