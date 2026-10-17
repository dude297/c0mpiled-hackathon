import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { BigButton, Collapsible, ResultGate, Screen, styles, useChangeAnswers, useReason } from '@/components/dashboard/ui';
import { ACTIVITIES } from '@/domain/activities';
import { evidenceDetail, parseEvidenceSource } from '@/lib/copy';
import { GROUP_TEXT, HEARING_TEXT, INTEREST_META } from '@/lib/onboarding';
import type { Profile } from '@/lib/schema';
import { useApp } from '@/lib/store';
import { colors, space, type } from '@/lib/theme';

const MOBILITY: Record<Profile['mobility'], string> = {
  // Exactly what they told us ("Do you use anything to help you walk?"); never add claims they didn't make.
  full: 'Walks on their own',
  cane: 'Uses a cane',
  walker: 'Uses a walker',
  wheelchair: 'Uses a wheelchair',
};
const TRANSPORT: Record<Profile['transport'][number], string> = {
  drive: 'drives', bus: 'bus', paratransit: 'senior shuttle', family: 'family rides', walk: 'walks',
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
  const { profile, firstName } = useApp();
  const reason = useReason();
  const changeAnswers = useChangeAnswers();
  return (
    <Screen title="Details">
      {profile && (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>{firstName ? `Planning for ${firstName}` : 'Your answers'}</Text>
          <Row label="Enjoys" value={list(profile.interests.map((k) => INTEREST_META.find((m) => m.key === k)?.label ?? k))} />
          <Row label="Free times" value={list(profile.times.map((t) => `${t}s`))} />
          <Row label="Getting around" value={MOBILITY[profile.mobility]} />
          <Row label="Travel" value={`Up to ${profile.maxTravelMin} minutes · ${list(profile.transport.map((t) => TRANSPORT[t]))}`} />
          <Row label="Budget" value={profile.budgetPerWeek === 0 ? 'Free activities only' : `Up to $${profile.budgetPerWeek} a week`} />
          <Row label="Hearing" value={profile.hearingImpaired ? HEARING_TEXT.yes : HEARING_TEXT.no} />
          <Row label="Group size" value={profile.prefersSmallGroups ? GROUP_TEXT.yes : GROUP_TEXT.no} />
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
                {result.evidence.map((e) => {
                  const src = parseEvidenceSource(e.source);
                  // claim is "<activity name>: <engine detail>"; reword the detail, keep the name.
                  const named = ACTIVITIES.find((x) => x.id === src?.activityId)?.name ?? e.claim.split(': ')[0];
                  const text = src ? `${named}: ${reason(src.rule, evidenceDetail(e.claim, named), e.verified, { id: src.activityId })}` : e.claim;
                  return (
                    <View key={e.source} style={[styles.metaRow, { paddingVertical: space.xs }]} accessible accessibilityLabel={`${e.verified ? 'Passed' : 'Problem'}: ${text}`}>
                      <Ionicons name={e.verified ? 'checkmark-circle' : 'close-circle'} size={24} color={e.verified ? colors.like : colors.hard} style={{ marginTop: 1 }} />
                      <Text style={[type.body, { color: colors.text, flex: 1 }]}>
                        <Text style={[type.bodyStrong, { color: e.verified ? colors.like : colors.hard }]}>{e.verified ? 'Passed: ' : 'Problem: '}</Text>
                        {text}
                      </Text>
                    </View>
                  );
                })}
              </Collapsible>
            </>
          );
        }}
      </ResultGate>
    </Screen>
  );
}
