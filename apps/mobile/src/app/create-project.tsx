import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import type { Visibility } from '@easyhub/types';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, BackLink, Card, Heading, Page, palette } from '@/components/elements';
import { EarthIcon } from '@/components/EarthIcon';

function VisibilityChoice({ value, selected, onPress, title, description }: { value: Visibility; selected: boolean; onPress: () => void; title: string; description: string }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={{ flex: 1, minWidth: 0, padding: 15, borderWidth: 1, borderColor: selected ? '#a8cbff' : palette.border, backgroundColor: selected ? '#f0f6ff' : '#fff', borderRadius: 14 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>{value === 'private' ? <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={selected ? palette.blue : palette.muted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 10h14v11H5z" /><Path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg> : <EarthIcon size={22} color={selected ? palette.blue : palette.muted} />}<Text style={{ color: palette.blue, fontWeight: '800' }}>{selected ? '✓' : ''}</Text></View>
    <Text style={{ color: palette.ink, fontWeight: '800', marginTop: 11 }}>{title}</Text>
    <Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>{description}</Text>
  </Pressable>;
}

export default function CreateProject() {
  const { client } = useSession();
  const { t } = usePreferences();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    if (!client) { router.push('/login'); return; }
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name.trim())) { setError(t('项目名称只能使用英文字母、数字、点、横线和下划线。', 'Project names can only use letters, numbers, dots, hyphens and underscores.')); return; }
    setBusy(true); setError('');
    try {
      const repo = await client.createRepo(name.trim(), description.trim(), visibility === 'private');
      Alert.alert(t('项目创建成功', 'Project created'), t('现在可以查看和分享这个项目。', 'You can now view and share this project.'));
      router.replace({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name } });
    } catch { setError(t('创建失败。请检查项目名称是否重复，或稍后重试。', 'Could not create the project. Check whether the name is already in use, then try again.')); }
    finally { setBusy(false); }
  };
  return <Page><BackLink title={t('返回', 'Back')} marginBottom={25} /><Heading title={t('新建项目', 'New project')} subtitle={t('给新想法起个名字，随时分享你的作品。', 'Give your new idea a name and share your work anytime.')} />
    <Card>
      <Text style={{ fontWeight: '800', color: palette.ink, marginBottom: 8 }}>{t('项目名称', 'Project name')} <Text style={{ color: '#d66c7e' }}>*</Text></Text>
      <TextInput accessibilityLabel={t('项目名称', 'Project name')} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} placeholder={t('例如 MyTool', 'For example, MyTool')} maxLength={100} style={{ backgroundColor: '#fff', color: palette.ink, borderWidth: 1, borderColor: palette.border, padding: 15, borderRadius: 12, marginBottom: 18 }} />
      <Text style={{ fontWeight: '800', color: palette.ink, marginBottom: 8 }}>{t('一句介绍', 'Short description')}</Text>
      <TextInput accessibilityLabel={t('一句介绍', 'Short description')} value={description} onChangeText={setDescription} placeholder={t('这个项目是做什么的？', 'What is this project about?')} maxLength={350} style={{ backgroundColor: '#fff', color: palette.ink, borderWidth: 1, borderColor: palette.border, padding: 15, borderRadius: 12, marginBottom: 20 }} />
      <Text style={{ fontWeight: '800', color: palette.ink, marginBottom: 11 }}>{t('谁能看到？', 'Who can see this?')}</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}><VisibilityChoice value="private" selected={visibility === 'private'} onPress={() => setVisibility('private')} title={t('只有我', 'Only me')} description={t('仅自己可见', 'Visible only to you')} /><VisibilityChoice value="public" selected={visibility === 'public'} onPress={() => setVisibility('public')} title={t('所有人', 'Everyone')} description={t('可以分享给别人', 'Anyone can view it')} /></View>
      {!!error && <Text style={{ color: '#bf3947', marginBottom: 12 }}>{error}</Text>}
      <Action title={busy ? t('正在创建…', 'Creating…') : t('创建项目', 'Create project')} disabled={busy || !name.trim()} onPress={() => { void create(); }} />
    </Card>
  </Page>;
}
