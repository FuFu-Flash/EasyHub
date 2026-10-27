import { useTranslation } from '@/features/localization/react';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/features/auth/session';

import { invalidateOpenIssues } from '@/features/github/openIssues';
import { Action, BackLink, Heading, Page, palette } from '@/components/elements';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';
import { themed } from '@/features/theme/theme';

export default function NewIssue() {
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  const { client } = useSession();
  const t = useTranslation();
  const { capture } = usePageFeedback();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!client) { router.push('/login'); return; }
    if (!title.trim()) { Alert.alert(t("newissue.enterAnIssueTitle")); return; }
    setBusy(true);
    const current = capture();
    try {
      const issue = await client.createIssue(owner, repo, title.trim(), body.trim());
      invalidateOpenIssues(client);
      if (!current()) return;
      router.replace({ pathname: '/project/[owner]/[repo]/issue/[number]', params: { owner, repo, number: String(issue.number) } });
    } catch { if (current()) Alert.alert(t("newissue.couldNotSubmit"), t("newissue.checkWhetherThisProjectAcceptsIssuesThenTryAgain")); }
    finally { setBusy(false); }
  };
  return <Page>
    <BackLink title={t("analysis.back")} heading={t("newissue.newIssue")} marginBottom={22} />
    <Heading subtitle={`${owner}/${repo}`} />
    <Text style={{ color: palette.ink, fontWeight: '700', marginBottom: 8 }}>{t("newissue.issueTitle")}</Text>
    <TextInput placeholderTextColor={palette.muted} value={title} onChangeText={setTitle} placeholder={t("newissue.brieflyDescribeWhatHappened")} style={{ color: palette.ink, padding: 14, backgroundColor: themed('#fff'), borderWidth: 1, borderColor: palette.border, borderRadius: 12, marginBottom: 18 }} />
    <Text style={{ color: palette.ink, fontWeight: '700', marginBottom: 8 }}>{t("newissue.details")}</Text>
    <TextInput placeholderTextColor={palette.muted} value={body} onChangeText={setBody} multiline placeholder={t("newissue.addStepsToReproduceExpectedBehaviorOrOtherDetails")} style={{ color: palette.ink, padding: 14, minHeight: 170, textAlignVertical: 'top', backgroundColor: themed('#fff'), borderWidth: 1, borderColor: palette.border, borderRadius: 12, marginBottom: 20 }} />
    <View><Action title={busy ? t("ForkContributionPanel.submitting") : t("newissue.submitIssue")} disabled={busy} onPress={() => { void submit(); }} /></View>
  </Page>;
}
