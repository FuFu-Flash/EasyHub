import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { invalidateOpenIssues } from '@/features/github/openIssues';
import { Action, BackLink, Heading, Page, palette } from '@/components/elements';

export default function NewIssue() {
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  const { client } = useSession();
  const { t } = usePreferences();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!client) { router.push('/login'); return; }
    if (!title.trim()) { Alert.alert(t('请填写问题标题', 'Enter an issue title')); return; }
    setBusy(true);
    try {
      const issue = await client.createIssue(owner, repo, title.trim(), body.trim());
      invalidateOpenIssues(client);
      router.replace({ pathname: '/project/[owner]/[repo]/issue/[number]', params: { owner, repo, number: String(issue.number) } });
    } catch { Alert.alert(t('提交失败', 'Could not submit'), t('请检查是否允许提出问题，或稍后重试。', 'Check whether this project accepts issues, then try again.')); }
    finally { setBusy(false); }
  };
  return <Page>
    <BackLink title={t('返回', 'Back')} marginBottom={25} />
    <Heading title={t('提出问题', 'New issue')} subtitle={`${owner}/${repo}`} />
    <Text style={{ color: palette.ink, fontWeight: '700', marginBottom: 8 }}>{t('问题标题', 'Issue title')}</Text>
    <TextInput value={title} onChangeText={setTitle} placeholder={t('简要说明遇到了什么', 'Briefly describe what happened')} style={{ padding: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: palette.border, borderRadius: 12, marginBottom: 18 }} />
    <Text style={{ color: palette.ink, fontWeight: '700', marginBottom: 8 }}>{t('详细说明', 'Details')}</Text>
    <TextInput value={body} onChangeText={setBody} multiline placeholder={t('添加复现步骤、期望效果或其他信息…', 'Add steps to reproduce, expected behavior, or other details…')} style={{ padding: 14, minHeight: 170, textAlignVertical: 'top', backgroundColor: '#fff', borderWidth: 1, borderColor: palette.border, borderRadius: 12, marginBottom: 20 }} />
    <View><Action title={busy ? t('正在提交…', 'Submitting…') : t('提交问题', 'Submit issue')} disabled={busy} onPress={() => { void submit(); }} /></View>
  </Page>;
}
