// Placeholder — a screen agent replaces this.
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, space, type } from '@/lib/theme';

export default function Screen() {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, padding: space.lg, backgroundColor: colors.bg }}>
      <Text accessibilityRole="header" style={[type.title, { color: colors.text }]}>My week</Text>
    </SafeAreaView>
  );
}
