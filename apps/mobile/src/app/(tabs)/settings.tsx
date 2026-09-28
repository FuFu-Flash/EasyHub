import { Image, Pressable, Text, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, Card, Heading, Loading, Page, palette } from '@/components/elements';
import { AiReviewSettings } from '@/components/AiReviewSettings';

export default function Settings() {
  const { user, signOut, ready } = useSession();
  const { language, setLanguage, translationEnabled, setTranslationEnabled, t } = usePreferences();
  if (!ready) return <Loading />;
  return <Page><Heading title={t('设置', 'Settings')} subtitle={t('管理这台设备上的 EasyHub。', 'Manage EasyHub on this device.')} />
    <Card>{user ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Image source={{ uri: user.avatar_url }} style={{ width: 52, height: 52, borderRadius: 26 }} /><View><Text style={{ fontWeight: '800', fontSize: 17, color: palette.ink }}>{user.name || user.login}</Text><Text style={{ color: palette.muted }}>@{user.login}</Text></View></View> : <Text style={{ color: palette.muted }}>{t('尚未登录 GitHub', 'Not signed in to GitHub')}</Text>}</Card>
    {user ? <Action title={t('退出登录', 'Sign out')} secondary onPress={() => Alert.alert(t('退出登录？', 'Sign out?'), t('这台设备上保存的登录信息会被清除。', 'Your saved sign-in details will be removed from this device.'), [{ text: t('取消', 'Cancel') }, { text: t('退出', 'Sign out'), style: 'destructive', onPress: () => { void signOut(); } }])} /> : <Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} />}
    <View style={{ marginTop: 25 }}><Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('界面语言', 'App language')}</Text><Text style={{ color: palette.muted, marginTop: 6, marginBottom: 14 }}>{t('选择 EasyHub 的显示语言。', 'Choose the language used by EasyHub.')}</Text>
      {([{ id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }] as const).map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: language === option.id }} onPress={() => setLanguage(option.id)} style={{ paddingVertical: 14, paddingHorizontal: 15, marginBottom: 9, borderRadius: 12, borderWidth: 1, borderColor: language === option.id ? '#a8cbff' : palette.border, backgroundColor: language === option.id ? '#e7f0ff' : '#fff', flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: language === option.id ? palette.blue : palette.ink, fontWeight: '700' }}>{option.label}</Text><Text style={{ color: palette.blue }}>{language === option.id ? '✓' : ''}</Text></Pressable>)}
    </Card></View>
    <Card><Pressable accessibilityRole="switch" accessibilityState={{ checked: translationEnabled }} onPress={() => setTranslationEnabled(!translationEnabled)} style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}><View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('内容翻译', 'Content translation')}</Text><Text style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>{t('翻译公开项目的简介和问题标题；关闭后显示原文。', 'Translate public project descriptions and issue titles; turn off to see originals.')}</Text></View><View style={{ width: 48, height: 28, borderRadius: 15, backgroundColor: translationEnabled ? palette.blue : '#c9d4e4', justifyContent: 'center', paddingHorizontal: 3, alignItems: translationEnabled ? 'flex-end' : 'flex-start' }}><View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' }} /></View></Pressable></Card>
    <AiReviewSettings />
    <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://github.com/FuFu-Flash/EasyHub').catch(() => Alert.alert(t('无法打开链接', 'Could not open the link'), t('请检查浏览器设置后重试。', 'Check your browser settings and try again.'))); }}><Card><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><View><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t('EasyHub 项目', 'EasyHub project')}</Text><Text style={{ color: palette.muted, marginTop: 6 }}>github.com/FuFu-Flash/EasyHub</Text></View><Text style={{ color: palette.blue, fontSize: 21 }}>↗</Text></View></Card></Pressable>
    <View style={{ marginTop: 8 }}><Card><Text style={{ color: palette.ink, fontWeight: '800' }}>EasyHub 1.0.0</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{t('依据 GPLv3 发布', 'Released under GPLv3')}</Text></Card></View>
  </Page>;
}
