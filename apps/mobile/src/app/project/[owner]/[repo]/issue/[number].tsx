import { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import type { GitHubComment, GitHubIssue } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { useTranslatedBrief } from '@/features/translation/useTranslatedBrief';
import { invalidateOpenIssues } from '@/features/github/openIssues';
import { Action, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

export default function IssueDetail() {
  const { owner, repo, number, mode } = useLocalSearchParams<{ owner: string; repo: string; number: string; mode?: string }>();
  const { client, user, ready } = useSession();
  const { t } = usePreferences();
  const [issue, setIssue] = useState<GitHubIssue | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const translatedTitle = useTranslatedBrief(mode === 'public' ? issue?.title || '' : '', [owner, repo]);
  const issueNumber = Number(number);
  const refresh = useCallback(() => {
    if (!client || !Number.isInteger(issueNumber)) return;
    let active = true;
    setLoading(true);
    Promise.all([client.issue(owner, repo, issueNumber), client.comments(owner, repo, issueNumber)])
      .then(([item, replies]) => { if (active) { setIssue(item); setComments(replies); setError(''); } })
      .catch(() => { if (active) setError(t('问题加载失败，请重试。', 'Could not load this issue. Please try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, owner, repo, issueNumber, t]);
  useFocusEffect(refresh);
  const send = async () => {
    if (!client || !reply.trim()) return;
    setBusy(true);
    try { await client.createComment(owner, repo, issueNumber, reply.trim()); setReply(''); refresh(); }
    catch { Alert.alert(t('发送失败', 'Could not send'), t('请稍后重试。', 'Please try again later.')); }
    finally { setBusy(false); }
  };
  const changeState = async () => {
    if (!client || !issue) return;
    setBusy(true);
    try { await client.updateIssue(owner, repo, issueNumber, issue.state === 'open' ? 'closed' : 'open'); invalidateOpenIssues(client); refresh(); }
    catch { Alert.alert(t('操作失败', 'Could not update'), t('你可能没有管理此问题的权限。', 'You may not have permission to manage this issue.')); }
    finally { setBusy(false); }
  };
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('请先登录', 'Please sign in')} subtitle={t('登录后查看这个问题。', 'Sign in to view this issue.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh}>
    <Text onPress={() => router.back()} style={{ color: palette.blue, marginBottom: 25 }}>← {t('返回问题', 'Back to issues')}</Text>
    {loading && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {issue && <>
      <Text style={{ color: issue.state === 'open' ? palette.green : palette.muted, fontWeight: '700' }}>{issue.state === 'open' ? t('待处理', 'Open') : t('已解决', 'Resolved')}</Text>
      <Heading title={translatedTitle || issue.title} subtitle={`${issue.user?.login || t('GitHub 用户', 'GitHub user')} · ${new Date(issue.created_at).toLocaleString()}`} />
      {[{ id: issue.id, body: issue.body || '', user: issue.user?.login || t('GitHub 用户', 'GitHub user'), date: issue.created_at }, ...comments.map((item) => ({ id: item.id, body: item.body, user: item.user?.login || t('GitHub 用户', 'GitHub user'), date: item.created_at }))].map((message) => <View key={message.id} style={{ flexDirection: 'row', gap: 9, marginBottom: 13 }}>
        <View style={{ width: 36, height: 36, backgroundColor: '#e4f0ff', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.blue, fontWeight: '800' }}>{message.user[0]?.toUpperCase()}</Text></View>
        <Card style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: palette.ink }}>{message.user} <Text style={{ color: palette.muted, fontWeight: '400' }}>· {new Date(message.date).toLocaleString()}</Text></Text><View style={{ marginTop: 14 }}><Markdown style={{ body: { color: palette.ink, fontSize: 14, lineHeight: 22 }, link: { color: palette.blue } }}>{message.body || t('（没有文字说明）', '(No description)')}</Markdown></View></Card>
      </View>)}
      {user && <Card><Text style={{ fontWeight: '800', color: palette.ink, marginBottom: 11 }}>{t('写一条回复', 'Write a reply')}</Text><TextInput value={reply} onChangeText={setReply} multiline placeholder={t('说说你的想法或处理进度…', 'Share your thoughts or progress…')} style={{ backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, borderRadius: 11, minHeight: 110, padding: 13, textAlignVertical: 'top', marginBottom: 13 }} /><Action title={busy ? t('正在发送…', 'Sending…') : t('发送回复', 'Send reply')} disabled={busy || !reply.trim()} onPress={() => { void send(); }} />
        {user.login.toLowerCase() === owner.toLowerCase() && <View style={{ marginTop: 10 }}><Action title={issue.state === 'open' ? t('标记为已解决', 'Mark resolved') : t('重新打开', 'Reopen')} secondary disabled={busy} onPress={() => { void changeState(); }} /></View>}
      </Card>}
    </>}
  </Page>;
}
