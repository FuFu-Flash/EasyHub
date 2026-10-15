import { useTranslation } from '@/features/localization/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
import { usePageFeedback } from '@/features/workspace/usePageFeedback';

export default function Settings() {
  const { user, signOut, ready } = useSession();
  const { capture } = usePageFeedback();
  const { language, setLanguage, translationEnabled, setTranslationEnabled, translationNames, setTranslationNames } = usePreferences();
  const t = useTranslation();
  const [names, setNames] = useState(translationNames.join('\n'));
  const scroll = useRef<ScrollView>(null);
  const programTop = useRef<number | null>(null);
  const programRequested = useRef(false);
  const showProgramReview = useCallback(() => {
    programRequested.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (programTop.current !== null && scroll.current) {
        scroll.current.scrollTo({ y: Math.max(0, programTop.current - 12), animated: false });
        programRequested.current = false;
      }
    }));
  }, []);
  useEffect(() => { queueMicrotask(() => setNames(translationNames.join('\n'))); }, [translationNames]);
  if (!ready) return <Loading />;
  return <Page scrollRef={scroll}><Heading title={t("settings.settings")} subtitle={t("settings.manageEasyHubOnThisDevice")} />
    <Card>{user ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Image source={{ uri: user.avatar_url }} style={{ flexShrink: 0, width: 52, height: 52, borderRadius: 26 }} /><View style={{ flex: 1, minWidth: 0 }}><Text style={{ fontWeight: '800', fontSize: 17, color: palette.ink }}>{user.name || user.login}</Text><Text style={{ color: palette.muted }}>@{user.login}</Text></View></View> : <Text style={{ color: palette.muted }}>{t("settings.notSignedInToGitHub")}</Text>}</Card>
    {user ? <Action title={t("settings.signOut")} secondary onPress={() => Alert.alert(t("settings.signOutb5275f36"), t("settings.yourSavedSignInDetailsWillBeRemovedFromThisDevice"), [{ text: t("AiReviewSettings.cancel") }, { text: t("settings.signOuta65c6d66"), style: 'destructive', onPress: () => { void signOut(); } }])} /> : <Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} />}
    <View style={{ marginTop: 25 }}><Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t("settings.appLanguage")}</Text><Text style={{ color: palette.muted, marginTop: 6, marginBottom: 14 }}>{t("settings.chooseTheLanguageUsedByEasyHub")}</Text>
      {([{ id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }] as const).map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: language === option.id }} onPress={() => setLanguage(option.id)} style={{ paddingVertical: 14, paddingHorizontal: 15, marginBottom: 9, borderRadius: 12, borderWidth: 1, borderColor: language === option.id ? '#a8cbff' : palette.border, backgroundColor: language === option.id ? '#e7f0ff' : '#fff', flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: language === option.id ? palette.blue : palette.ink, fontWeight: '700' }}>{option.label}</Text><Text style={{ color: palette.blue }}>{language === option.id ? '✓' : ''}</Text></Pressable>)}
    </Card></View>
    <Card><Pressable accessibilityRole="switch" accessibilityState={{ checked: translationEnabled }} onPress={() => setTranslationEnabled(!translationEnabled)} style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}><View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t("common.contentTranslation")}</Text><Text style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>{t("settings.translatePublicProjectDescriptionsIntroductionsIssuesCommentsAndReleaseNotesTurn")}</Text></View><View style={{ width: 48, height: 28, borderRadius: 15, backgroundColor: translationEnabled ? palette.blue : '#c9d4e4', justifyContent: 'center', paddingHorizontal: 3, alignItems: translationEnabled ? 'flex-end' : 'flex-start' }}><View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' }} /></View></Pressable>
      <Text style={{ color: palette.ink, fontWeight: '700', marginTop: 18 }}>{t("settings.namesToKeepUnchanged")}</Text><Text style={{ color: palette.muted, lineHeight: 20, marginTop: 5 }}>{t("settings.addOneNamePerLineSuchAsProductOrAuthorNames")}</Text>
      <TextInput accessibilityLabel={t("settings.namesToKeepUnchanged")} value={names} onChangeText={setNames} multiline placeholder={'EasyHub\nOpenAI'} autoCapitalize="none" autoCorrect={false} style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 10, minHeight: 80, padding: 12, marginTop: 10, textAlignVertical: 'top' }} />
      <View style={{ marginTop: 10 }}><Action title={t("settings.saveNames")} secondary onPress={() => { setTranslationNames(names.split(/[\n,，]/u)); Alert.alert(t("home.saved")); }} /></View>
    </Card>
    <AiReviewSettings />
    <View onLayout={(event) => {
      programTop.current = event.nativeEvent.layout.y;
      if (programRequested.current) showProgramReview();
    }}><BinaryAnalysisSettings onOpenComponents={showProgramReview} /></View>
    <Pressable accessibilityRole="link" style={{ minHeight: 48 }} onPress={() => { const current = capture(); void Linking.openURL('https://github.com/FuFu-Flash/EasyHub').catch(() => { if (current()) Alert.alert(t("settings.couldNotOpenTheLink"), t("settings.checkYourBrowserSettingsAndTryAgain")); }); }}><Card><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t("settings.easyhubProject")}</Text><Text style={{ color: palette.muted, marginTop: 6 }}>github.com/FuFu-Flash/EasyHub</Text></View><MaterialArrow name="external" color={palette.blue} /></View></Card></Pressable>
    <View style={{ marginTop: 8 }}><AppUpdatePanel /></View>
  </Page>;
}
