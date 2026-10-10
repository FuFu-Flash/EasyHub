import { useEffect, useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, Card, Heading, Loading, Page, palette } from '@/components/elements';
import { AiReviewSettings } from '@/components/AiReviewSettings';
import { BinaryAnalysisSettings } from '@/components/BinaryAnalysisSettings';
import { MaterialArrow } from '@/components/MaterialArrow';
import { AppUpdatePanel } from '@/features/updates/AppUpdatePanel';

export default function Settings() {
  const { user, signOut, ready } = useSession();
  const { language, setLanguage, translationEnabled, setTranslationEnabled, translationNames, setTranslationNames, t } = usePreferences();
  const [names, setNames] = useState(translationNames.join('\n'));
  useEffect(() => { queueMicrotask(() => setNames(translationNames.join('\n'))); }, [translationNames]);
  if (!ready) return <Loading />;
  return <Page><Heading title={t('设置', 'Settings')} subtitle={t('管理这台设备上的 EasyHub。', 'Manage EasyHub on this device.')} />
    <Card>{user ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Image source={{ uri: user.avatar_url }} style={{ flexShrink: 0, width: 52, height: 52, borderRadius: 26 }} /><View style={{ flex: 1, minWidth: 0 }}><Text style={{ fontWeight: '800', fontSize: 17, color: palette.ink }}>{user.name || user.login}</Text><Text style={{ color: palette.muted }}>@{user.login}</Text></View></View> : <Text style={{ color: palette.muted }}>{t('尚未登录 GitHub', 'Not signed in to GitHub')}</Text>}</Card>
    {user ? <Action title={t('退出登录', 'Sign out')} secondary onPress={() => Alert.alert(t('退出登录？', 'Sign out?'), t('这台设备上保存的登录信息会被清除。', 'Your saved sign-in details will be removed from this device.'), [{ text: t('取消', 'Cancel') }, { text: t('退出', 'Sign out'), style: 'destructive', onPress: () => { void signOut(); } }])} /> : <Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} />}
    <View style={{ marginTop: 25 }}><Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('界面语言', 'App language')}</Text><Text style={{ color: palette.muted, marginTop: 6, marginBottom: 14 }}>{t('选择 EasyHub 的显示语言。', 'Choose the language used by EasyHub.')}</Text>
      {([{ id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }] as const).map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: language === option.id }} onPress={() => setLanguage(option.id)} style={{ paddingVertical: 14, paddingHorizontal: 15, marginBottom: 9, borderRadius: 12, borderWidth: 1, borderColor: language === option.id ? '#a8cbff' : palette.border, backgroundColor: language === option.id ? '#e7f0ff' : '#fff', flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: language === option.id ? palette.blue : palette.ink, fontWeight: '700' }}>{option.label}</Text><Text style={{ color: palette.blue }}>{language === option.id ? '✓' : ''}</Text></Pressable>)}
    </Card></View>
    <Card><Pressable accessibilityRole="switch" accessibilityState={{ checked: translationEnabled }} onPress={() => setTranslationEnabled(!translationEnabled)} style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}><View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('内容翻译', 'Content translation')}</Text><Text style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>{t('翻译公开项目的简介、介绍、问题、评论和版本说明；关闭后显示原文。私有项目不会发送给翻译服务。', 'Translate public project descriptions, introductions, issues, comments and release notes; turn off to see originals. Private projects are never sent to translation services.')}</Text></View><View style={{ width: 48, height: 28, borderRadius: 15, backgroundColor: translationEnabled ? palette.blue : '#c9d4e4', justifyContent: 'center', paddingHorizontal: 3, alignItems: translationEnabled ? 'flex-end' : 'flex-start' }}><View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' }} /></View></Pressable>
      <Text style={{ color: palette.ink, fontWeight: '700', marginTop: 18 }}>{t('不翻译的名称', 'Names to keep unchanged')}</Text><Text style={{ color: palette.muted, lineHeight: 20, marginTop: 5 }}>{t('每行填写一个名称，例如产品名或作者名。项目名、文件名、版本号和链接会自动保留。', 'Add one name per line, such as product or author names. Project names, file names, version numbers and links are preserved automatically.')}</Text>
      <TextInput accessibilityLabel={t('不翻译的名称', 'Names to keep unchanged')} value={names} onChangeText={setNames} multiline placeholder={'EasyHub\nOpenAI'} autoCapitalize="none" autoCorrect={false} style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 10, minHeight: 80, padding: 12, marginTop: 10, textAlignVertical: 'top' }} />
      <View style={{ marginTop: 10 }}><Action title={t('保存名称', 'Save names')} secondary onPress={() => { setTranslationNames(names.split(/[\n,，]/u)); Alert.alert(t('已保存', 'Saved')); }} /></View>
    </Card>
    <AiReviewSettings />
    <BinaryAnalysisSettings />
    <Pressable accessibilityRole="link" style={{ minHeight: 48 }} onPress={() => { void Linking.openURL('https://github.com/FuFu-Flash/EasyHub').catch(() => Alert.alert(t('无法打开链接', 'Could not open the link'), t('请检查浏览器设置后重试。', 'Check your browser settings and try again.'))); }}><Card><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t('EasyHub 项目', 'EasyHub project')}</Text><Text style={{ color: palette.muted, marginTop: 6 }}>github.com/FuFu-Flash/EasyHub</Text></View><MaterialArrow name="external" color={palette.blue} /></View></Card></Pressable>
    <View style={{ marginTop: 8 }}><AppUpdatePanel /></View>
  </Page>;
}
