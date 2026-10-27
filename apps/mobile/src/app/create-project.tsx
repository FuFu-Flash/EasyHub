import { useTranslation } from '@/features/localization/react';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import type { Visibility } from '@easyhub/types';
import { useSession } from '@/features/auth/session';

import { Action, BackLink, Card, Heading, Page, palette } from '@/components/elements';
import { EarthIcon } from '@/components/EarthIcon';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';
import { themed } from '@/features/theme/theme';

function VisibilityChoice({ value, selected, onPress, title, description }: { value: Visibility; selected: boolean; onPress: () => void; title: string; description: string }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={{ flex: 1, minWidth: 0, padding: 15, borderWidth: 1, borderColor: selected ? themed('#a8cbff') : palette.border, backgroundColor: selected ? themed('#f0f6ff') : themed('#fff'), borderRadius: 14 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>{value === 'private' ? <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={selected ? palette.blue : palette.muted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 10h14v11H5z" /><Path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg> : <EarthIcon size={22} color={selected ? palette.blue : palette.muted} />}<Text style={{ color: palette.blue, fontWeight: '800' }}>{selected ? '✓' : ''}</Text></View>
    <Text style={{ color: palette.ink, fontWeight: '800', marginTop: 11 }}>{title}</Text>
    <Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>{description}</Text>
  </Pressable>;
}

export default function CreateProject() {
  const { client } = useSession();
  const t = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [busy, setBusy] = useState(false);
  const { value: error, set: setError, capture } = usePageFeedback();
  const create = async () => {
    if (!client) { router.push('/login'); return; }
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name.trim())) { setError(t("createproject.projectNamesCanOnlyUseLettersNumbersDotsHyphensAndUnderscores")); return; }
    setBusy(true); setError('');
    const current = capture();
    try {
      const repo = await client.createRepo(name.trim(), description.trim(), visibility === 'private');
      if (!current()) return;
      Alert.alert(t("createproject.projectCreated"), t("createproject.youCanNowViewAndShareThisProject"));
      router.replace({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name } });
    } catch { if (current()) setError(t("createproject.couldNotCreateTheProjectCheckWhetherTheNameIsAlready")); }
    finally { setBusy(false); }
  };
  return <Page><BackLink title={t("analysis.back")} heading={t("home.newProject")} marginBottom={22} /><Heading subtitle={t("createproject.giveYourNewIdeaANameAndShareYourWorkAnytime")} />
    <Card>
      <Text style={{ fontWeight: '800', color: palette.ink, marginBottom: 8 }}>{t("createproject.projectName")} <Text style={{ color: themed('#d66c7e') }}>*</Text></Text>
      <TextInput placeholderTextColor={palette.muted} accessibilityLabel={t("createproject.projectName")} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} placeholder={t("createproject.forExampleMyTool")} maxLength={100} style={{ backgroundColor: themed('#fff'), color: palette.ink, borderWidth: 1, borderColor: palette.border, padding: 15, borderRadius: 12, marginBottom: 18 }} />
      <Text style={{ fontWeight: '800', color: palette.ink, marginBottom: 8 }}>{t("createproject.shortDescription")}</Text>
      <TextInput placeholderTextColor={palette.muted} accessibilityLabel={t("createproject.shortDescription")} value={description} onChangeText={setDescription} placeholder={t("createproject.whatIsThisProjectAbout")} maxLength={350} style={{ backgroundColor: themed('#fff'), color: palette.ink, borderWidth: 1, borderColor: palette.border, padding: 15, borderRadius: 12, marginBottom: 20 }} />
      <Text style={{ fontWeight: '800', color: palette.ink, marginBottom: 11 }}>{t("createproject.whoCanSeeThis")}</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}><VisibilityChoice value="private" selected={visibility === 'private'} onPress={() => setVisibility('private')} title={t("elements.onlyMe")} description={t("createproject.visibleOnlyToYou")} /><VisibilityChoice value="public" selected={visibility === 'public'} onPress={() => setVisibility('public')} title={t("createproject.everyone")} description={t("createproject.anyoneCanViewIt")} /></View>
      {!!error && <Text style={{ color: themed('#bf3947'), marginBottom: 12 }}>{error}</Text>}
      <Action title={busy ? t("createproject.creating") : t("createproject.createProject")} disabled={busy || !name.trim()} onPress={() => { void create(); }} />
    </Card>
  </Page>;
}
