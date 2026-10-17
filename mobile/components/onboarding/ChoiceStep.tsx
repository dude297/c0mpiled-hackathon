// Full-screen question with huge tappable answers and a Continue button — no swiping.
import { ScrollView, Text, View } from 'react-native';

import { colors, space, type } from '@/lib/theme';

import { OptionRow, PillButton, s as ui, useHeadingFocus } from './ui';

export type ChoiceOption = { id: string; label: string; detail?: string; emoji?: string };

export function ChoiceStep({
  title,
  subtitle,
  options,
  selected,
  multi,
  helper = 'Pick all that apply.',
  onToggle,
  onContinue,
  continueLabel = 'Continue',
  onSkip,
  busy,
  bottomInset,
}: {
  title: string;
  subtitle?: string;
  options: readonly ChoiceOption[];
  selected: readonly string[];
  multi?: boolean;
  helper?: string;
  onToggle: (id: string) => void;
  onContinue: () => void;
  continueLabel?: string;
  onSkip?: () => void;
  busy?: boolean;
  bottomInset: number;
}) {
  const heading = useHeadingFocus();
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md }}>
        <Text ref={heading} accessibilityRole="header" style={[type.title, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[type.body, { color: colors.textMuted }]}>{subtitle}</Text> : null}
        {multi ? <Text style={[type.bodyStrong, { color: colors.text }]}>{helper}</Text> : null}
        <View accessibilityRole={multi ? undefined : 'radiogroup'} accessibilityLabel={title} style={{ gap: space.md }}>
          {options.map((o) => (
            <OptionRow
              key={o.id}
              label={o.label}
              detail={o.detail}
              emoji={o.emoji}
              multi={multi}
              selected={selected.includes(o.id)}
              onPress={() => onToggle(o.id)}
            />
          ))}
        </View>
      </ScrollView>
      <View style={[ui.footer, { paddingBottom: bottomInset + space.md }]}>
        {onSkip ? <PillButton variant="outline" label="Skip" onPress={onSkip} disabled={busy} /> : null}
        <PillButton
          label={busy ? 'Finding matches…' : continueLabel}
          icon={busy ? undefined : 'arrow-forward'}
          onPress={onContinue}
          disabled={busy || selected.length === 0}
          hint={selected.length === 0 ? 'Pick an answer first' : undefined}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}
