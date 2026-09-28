import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { GitHubRepo } from '@easyhub/github';
import { usePreferences } from '@/features/preferences/provider';

export const palette = { ink: '#18263e', muted: '#77869d', blue: '#2477ed', border: '#e3eaf4', green: '#1da86a', background: '#f5f8fd' };

export function Page({ children, refresh }: { children: ReactNode; refresh?: () => void }) {
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: palette.background }}><ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 22, paddingBottom: 48 }} refreshControl={refresh ? <RefreshControl refreshing={false} onRefresh={refresh} /> : undefined}>{children}</ScrollView></SafeAreaView>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ padding: 18, borderRadius: 20, borderWidth: 1, borderColor: palette.border, backgroundColor: '#fff', marginBottom: 12 }, style]}>{children}</View>;
}

export function Action({ title, onPress, secondary, disabled }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={{ backgroundColor: secondary ? '#fff' : disabled ? '#9dc2f6' : palette.blue, borderColor: secondary ? palette.border : 'transparent', borderWidth: 1, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: secondary ? palette.ink : '#fff', fontWeight: '700', fontSize: 15 }}>{title}</Text></Pressable>;
}

export function Loading() { return <View style={{ paddingVertical: 24 }}><ActivityIndicator color={palette.blue} /></View>; }
export function ErrorText({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = usePreferences();
  return <Card><Text style={{ color: '#bf3947', marginBottom: onRetry ? 12 : 0 }}>{message}</Text>{onRetry && <Action title={t('重试', 'Retry')} onPress={onRetry} secondary />}</Card>;
}
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View style={{ marginBottom: 22 }}><Text style={{ fontSize: 28, fontWeight: '800', color: palette.ink }}>{title}</Text>{subtitle && <Text style={{ color: palette.muted, marginTop: 7, lineHeight: 21 }}>{subtitle}</Text>}</View>;
}

export function RepositoryRow({ repo }: { repo: GitHubRepo }) {
  const { t } = usePreferences();
  return <Pressable onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name } })}>
    <Card><View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
      <View style={{ width: 48, height: 48, borderRadius: 13, backgroundColor: '#eaf3ff', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.blue, fontWeight: '800', fontSize: 22 }}>{repo.name[0]?.toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{repo.name}</Text><Text numberOfLines={2} style={{ color: palette.muted, marginTop: 3 }}>{repo.description || t('这个项目还没有介绍', 'No description yet')}</Text></View>
      <Text style={{ color: palette.muted, fontSize: 20 }}>›</Text>
    </View><Text style={{ color: palette.green, marginTop: 12 }}>● {t('已保存到 GitHub', 'Saved to GitHub')} · {repo.private ? t('只有我', 'Only me') : t('所有人可见', 'Public')}</Text></Card>
  </Pressable>;
}
