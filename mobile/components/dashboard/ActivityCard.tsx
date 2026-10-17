import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { costText, travelLabel, whenText } from '@/lib/copy';
import type { PlanItem } from '@/lib/schema';
import { colors, radius, shadow, space, tap, type } from '@/lib/theme';

import { styles, tapHaptic, useReason } from './ui';

type IconName = keyof typeof Ionicons.glyphMap;

function Meta({ icon, text, strong }: { icon: IconName; text: string; strong?: boolean }) {
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={22} color={colors.textMuted} style={{ marginTop: 2 }} />
      <Text style={[strong ? type.bodyStrong : type.body, { color: strong ? colors.text : colors.textMuted, flex: 1 }]}>{text}</Text>
    </View>
  );
}

/** Big "Add to my week" toggle: heart icon + words, never color alone. */
function HeartToggle({ name, added, onToggle }: { name: string; added: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onToggle();
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: added }}
      accessibilityLabel={`Add ${name} to my week`}
      accessibilityHint={added ? 'Removes it from My week' : 'Adds it to My week'}
      style={({ pressed }) => [
        {
          minHeight: tap.min,
          paddingHorizontal: space.sm,
          paddingVertical: space.sm,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          borderRadius: radius.md,
          borderWidth: 2,
          borderColor: added ? colors.like : colors.text,
          backgroundColor: added ? colors.like : colors.surface,
        },
        pressed && { opacity: 0.85, transform: reduce ? [] : [{ scale: 0.97 }] },
      ]}>
      <Ionicons name={added ? 'heart' : 'heart-outline'} size={30} color={added ? colors.onPrimary : colors.text} />
      <Text style={[type.button, { color: added ? colors.onPrimary : colors.text, flexShrink: 1, textAlign: 'center' }]}>{added ? 'In my week ✓' : 'Add to my week'}</Text>
    </Pressable>
  );
}

export function ActivityCard({ item, added, onToggle }: { item: PlanItem; added: boolean; onToggle: () => void }) {
  const soft = item.barriers.filter((b) => b.severity === 'soft');
  const reason = useReason();
  return (
    <View style={[styles.card, shadow.card, added && { borderColor: colors.like, borderWidth: 2 }]}>
      <Text style={[type.heading, { color: colors.text }]}>{item.name}</Text>
      <Meta icon="time-outline" text={whenText(item.when)} />
      <Meta icon="location-outline" text={travelLabel(item.travel)} />
      <Meta icon="wallet-outline" text={costText(item.costPerWeek)} strong />
      {soft.map((b) => {
        const text = reason(b.rule, b.detail, true, { id: item.activityId });
        return (
          <View key={b.rule} style={styles.softBox} accessible accessibilityLabel={`Heads up: ${text}${b.mitigation ? ` What helps: ${b.mitigation}.` : ''}`}>
            <View style={styles.metaRow}>
              <Ionicons name="warning" size={22} color={colors.soft} style={{ marginTop: 2 }} />
              <Text style={[type.bodyStrong, { color: colors.soft, flex: 1 }]}>Heads up: {text}</Text>
            </View>
            {b.mitigation && <Text style={[type.body, { color: colors.text }]}>→ {b.mitigation}</Text>}
          </View>
        );
      })}
      <View style={{ marginTop: space.xs }}>
        <HeartToggle name={item.name} added={added} onToggle={onToggle} />
      </View>
    </View>
  );
}
