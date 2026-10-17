// Shared building blocks for the three dashboard tabs.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ACTIVITIES } from '@/domain/activities';
import { provenanceCopy, reasonText } from '@/lib/copy';
import type { AnalysisResult } from '@/lib/schema';
import { useApp, type ResultSource } from '@/lib/store';
import { colors, radius, space, tap, type } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

export function tapHaptic() {
  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Back to the onboarding review ("Here's what we heard") with every answer kept. Same action from every tab.
 *  dismissTo pops to the onboarding screen under the tabs; if it isn't there (e.g. a web refresh), it replaces. */
export function useChangeAnswers() {
  const router = useRouter();
  return () => router.dismissTo('/onboarding');
}

/** Plain-language reason for one engine check, using what we know about the activity and the person. */
export function useReason() {
  const { firstName, profile } = useApp();
  return (rule: string, detail: string, ok: boolean, by: { id?: string; name?: string }) => {
    const activity = ACTIVITIES.find((a) => (by.id ? a.id === by.id : a.name === by.name)) ?? null;
    return reasonText(rule, detail, ok, { name: firstName, profile, activity });
  };
}

/**
 * Honest provenance, always visible: a short pill (icon = where it ran, words = what wrote the
 * explanation). Tap for the full sentence. Short enough to never truncate at 375–430pt.
 */
export function ProvenancePill({
  source,
  dataSource,
  open,
  onToggle,
}: {
  source: ResultSource | null;
  dataSource: AnalysisResult['dataSource'];
  open: boolean;
  onToggle: () => void;
}) {
  const { label, info } = provenanceCopy(source, dataSource);
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      aria-expanded={open}
      accessibilityLabel={`${label}. ${info}`}
      accessibilityHint={open ? 'Hides the explanation' : 'Shows what this means'}
      hitSlop={8}
      style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}>
      <Ionicons name={source === 'server' ? 'cloud-outline' : 'phone-portrait-outline'} size={20} color={colors.text} />
      <Text style={[type.label, { color: colors.text }]}>{label}</Text>
      <Ionicons name="information-circle-outline" size={22} color={colors.text} />
    </Pressable>
  );
}

/** Safe-area screen with a big title and the provenance pill pinned above the scroll area. */
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  const { result, source } = useApp();
  const [info, setInfo] = useState(false);
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[type.title, { color: colors.text, flexShrink: 1 }]}>
          {title}
        </Text>
        {result && <ProvenancePill source={source} dataSource={result.dataSource} open={info} onToggle={() => setInfo((v) => !v)} />}
        {result && info && (
          <Text accessibilityLiveRegion="polite" style={[type.body, { color: colors.text, flexBasis: '100%' }]}>
            {provenanceCopy(source, result.dataSource).info}
          </Text>
        )}
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
    flexShrink: 0,
    minHeight: 44,
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
