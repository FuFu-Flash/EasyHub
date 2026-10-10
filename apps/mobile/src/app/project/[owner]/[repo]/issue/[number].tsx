import { useCallback, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { GitHubComment, GitHubIssue, GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { usePullRefresh } from '@/features/github/usePullRefresh';
import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { publicTranslationAllowed } from '@/features/translation/paragraphs';
import { TranslatableMarkdown } from '@/components/TranslatableMarkdown';
import { invalidateOpenIssues } from '@/features/github/openIssues';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

type IssueParameters = { owner: string; repo: string; number: string; mode?: string };
export default function IssueDetail() {
  const params = useLocalSearchParams<IssueParameters>();
  return <IssueDetails key={`${params.owner}/${params.repo}/${params.number}`} {...params} />;
}
function IssueDetails({ owner, repo, number }: IssueParameters) {
  const { client, user, ready } = useSession();
  const { t } = usePreferences();
  const [issue, setIssue] = useState<GitHubIssue | null>(null);
  const [repository, setRepository] = useState<GitHubRepo | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [nextCommentPage, setNextCommentPage] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const readTask = useRef<Promise<void> | null>(null);
  const isPublic = publicTranslationAllowed(repository);
  const names = [owner, repo, ...(issue?.user?.login ? [issue.user.login] : []), ...comments.flatMap((item) => item.user?.login ? [item.user.login] : [])];
  const translatedTitle = useTranslatedContent(issue?.title || '', names, isPublic).value;
  const issueNumber = Number(number);
  const load = useCallback((force = false) => {
    if (!client || !Number.isSafeInteger(issueNumber) || issueNumber < 1) return Promise.resolve();
    if (!force && readTask.current) return readTask.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setLoadingMore(false); setError(''); setCommentError('');
    const task = Promise.allSettled([client.issue(owner, repo, issueNumber, controller.signal), client.commentsPage(owner, repo, issueNumber, 1, controller.signal), client.repo(owner, repo, controller.signal)])
      .then(([item, replies, source]) => {
        if (controller.signal.aborted || request.current !== controller) return;
        if (item.status === 'fulfilled') setIssue(item.value);
        else setError(t('问题加载失败，请重试。', 'Could not load this issue. Please try again.'));
        if (source.status === 'fulfilled') setRepository(source.value);
        else setRepository(null);
        if (replies.status === 'fulfilled') { setComments(replies.value.items); setNextCommentPage(replies.value.nextPage); }
        if (replies.status === 'rejected') { setNextCommentPage((current) => current ?? 1); setCommentError(t('回复加载失败，请重试。', 'Could not load replies. Please retry.')); }
      }).finally(() => {
        if (!controller.signal.aborted && request.current === controller) setLoading(false);
        if (readTask.current === task) readTask.current = null;
      });
    readTask.current = task;
    return task;
  }, [client, owner, repo, issueNumber, t]);
  const { refresh, refreshing } = usePullRefresh([async () => { if (!busy) await load(); }]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { request.current?.abort(); request.current = null; readTask.current = null; };
  }, [load]));
  const loadMoreComments = async () => {
    const controller = request.current;
    if (!client || loading || loadingMore || nextCommentPage === null || !controller || controller.signal.aborted) return;
    setLoadingMore(true); setCommentError('');
    try {
      const result = await client.commentsPage(owner, repo, issueNumber, nextCommentPage, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      setComments((current) => [...new Map([...current, ...result.items].map((item) => [item.id, item])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id));
      setNextCommentPage(result.nextPage);
    } catch {
      if (!controller.signal.aborted && request.current === controller) setCommentError(t('更多回复加载失败，请重试。', 'Could not load more replies. Please retry.'));
    } finally { if (!controller.signal.aborted && request.current === controller) setLoadingMore(false); }
  };
  const send = async () => {
    if (!client || !reply.trim()) return;
    setBusy(true);
    try {
      const created = await client.createComment(owner, repo, issueNumber, reply.trim());
      setComments((current) => [...current.filter((item) => item.id !== created.id), created].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id));
      setIssue((current) => current ? { ...current, comments: current.comments + 1 } : current);
      setReply('');
    }
    catch { Alert.alert(t('发送失败', 'Could not send'), t('请稍后重试。', 'Please try again later.')); }
    finally { setBusy(false); }
  };
  const changeState = async () => {
    if (!client || !issue) return;
    setBusy(true);
    try { await client.updateIssue(owner, repo, issueNumber, issue.state === 'open' ? 'closed' : 'open'); invalidateOpenIssues(client); void load(true); }
    catch { Alert.alert(t('操作失败', 'Could not update'), t('你可能没有管理此问题的权限。', 'You may not have permission to manage this issue.')); }
    finally { setBusy(false); }
  };
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('请先登录', 'Please sign in')} subtitle={t('登录后查看这个问题。', 'Sign in to view this issue.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh} refreshing={refreshing}>
    <BackLink title={t('返回问题', 'Back to issues')} marginBottom={25} />
    {loading && !issue && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {issue && <>
      <Text style={{ color: issue.state === 'open' ? palette.green : palette.muted, fontWeight: '700' }}>{issue.state === 'open' ? t('待处理', 'Open') : t('已解决', 'Resolved')}</Text>
      <Heading title={translatedTitle || issue.title} subtitle={`${issue.user?.login || t('GitHub 用户', 'GitHub user')} · ${new Date(issue.created_at).toLocaleString()}`} />
      {[{ id: issue.id, body: issue.body || '', user: issue.user?.login || t('GitHub 用户', 'GitHub user'), date: issue.created_at }, ...comments.map((item) => ({ id: item.id, body: item.body, user: item.user?.login || t('GitHub 用户', 'GitHub user'), date: item.created_at }))].map((message) => <View key={message.id} style={{ flexDirection: 'row', gap: 9, marginBottom: 13 }}>
        <View style={{ width: 36, height: 36, backgroundColor: '#e4f0ff', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.blue, fontWeight: '800' }}>{message.user[0]?.toUpperCase()}</Text></View>
        <Card style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: palette.ink }}>{message.user} <Text style={{ color: palette.muted, fontWeight: '400' }}>· {new Date(message.date).toLocaleString()}</Text></Text><View style={{ marginTop: 14 }}><TranslatableMarkdown text={message.body || t('（没有文字说明）', '(No description)')} isPublic={isPublic} protectedNames={names} /></View></Card>
      </View>)}
      {!!commentError && <ErrorText message={commentError} onRetry={() => { void loadMoreComments(); }} />}
      {nextCommentPage !== null && <View style={{ marginBottom: 15 }}><Action title={loadingMore ? t('正在加载回复…', 'Loading replies…') : commentError ? t('重试加载回复', 'Retry replies') : t('加载更多回复', 'Load more replies')} secondary disabled={loading || loadingMore} onPress={() => { void loadMoreComments(); }} /></View>}
      {user && <Card><Text style={{ fontWeight: '800', color: palette.ink, marginBottom: 11 }}>{t('写一条回复', 'Write a reply')}</Text><TextInput value={reply} onChangeText={setReply} multiline placeholder={t('说说你的想法或处理进度…', 'Share your thoughts or progress…')} style={{ backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, borderRadius: 11, minHeight: 110, padding: 13, textAlignVertical: 'top', marginBottom: 13 }} /><Action title={busy ? t('正在发送…', 'Sending…') : t('发送回复', 'Send reply')} disabled={busy || loading || !!error || !reply.trim()} onPress={() => { void send(); }} />
        {!repository?.archived && (repository?.permissions?.push || user.login.toLowerCase() === owner.toLowerCase() || user.login.toLowerCase() === issue.user?.login.toLowerCase()) && <View style={{ marginTop: 10 }}><Action title={issue.state === 'open' ? t('标记为已解决', 'Mark resolved') : t('重新打开', 'Reopen')} secondary disabled={busy || loading || !!error} onPress={() => { void changeState(); }} /></View>}
      </Card>}
    </>}
  </Page>;
}
