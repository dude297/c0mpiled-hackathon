// Small shared pieces for onboarding: haptics, pill buttons, round action buttons, option rows.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space, tap, type } from '@/lib/theme';

export type IconName = keyof typeof Ionicons.glyphMap;

const native = Platform.OS !== 'web';
export const haptic = {
  tick: () => {
    if (native) Haptics.selectionAsync().catch(() => {});
  },
  impact: () => {
    if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
};

export function PillButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  hint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline';
  icon?: IconName;
  disabled?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = variant === 'primary' ? colors.onPrimary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.pill,
        variant === 'primary' ? s.primary : s.outline,
        disabled && s.disabled,
        pressed && s.pressed,
        style,
      ]}>
      {icon && <Ionicons name={icon} size={24} color={fg} />}
      <Text style={[type.button, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

// Big round button with a visible word under the icon (never icon-only).
export function CircleButton({
  icon,
  label,
  a11yLabel,
  color,
  size = 80,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  a11yLabel: string;
  color: string;
  size?: number;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [s.circleWrap, disabled && s.disabled, pressed && s.pressed]}>
      <View style={[s.circle, shadow.card, { width: size, height: size, borderRadius: size / 2, borderColor: color }]}>
        <Ionicons name={icon} size={Math.round(size * 0.45)} color={color} />
      </View>
      <Text style={[type.label, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

// One big tappable answer. Selected = dark fill + white text + check icon (never color alone).
export function OptionRow({
  label,
  detail,
  emoji,
  icon,
  selected,
  multi,
  onPress,
}: {
  label: string;
  detail?: string;
  emoji?: string;
  icon?: IconName;
  selected: boolean;
  multi?: boolean;
  onPress: () => void;
}) {
  const fg = selected ? colors.onTileSelected : colors.text;
  const mark: IconName = multi
    ? selected ? 'checkbox' : 'square-outline'
    : selected ? 'checkmark-circle' : 'ellipse-outline';
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [s.option, selected && s.optionOn, pressed && s.pressed]}>
      {emoji ? (
        <Text style={s.emoji} importantForAccessibility="no">{emoji}</Text>
      ) : icon ? (
        <Ionicons name={icon} size={32} color={fg} />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.heading, { color: fg }]}>{label}</Text>
        {detail ? <Text style={[type.body, { color: selected ? colors.onTileSelected : colors.textMuted }]}>{detail}</Text> : null}
      </View>
      <Ionicons name={mark} size={32} color={fg} />
    </Pressable>
  );
}

export const s = StyleSheet.create({
  pill: {
    minHeight: tap.min + 8,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  primary: { backgroundColor: colors.primary },
  outline: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.text },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  circleWrap: { alignItems: 'center', gap: space.xs, minWidth: tap.min },
  circle: { backgroundColor: colors.surface, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  option: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.tile,
  },
  optionOn: { backgroundColor: colors.tileSelected, borderColor: colors.tileSelected },
  emoji: { fontSize: 34, lineHeight: 42 },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
