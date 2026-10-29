import { useTranslation } from '@/features/localization/react';
import type { ReactNode, Ref } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { GitHubRepo } from '@easyhub/github';

import { SessionConnectionNotice } from './SessionConnectionNotice';
import { MaterialArrow, type MaterialArrowName } from './MaterialArrow';

import { palette, themed, onAccent } from '@/features/theme/theme';

export { palette };

export function DirectionLabel({ title, name = 'forward', color = palette.blue, textStyle, size = 24 }: { title: string; name?: MaterialArrowName; color?: string; textStyle?: StyleProp<TextStyle>; size?: number }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%' }}>
    <Text style={[{ color, fontSize: 14, flexShrink: 1, minWidth: 0 }, textStyle]}>{title}</Text>
    <MaterialArrow name={name} color={color} size={size} />
  </View>;
}

/** Android-style back control: the chevron, optionally followed by the page title on the same line like a top app bar. */
export function BackLink({ title, heading, onPress = () => router.back(), marginBottom = 22 }: { title: string; heading?: string; onPress?: () => void; marginBottom?: number }) {
  const gap = Math.max(0, marginBottom - 20);
  const arrow = <View style={{ transform: [{ scaleX: -1 }] }}><MaterialArrow name="chevron" color={palette.ink} size={32} /></View>;
  if (heading) return <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -12, marginTop: -10, marginBottom: gap + 6 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} hitSlop={8} onPress={onPress} style={{ width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }}>{arrow}</Pressable>
    <Text accessibilityRole="header" numberOfLines={2} style={{ flex: 1, minWidth: 0, color: palette.ink, fontSize: 22, lineHeight: 28, fontWeight: '800' }}>{heading}</Text>
  </View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} hitSlop={8} onPress={onPress} style={{ alignSelf: 'flex-start', width: 48, height: 48, marginLeft: -12, marginTop: -10, justifyContent: 'center', alignItems: 'center', marginBottom: gap }}>{arrow}</Pressable>;
}

export function Page({ children, refresh, refreshing = false, scrollRef }: { children: ReactNode; refresh?: () => void; refreshing?: boolean; scrollRef?: Ref<ScrollView> }) {
  // The parent refresh control owns vertical pulls, including content shorter than the viewport.
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: palette.background }}><KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}><ScrollView ref={scrollRef} nestedScrollEnabled={false} keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, padding: 22, paddingBottom: 48 }} refreshControl={refresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[palette.blue]} tintColor={palette.blue} /> : undefined}><SessionConnectionNotice />{children}</ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ padding: 18, borderRadius: 20, borderWidth: 1, borderColor: palette.border, backgroundColor: themed('#fff'), marginBottom: 12 }, style]}>{children}</View>;
}

export function Action({ title, onPress, secondary, disabled }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled} style={{ minWidth: 0, maxWidth: '100%', flexShrink: 1, backgroundColor: secondary ? themed('#fff') : disabled ? themed('#9dc2f6') : palette.blue, borderColor: secondary ? palette.border : 'transparent', borderWidth: 1, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}><Text style={{ minWidth: 0, maxWidth: '100%', flexShrink: 1, textAlign: 'center', color: secondary ? palette.ink : onAccent, fontWeight: '700', fontSize: 15 }}>{title}</Text></Pressable>;
}

export function Loading() { return <View style={{ paddingVertical: 24 }}><ActivityIndicator color={palette.blue} /></View>; }
export function ErrorText({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTranslation();
  return <Card><Text style={{ color: themed('#bf3947'), marginBottom: onRetry ? 12 : 0 }}>{message}</Text>{onRetry && <Action title={t("DiscussionSearch.retry")} onPress={onRetry} secondary />}</Card>;
}
/** Small capsule filters for switching the state of a list (open/closed); the selected one is soft blue, not a call to action. */
export function FilterPills({ options, marginBottom = 14 }: { options: { label: string; selected: boolean; onPress: () => void }[]; marginBottom?: number }) {
  return <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom }}>
    {options.map((option) => <Pressable key={option.label} onPress={option.onPress} accessibilityRole="radio" accessibilityState={{ checked: option.selected }} style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: option.selected ? themed('#a8cbff') : palette.border, backgroundColor: option.selected ? themed('#e7f0ff') : 'transparent', justifyContent: 'center' }}><Text style={{ color: option.selected ? palette.blue : palette.muted, fontWeight: '700' }}>{option.label}</Text></Pressable>)}
  </View>;
}

export function Heading({ title, subtitle, compact }: { title?: string; subtitle?: string; compact?: boolean }) {
  return <View style={{ marginBottom: title ? (compact ? 16 : 22) : 16 }}>
    {!!title && <Text accessibilityRole="header" style={{ fontSize: compact ? 22 : 28, lineHeight: compact ? 29 : undefined, fontWeight: '800', color: palette.ink }}>{title}</Text>}
    {!!subtitle && <Text style={{ color: palette.muted, marginTop: title ? 7 : 0, lineHeight: 21 }}>{subtitle}</Text>}
  </View>;
}

export function RepositoryRow({ repo }: { repo: GitHubRepo }) {
  const t = useTranslation();
  return <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name } })}>
    <Card><View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
      <View style={{ flexShrink: 0, width: 48, height: 48, borderRadius: 13, backgroundColor: themed('#eaf3ff'), alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.blue, fontWeight: '800', fontSize: 22 }}>{repo.name[0]?.toUpperCase()}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{repo.name}</Text><Text numberOfLines={2} style={{ color: palette.muted, marginTop: 3 }}>{repo.description || t("elements.noDescriptionYet")}</Text></View>
      <MaterialArrow name="chevron" color={palette.muted} />
    </View><Text style={{ color: palette.green, marginTop: 12 }}>● {repo.private ? t("elements.visibilityPrivate") : t("elements.visibilityPublic")}</Text></Card>
  </Pressable>;
}
