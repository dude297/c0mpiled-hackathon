import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;
const icon =
  (on: IconName, off: IconName) =>
  ({ focused, color }: { focused: boolean; color: ColorValue }) => <Ionicons name={focused ? on : off} size={30} color={color as string} />;

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarActiveBackgroundColor: colors.tile,
        tabBarLabelStyle: { fontSize: 18, fontWeight: '600' },
        tabBarStyle: {
          height: 76 + insets.bottom,
          paddingTop: 6,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarItemStyle: { minHeight: 64, borderRadius: 12, marginHorizontal: 4 },
      }}>
      <Tabs.Screen name="matches" options={{ title: 'Matches', tabBarAccessibilityLabel: 'Matches', tabBarIcon: icon('heart', 'heart-outline') }} />
      <Tabs.Screen name="week" options={{ title: 'My week', tabBarAccessibilityLabel: 'My week', tabBarIcon: icon('calendar', 'calendar-outline') }} />
      <Tabs.Screen
        name="details"
        options={{ title: 'Details', tabBarAccessibilityLabel: 'Details', tabBarIcon: icon('information-circle', 'information-circle-outline') }}
      />
    </Tabs>
  );
}
