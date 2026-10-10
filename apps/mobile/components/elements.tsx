import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { GitHubRepo } from '@easyhub/github';
import { usePreferences } from '@/features/preferences/provider';
import { MaterialArrow, type MaterialArrowName } from './MaterialArrow';

export const palette = { ink: '#18263e', muted: '#77869d', blue: '#2477ed', border: '#e3eaf4', green: '#1da86a', background: '#f5f8fd' };

export function DirectionLabel({ title, name = 'forward', color = palette.blue, textStyle, size = 24 }: { title: string; name?: MaterialArrowName; color?: string; textStyle?: StyleProp<TextStyle>; size?: number }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%' }}>
    <Text style={[{ color, fontSize: 14, flexShrink: 1, minWidth: 0 }, textStyle]}>{title}</Text>
    <MaterialArrow name={name} color={color} size={size} />
  </View>;
}

export function BackLink({ title, onPress = () => router.back(), marginBottom = 22 }: { title: string; onPress?: () => void; marginBottom?: number }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={{ alignSelf: 'flex-start', maxWidth: '100%', minWidth: 48, minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom }}>
    <MaterialArrow name="back" color={palette.blue} />
    <Text style={{ color: palette.blue, fontSize: 14, lineHeight: 20, flexShrink: 1, minWidth: 0 }}>{title}</Text>
  </Pressable>;
}

export function Page({ children, refresh, refreshing = false }: { children: ReactNode; refresh?: () => void; refreshing?: boolean }) {
  // The parent refresh control owns vertical pulls, including content shorter than the viewport.
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: palette.background }}><KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}><ScrollView nestedScrollEnabled={false} keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, padding: 22, paddingBottom: 48 }} refreshControl={refresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[palette.blue]} tintColor={palette.blue} /> : undefined}>{children}</ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ padding: 18, borderRadius: 20, borderWidth: 1, borderColor: palette.border, backgroundColor: '#fff', marginBottom: 12 }, style]}>{children}</View>;
}

export function Action({ title, onPress, secondary, disabled }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled} style={{ minWidth: 0, maxWidth: '100%', flexShrink: 1, backgroundColor: secondary ? '#fff' : disabled ? '#9dc2f6' : palette.blue, borderColor: secondary ? palette.border : 'transparent', borderWidth: 1, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}><Text style={{ minWidth: 0, maxWidth: '100%', flexShrink: 1, textAlign: 'center', color: secondary ? palette.ink : '#fff', fontWeight: '700', fontSize: 15 }}>{title}</Text></Pressable>;
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
  return <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name } })}>
    <Card><View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
      <View style={{ flexShrink: 0, width: 48, height: 48, borderRadius: 13, backgroundColor: '#eaf3ff', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.blue, fontWeight: '800', fontSize: 22 }}>{repo.name[0]?.toUpperCase()}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{repo.name}</Text><Text numberOfLines={2} style={{ color: palette.muted, marginTop: 3 }}>{repo.description || t('这个项目还没有介绍', 'No description yet')}</Text></View>
      <MaterialArrow name="chevron" color={palette.muted} />
    </View><Text style={{ color: palette.green, marginTop: 12 }}>● {t('已保存到 GitHub', 'Saved to GitHub')} · {repo.private ? t('只有我', 'Only me') : t('所有人可见', 'Public')}</Text></Card>
  </Pressable>;
}
