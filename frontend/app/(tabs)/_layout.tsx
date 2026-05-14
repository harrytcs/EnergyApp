import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(focused: boolean, name: IconName, focusedName: IconName) {
  return <Ionicons name={focused ? focusedName : name} size={22} color={focused ? colors.solar : colors.textMuted} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bgCard,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 10,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.solar,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'grid-outline', 'grid'),
        }}
      />
      <Tabs.Screen
        name="solar"
        options={{
          title: 'Solar',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'sunny-outline', 'sunny'),
        }}
      />
      <Tabs.Screen
        name="powerwall"
        options={{
          title: 'Powerwall',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'battery-half-outline', 'battery-half'),
        }}
      />
      <Tabs.Screen
        name="car"
        options={{
          title: 'Car',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'car-outline', 'car'),
        }}
      />
      <Tabs.Screen
        name="hvac"
        options={{
          title: 'HVAC',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'thermometer-outline', 'thermometer'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'settings-outline', 'settings'),
        }}
      />
    </Tabs>
  );
}
