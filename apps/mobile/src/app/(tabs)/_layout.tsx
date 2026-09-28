import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '@/features/preferences/provider';

type TabName = 'index' | 'projects' | 'discover' | 'issues' | 'settings';

const labels: Record<TabName, [string, string]> = {
  index: ['首页', 'Home'],
  projects: ['项目', 'Projects'],
  discover: ['发现', 'Discover'],
  issues: ['问题', 'Issues'],
  settings: ['设置', 'Settings'],
};

function TabIcon({ name, color }: { name: TabName; color: string }) {
  return <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    {name === 'index' && <>
      <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <Path d="M9 22V12h6v10" />
    </>}
    {name === 'projects' && <Path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L8.6 3.9A2 2 0 0 0 6.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />}
    {name === 'discover' && <><Circle cx="12" cy="12" r="9" /><Path d="m15.7 8.3-2.4 5-5 2.4 2.4-5z" /></>}
    {name === 'issues' && <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />}
    {name === 'settings' && <>
      <Path d="M20 7h-9M14 17H5" />
      <Circle cx="7" cy="7" r="3" />
      <Circle cx="17" cy="17" r="3" />
    </>}
  </Svg>;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { t } = usePreferences();

  return <Tabs
    screenOptions={{ headerShown: false }}
    tabBar={({ state, navigation }) => <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const name = route.name as TabName;
        const selected = state.index === index;
        const color = selected ? '#166ee7' : '#52637c';
        return <Pressable
          key={route.key}
          accessibilityRole="tab"
          accessibilityLabel={t(...labels[name])}
          accessibilityState={{ selected }}
          onPress={() => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!selected && !event.defaultPrevented) navigation.navigate(route.name);
          }}
          onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          style={[styles.tab, selected && styles.selectedTab]}
        >
          <TabIcon name={name} color={color} />
        </Pressable>;
      })}
    </View>}
  >
    <Tabs.Screen name="index" options={{ title: t(...labels.index) }} />
    <Tabs.Screen name="projects" options={{ title: t(...labels.projects) }} />
    <Tabs.Screen name="discover" options={{ title: t(...labels.discover) }} />
    <Tabs.Screen name="issues" options={{ title: t(...labels.issues) }} />
    <Tabs.Screen name="settings" options={{ title: t(...labels.settings) }} />
  </Tabs>;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: '#e1e9f4',
    backgroundColor: '#fff',
  },
  tab: {
    flex: 1,
    minWidth: 0,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedTab: { backgroundColor: '#e7f0ff' },
});
