import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { ActivityCard } from '@/components/dashboard/ActivityCard';
import { BigButton, Collapsible, ResultGate, Screen, styles, useChangeAnswers, useReason } from '@/components/dashboard/ui';
import { summaryText } from '@/lib/copy';
import { useApp } from '@/lib/store';
import { colors, space, type } from '@/lib/theme';

export default function Matches() {
  const { added, toggleAdded, firstName } = useApp();
  const reason = useReason();
  const changeAnswers = useChangeAnswers();
  return (
    <Screen title="Matches">
      <ResultGate>
        {(result) => (
          <>
            <Text style={[type.bodyStrong, { color: colors.text, fontSize: 20, lineHeight: 28 }]}>{summaryText(result.plan.length, firstName)}</Text>

            {result.plan.length === 0 ? (
              <View style={[styles.card, { alignItems: 'center' }]} accessibilityLiveRegion="polite">
                <Ionicons name="search" size={40} color={colors.textMuted} />
                <Text style={[type.heading, { color: colors.text, textAlign: 'center' }]}>Nothing fit this week</Text>
                <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>
                  Try allowing more travel time, a bigger budget, or different times of day.
                </Text>
                <BigButton label="Change my answers" icon="create-outline" onPress={changeAnswers} />
              </View>
            ) : (
              <View style={{ gap: space.md }}>
                {result.plan.map((item) => (
                  <ActivityCard key={item.activityId} item={item} added={added.has(item.activityId)} onToggle={() => toggleAdded(item.activityId)} />
                ))}
              </View>
            )}

            <Collapsible
              title="Not a match — here's why"
              subtitle={result.blocked.length ? `${result.blocked.length} ruled out` : 'Nothing was ruled out'}>
              {result.blocked.length === 0 ? (
                <View style={styles.metaRow}>
                  <Ionicons name="checkmark-circle" size={24} color={colors.like} />
                  <Text style={[type.body, { color: colors.text, flex: 1 }]}>Every option could be worked around.</Text>
                </View>
              ) : (
                result.blocked.map((b) => (
                  <View key={b.name} style={[styles.card, { borderColor: colors.hardBorder, borderWidth: 2, backgroundColor: colors.hardBg }]}>
                    <Text style={[type.heading, { color: colors.text }]}>{b.name}</Text>
                    {b.barriers
                      .filter((x) => x.severity === 'hard')
                      .map((x) => {
                        const text = reason(x.rule, x.detail, false, { name: b.name });
                        return (
                          <View key={x.rule} style={styles.metaRow} accessible accessibilityLabel={`Blocked: ${text}`}>
                            <Ionicons name="close-circle" size={24} color={colors.hard} style={{ marginTop: 1 }} />
                            <Text style={[type.bodyStrong, { color: colors.hard, flex: 1 }]}>{text}</Text>
                          </View>
                        );
                      })}
                  </View>
                ))
              )}
            </Collapsible>
          </>
        )}
      </ResultGate>
    </Screen>
  );
}
