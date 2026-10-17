// "Here's what we heard": every answer in plain words, each with a Change button, before matching.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { cleanName } from '@/lib/copy';
import type { ReviewField, ReviewRow } from '@/lib/onboarding';
import { colors, radius, space, type } from '@/lib/theme';

import { PillButton, s as ui, useHeadingFocus } from './ui';

export function ReviewStep({
  name,
  onChangeName,
  rows,
  onChange,
  onConfirm,
  busy,
  bottomInset,
  note,
}: {
  name: string;
  onChangeName: () => void;
  rows: readonly ReviewRow[];
  onChange: (field: ReviewField) => void;
  onConfirm: () => void;
  busy?: boolean;
  bottomInset: number;
  note?: { text: string; onChange: () => void }; // blocking problem: shown inline, See my matches stays off until fixed
}) {
  const heading = useHeadingFocus();
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md }}>
        <Text ref={heading} accessibilityRole="header" style={[type.title, { color: colors.text }]}>
          Here's what we heard
        </Text>
        <Text style={[type.body, { color: colors.textMuted }]}>Check each answer. Tap Change to fix one.</Text>
        <NameRow name={cleanName(name)} onChange={onChangeName} busy={busy} />
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
        {note ? (
          <View style={[st.row, { borderColor: colors.softBorder, backgroundColor: colors.softBg }]} accessible={false}>
            <Text accessibilityLiveRegion="polite" style={[type.bodyStrong, { color: colors.soft, flex: 1 }]}>
              {note.text}
            </Text>
            <PillButton variant="outline" label="Change" a11yLabel="Change how you get places" onPress={note.onChange} disabled={busy} style={st.change} />
          </View>
        ) : null}
      </ScrollView>
      <View style={[ui.footer, { paddingBottom: bottomInset + space.md }]}>
        <PillButton
          label={busy ? 'Finding matches…' : 'See my matches'}
          icon={busy ? undefined : 'arrow-forward'}
          onPress={onConfirm}
          disabled={busy || !!note}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

// Optional name: blank is fine, and we say so — the app then talks to "you", never a stand-in name.
function NameRow({ name, onChange, busy }: { name: string | null; onChange: () => void; busy?: boolean }) {
  const value = name ?? 'Not given';
  const note = name ? null : 'We’ll just say “you”.';
  return (
    <View style={st.row} accessible={false}>
      <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Your name: ${value}.${note ? ` ${note}` : ''}`}>
        <Text style={[type.label, { color: colors.textMuted }]}>Your name</Text>
        <Text style={[type.heading, { color: colors.text }]}>{value}</Text>
        {note ? <Text style={[type.body, { color: colors.textMuted }]}>{note}</Text> : null}
      </View>
      <PillButton variant="outline" label="Change" a11yLabel="Change your name" onPress={onChange} disabled={busy} style={st.change} />
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
