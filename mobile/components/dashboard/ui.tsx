// Shared building blocks for the three dashboard tabs.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AnalysisResult } from '@/lib/schema';
import { useApp, type ResultSource } from '@/lib/store';
import { colors, radius, space, tap, type } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

export function tapHaptic() {
  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** reset() then back to onboarding. Same action from every tab. */
export function useChangeAnswers() {
  const router = useRouter();
  const { reset } = useApp();
  return () => {
    reset();
    router.replace('/onboarding');
  };
}

/** Honest provenance: where the plan was computed + whether the words came from a real model. */
export function ProvenancePill({ source, dataSource }: { source: ResultSource | null; dataSource: AnalysisResult['dataSource'] }) {
  const onDevice = source !== 'server';
  const ai = dataSource === 'live' ? 'live AI' : 'mock AI';
  const text = onDevice ? `On-device · ${ai}` : `Server · ${ai}`;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={onDevice ? `Worked out on this phone. Explanation is ${ai}.` : `Worked out by the server. Explanation is ${ai}.`}
      style={styles.pill}>
      <Ionicons name={onDevice ? 'phone-portrait-outline' : dataSource === 'live' ? 'sparkles-outline' : 'cloud-outline'} size={20} color={colors.text} />
      <Text style={[type.label, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

/** Safe-area screen with a big title and the provenance pill pinned above the scroll area. */
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  const { result, source } = useApp();
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[type.title, { color: colors.text, flexShrink: 1 }]}>
          {title}
        </Text>
        {result && <ProvenancePill source={source} dataSource={result.dataSource} />}
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>{children}</ScrollView>
    </SafeAreaView>
  );
}

export function BigButton({
  label,
  icon,
  onPress,
  variant = 'primary',
  hint,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  variant?: 'primary' | 'outline';
  hint?: string;
}) {
  const reduce = useReducedMotion();
  const primary = variant === 'primary';
  const fg = primary ? colors.onPrimary : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.text },
        pressed && { opacity: 0.85, transform: reduce ? [] : [{ scale: 0.98 }] },
      ]}>
      {icon && <Ionicons name={icon} size={24} color={fg} />}
      <Text style={[type.button, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Tap-to-expand section. Header is a real button with expanded state. */
export function Collapsible({ title, subtitle, children, initiallyOpen = false }: { title: string; subtitle?: string; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={{ gap: space.md }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ''}`}
        accessibilityHint={open ? 'Hides this section' : 'Shows this section'}
        style={({ pressed }) => [styles.collapseHead, pressed && { opacity: 0.85 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[type.heading, { color: colors.text }]}>{title}</Text>
          {subtitle && <Text style={[type.body, { color: colors.textMuted }]}>{subtitle}</Text>}
        </View>
        <Text style={[type.label, { color: colors.text }]}>{open ? 'Hide' : 'Show'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={28} color={colors.text} />
      </Pressable>
      {open && children}
    </View>
  );
}

/** Renders loading / error / no-plan states; children only once there is a result. */
export function ResultGate({ children }: { children: (r: AnalysisResult) => ReactNode }) {
  const { result, loading, error, profile, analyze } = useApp();
  const changeAnswers = useChangeAnswers();
  if (loading) {
    return (
      <View style={styles.center} accessibilityLiveRegion="polite" accessible accessibilityLabel="Finding good matches. One moment.">
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>Finding good matches…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center} accessibilityLiveRegion="assertive">
        <Ionicons name="warning" size={40} color={colors.hard} />
        <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>Something went wrong</Text>
        <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>{error}</Text>
        {profile && <BigButton label="Try again" icon="refresh" onPress={() => analyze(profile)} />}
        <BigButton label="Change my answers" icon="create-outline" variant="outline" onPress={changeAnswers} />
      </View>
    );
  }
  if (!result) {
    return (
      <View style={styles.center}>
        <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>No plan yet</Text>
        <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>Answer a few quick questions and we will find activities that fit.</Text>
        <BigButton label="Start" icon="create-outline" onPress={changeAnswers} />
      </View>
    );
  }
  return <>{children(result)}</>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  scroll: { padding: space.md, paddingBottom: space.xxl, gap: space.lg },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: colors.surface,
  },
  button: {
    minHeight: tap.min,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  collapseHead: {
    minHeight: tap.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  center: { gap: space.md, alignItems: 'center', paddingVertical: space.xl },
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  softBox: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.softBorder, backgroundColor: colors.softBg, gap: space.xs },
});
