import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { ActivityCard } from '@/components/dashboard/ActivityCard';
import { ResultGate, Screen, styles } from '@/components/dashboard/ui';
import { DAY_NAMES, money, placeOnWeek, SLOT_LABELS } from '@/components/dashboard/week';
import { costText } from '@/lib/copy';
import type { PlanItem } from '@/lib/schema';
import { useApp } from '@/lib/store';
import { colors, radius, space, type } from '@/lib/theme';

function SlotChip({ emoji, label }: { emoji: string; label: string }) {
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: colors.tile }}>
      <Text style={type.label} importantForAccessibility="no" accessibilityElementsHidden>{emoji}</Text>
      <Text style={[type.label, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

export default function Week() {
  const { added, toggleAdded } = useApp();
  return (
    <Screen title="My week">
      <ResultGate>
        {(result) => {
          const items = result.plan.filter((i) => added.has(i.activityId));
          if (items.length === 0) {
            return (
              <View style={[styles.card, { alignItems: 'center' }]}>
                <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
                <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>Your week is open</Text>
                <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>
                  On the Matches tab, tap “Add to my week” and it will show up here.
                </Text>
              </View>
            );
          }
          const { days, unscheduled } = placeOnWeek(items);
          const total = items.reduce((s, i) => s + i.costPerWeek, 0);
          const card = (i: PlanItem) => <ActivityCard key={i.activityId} item={i} added onToggle={() => toggleAdded(i.activityId)} />;
          return (
            <>
              {days.map((d) =>
                d.count === 0 ? (
                  <View key={d.day} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }} accessible accessibilityLabel={`${DAY_NAMES[d.day]}: free day`}>
                    <Text style={[type.bodyStrong, { color: colors.textMuted }]}>{DAY_NAMES[d.day]}</Text>
                    <Text style={[type.body, { color: colors.textMuted }]}>Free day</Text>
                  </View>
                ) : (
                  <View key={d.day} style={{ gap: space.sm }}>
                    <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>
                      {DAY_NAMES[d.day]} · {d.count} {d.count === 1 ? 'outing' : 'outings'}
                    </Text>
                    {d.slots
                      .filter((s) => s.items.length)
                      .map((s) => (
                        <View key={s.slot} style={{ gap: space.sm }}>
                          <SlotChip {...SLOT_LABELS[s.slot]} />
                          {s.items.map(card)}
                        </View>
                      ))}
                  </View>
                ),
              )}
              {unscheduled.length > 0 && (
                <View style={{ gap: space.sm }}>
                  <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>Time to be confirmed</Text>
                  {unscheduled.map(card)}
                </View>
              )}
              <View style={[styles.card, { flexDirection: 'row', justifyContent: 'space-between' }]} accessible accessibilityLabel={`${items.length} ${items.length === 1 ? 'outing' : 'outings'} this week, ${total === 0 ? 'all free' : `${money(total)} a week in total`}`}>
                <Text style={[type.heading, { color: colors.text }]}>{items.length} {items.length === 1 ? 'outing' : 'outings'}</Text>
                <Text style={[type.heading, { color: colors.text }]}>{costText(total)}</Text>
              </View>
            </>
          );
        }}
      </ResultGate>
    </Screen>
  );
}
