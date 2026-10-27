import { useSessionReadFocusEffect } from '@/features/auth/useSessionReadFocusEffect';
import { useTranslation } from '@/features/localization/react';
import { useCallback, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router, useLocalSearchParams } from 'expo-router';
import type { GitHubComment, GitHubIssue, GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { formatDateTime } from '@/features/localization/format';

import { usePullRefresh } from '@/features/github/usePullRefresh';
import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { publicTranslationAllowed } from '@/features/translation/paragraphs';
import { TranslatableMarkdown } from '@/components/TranslatableMarkdown';
import { invalidateOpenIssues } from '@/features/github/openIssues';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';
import { readListWindow } from '@/features/workspace/readingWindow';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';
import { themed } from '@/features/theme/theme';

type IssueParameters = { owner: string; repo: string; number: string; mode?: string };
export default function IssueDetail() {
  const params = useLocalSearchParams<IssueParameters>();
  return <IssueDetails key={`${params.owner}/${params.repo}/${params.number}`} {...params} />;
}
function IssueDetails({ owner, repo, number }: IssueParameters) {
  const { client, user, ready } = useSession();
  const { language } = usePreferences();
  const t = useTranslation();
  const { capture } = usePageFeedback();
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
  const openedCommentPages = useRef(1);
  const failedCommentWindow = useRef(false);
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
    if (force) openedCommentPages.current = 1;
    setLoading(true); setLoadingMore(false); setError(''); setCommentError('');
    const task = Promise.allSettled([client.issue(owner, repo, issueNumber, controller.signal), readListWindow((page, signal) => client.commentsPage(owner, repo, issueNumber, page, signal), openedCommentPages.current, (comment) => comment.id, controller.signal), client.repo(owner, repo, controller.signal)])
      .then(([item, replies, source]) => {
        if (controller.signal.aborted || request.current !== controller) return;
        if (item.status === 'fulfilled') setIssue(item.value);
        else setError(t("number.couldNotLoadThisIssuePleaseTryAgain"));
        if (source.status === 'fulfilled') setRepository(source.value);
        else setRepository(null);
        if (replies.status === 'fulfilled') { setComments(replies.value.items); setNextCommentPage(replies.value.nextPage); openedCommentPages.current = replies.value.pages; failedCommentWindow.current = false; }
        if (replies.status === 'rejected') { failedCommentWindow.current = true; setNextCommentPage((current) => current ?? 1); setCommentError(t("number.couldNotLoadRepliesPleaseRetry")); }
      }).finally(() => {
        if (!controller.signal.aborted && request.current === controller) setLoading(false);
        if (readTask.current === task) readTask.current = null;
      });
    readTask.current = task;
    return task;
  }, [client, owner, repo, issueNumber, t]);
  const { refresh, refreshing } = usePullRefresh([async () => { if (!busy) await load(true); }]);
  useSessionReadFocusEffect(useCallback(() => {
    void load();
    return () => { request.current?.abort(); request.current = null; readTask.current = null; };
  }, [load]));
  const loadMoreComments = async () => {
    if (failedCommentWindow.current) { await load(); return; }
    const controller = request.current;
    if (!client || loading || loadingMore || nextCommentPage === null || !controller || controller.signal.aborted) return;
    setLoadingMore(true); setCommentError('');
    try {
      const result = await client.commentsPage(owner, repo, issueNumber, nextCommentPage, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      setComments((current) => [...new Map([...current, ...result.items].map((item) => [item.id, item])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id));
      setNextCommentPage(result.nextPage);
      openedCommentPages.current = nextCommentPage;
    } catch {
      if (!controller.signal.aborted && request.current === controller) setCommentError(t("number.couldNotLoadMoreRepliesPleaseRetry"));
    } finally { if (!controller.signal.aborted && request.current === controller) setLoadingMore(false); }
  };
  const send = async () => {
    if (!client || !reply.trim()) return;
    setBusy(true);
    const current = capture();
    try {
      const created = await client.createComment(owner, repo, issueNumber, reply.trim());
      setComments((current) => [...current.filter((item) => item.id !== created.id), created].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id));
      setIssue((current) => current ? { ...current, comments: current.comments + 1 } : current);
      setReply('');
    }
    catch { if (current()) Alert.alert(t("number.couldNotSend"), t("project.pleaseTryAgainLater")); }
    finally { setBusy(false); }
  };
  const changeState = async () => {
    if (!client || !issue) return;
    setBusy(true);
    const current = capture();
    try { await client.updateIssue(owner, repo, issueNumber, issue.state === 'open' ? 'closed' : 'open'); invalidateOpenIssues(client); if (current()) void load(true); }
    catch { if (current()) Alert.alert(t("number.couldNotUpdate"), t("number.youMayNotHavePermissionToManageThisIssue")); }
    finally { setBusy(false); }
  };
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t("project.pleaseSignIn")} subtitle={t("number.signInToViewThisIssue")} /><Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh} refreshing={refreshing}>
    <BackLink title={t("number.backToIssues")} marginBottom={25} />
    {loading && !issue && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {issue && <>
      <Text style={{ color: issue.state === 'open' ? palette.green : palette.muted, fontWeight: '700' }}>{issue.state === 'open' ? t("DiscussionSearch.open") : t("project.resolved")}</Text>
      <Heading title={translatedTitle || issue.title} subtitle={`${issue.user?.login || t("PullRequestsPanel.githubUser")} · ${formatDateTime(issue.created_at, language)}`} />
      {[{ id: issue.id, body: issue.body || '', user: issue.user?.login || t("PullRequestsPanel.githubUser"), date: issue.created_at }, ...comments.map((item) => ({ id: item.id, body: item.body, user: item.user?.login || t("PullRequestsPanel.githubUser"), date: item.created_at }))].map((message) => <View key={message.id} style={{ flexDirection: 'row', gap: 9, marginBottom: 13 }}>
        <View style={{ width: 36, height: 36, backgroundColor: themed('#e4f0ff'), borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.blue, fontWeight: '800' }}>{message.user[0]?.toUpperCase()}</Text></View>
        <Card style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: palette.ink }}>{message.user} <Text style={{ color: palette.muted, fontWeight: '400' }}>· {formatDateTime(message.date, language)}</Text></Text><View style={{ marginTop: 14 }}><TranslatableMarkdown text={message.body || t("number.noDescription")} isPublic={isPublic} protectedNames={names} /></View></Card>
      </View>)}
      {!!commentError && <ErrorText message={commentError} onRetry={() => { void loadMoreComments(); }} />}
      {nextCommentPage !== null && <View style={{ marginBottom: 15 }}><Action title={loadingMore ? t("number.loadingReplies") : commentError ? t("number.retryReplies") : t("number.loadMoreReplies")} secondary disabled={loading || loadingMore} onPress={() => { void loadMoreComments(); }} /></View>}
      {user && <Card><Text style={{ fontWeight: '800', color: palette.ink, marginBottom: 11 }}>{t("number.writeAReply")}</Text><TextInput placeholderTextColor={palette.muted} value={reply} onChangeText={setReply} multiline placeholder={t("number.shareYourThoughtsOrProgress")} style={{ color: palette.ink, backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, borderRadius: 11, minHeight: 110, padding: 13, textAlignVertical: 'top', marginBottom: 13 }} /><Action title={busy ? t("number.sending") : t("number.sendReply")} disabled={busy || loading || !!error || !reply.trim()} onPress={() => { void send(); }} />
        {!repository?.archived && (repository?.permissions?.push || user.login.toLowerCase() === owner.toLowerCase() || user.login.toLowerCase() === issue.user?.login.toLowerCase()) && <View style={{ marginTop: 10 }}><Action title={issue.state === 'open' ? t("number.markResolved") : t("number.reopen")} secondary disabled={busy || loading || !!error} onPress={() => { void changeState(); }} /></View>}
      </Card>}
    </>}
  </Page>;
}
