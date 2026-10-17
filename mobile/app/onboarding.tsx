// Placeholder — the onboarding agent replaces this screen.
import { Link } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, space, type } from '@/lib/theme';

export default function Onboarding() {
  return (
    <SafeAreaView style={{ flex: 1, padding: space.lg, gap: space.lg, backgroundColor: colors.bg }}>
      <Text accessibilityRole="header" style={[type.title, { color: colors.text }]}>Onboarding</Text>
      <Link href="/matches" style={[type.button, { color: colors.text, minHeight: 56 }]}>Go to matches</Link>
    </SafeAreaView>
  );
}
