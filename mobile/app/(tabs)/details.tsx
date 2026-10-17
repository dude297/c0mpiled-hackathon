import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { BigButton, Collapsible, ResultGate, Screen, styles, useChangeAnswers } from '@/components/dashboard/ui';
import { INTEREST_META } from '@/lib/onboarding';
import type { Profile } from '@/lib/schema';
import { useApp } from '@/lib/store';
import { colors, space, type } from '@/lib/theme';

const MOBILITY: Record<Profile['mobility'], string> = {
  full: 'Gets around easily',
  cane: 'Uses a cane — stairs are a hassle',
  walker: 'Uses a walker — avoids stairs',
  wheelchair: 'Uses a wheelchair — needs step-free access',
};
const TRANSPORT: Record<Profile['transport'][number], string> = {
  drive: 'drives', bus: 'bus', paratransit: 'paratransit', family: 'rides from family', walk: 'walks',
};
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ gap: 2 }}>
      <Text style={[type.label, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[type.body, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export default function Details() {
  const { profile } = useApp();
  const changeAnswers = useChangeAnswers();
  return (
    <Screen title="Details">
      {profile && (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>Planning for {profile.name}</Text>
          <Row label="Enjoys" value={list(profile.interests.map((k) => INTEREST_META.find((m) => m.key === k)?.label ?? k))} />
          <Row label="Free times" value={list(profile.times.map((t) => `${t}s`))} />
          <Row label="Getting around" value={MOBILITY[profile.mobility]} />
          <Row label="Travel" value={`Up to ${profile.maxTravelMin} minutes · ${list(profile.transport.map((t) => TRANSPORT[t]))}`} />
          <Row label="Budget" value={profile.budgetPerWeek === 0 ? 'Free activities only' : `Up to $${profile.budgetPerWeek} a week`} />
          {(profile.hearingImpaired || profile.prefersSmallGroups) && (
            <Row label="Also" value={list([profile.hearingImpaired && 'hard of hearing', profile.prefersSmallGroups && 'prefers small groups'].filter(Boolean) as string[])} />
          )}
        </View>
      )}
      {profile && <BigButton label="Change my answers" icon="create-outline" variant="outline" onPress={changeAnswers} hint="Goes back to the questions" />}
      <ResultGate>
        {(result) => {
          const passed = result.evidence.filter((e) => e.verified).length;
          const flagged = result.evidence.length - passed;
          return (
            <>
              <View style={[styles.card, { gap: space.md }]}>
                {result.items.map((it) => (
                  <View key={it.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }} accessible accessibilityLabel={`${it.label}: ${it.value}`}>
                    <Text style={[type.body, { color: colors.textMuted, flex: 1 }]}>{it.label}</Text>
                    <Text style={[type.bodyStrong, { color: colors.text }]}>{it.value}</Text>
                  </View>
                ))}
              </View>
              <Collapsible title="Every check we ran" subtitle={`${passed} passed · ${flagged} problem${flagged === 1 ? '' : 's'}`}>
                {result.evidence.map((e) => (
                  <View key={e.source} style={[styles.metaRow, { paddingVertical: space.xs }]} accessible accessibilityLabel={`${e.verified ? 'Passed' : 'Problem'}: ${e.claim}`}>
                    <Ionicons name={e.verified ? 'checkmark-circle' : 'close-circle'} size={24} color={e.verified ? colors.like : colors.hard} style={{ marginTop: 1 }} />
                    <Text style={[type.body, { color: colors.text, flex: 1 }]}>
                      <Text style={[type.bodyStrong, { color: e.verified ? colors.like : colors.hard }]}>{e.verified ? 'Passed: ' : 'Problem: '}</Text>
                      {e.claim}
                    </Text>
                  </View>
                ))}
              </Collapsible>
            </>
          );
        }}
      </ResultGate>
    </Screen>
  );
}
