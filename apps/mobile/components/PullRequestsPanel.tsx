import { useTranslation } from '@/features/localization/react';
import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { GitHubPullRequest } from '@easyhub/github';
import { useSession } from '@/features/auth/session';

import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { DiscussionSearch } from '@/components/DiscussionSearch';
import { Action, Card, ErrorText, Loading, palette } from '@/components/elements';
import { usePagedList } from '@/features/github/usePagedList';
import type { RefreshHandle } from '@/features/github/usePullRefresh';

const pullKey = (item: GitHubPullRequest) => item.id;

function PullTitle({ item, owner, repo, isPublic }: { item: GitHubPullRequest; owner: string; repo: string; isPublic: boolean }) {
  const title = useTranslatedContent(item.title, [owner, repo, item.user?.login || ''], isPublic).value;
  return <Text style={{ color: palette.ink, fontSize: 16, fontWeight: '800', lineHeight: 23 }}>{title}</Text>;
}

export function PullRequestsPanel({ owner, repo, mode, isPublic = false, ref }: { owner: string; repo: string; mode?: string; isPublic?: boolean; ref?: Ref<RefreshHandle> }) {
  const { client } = useSession();
  const t = useTranslation();
  const [state, setState] = useState<'open' | 'closed'>('open');
  const search = useRef<RefreshHandle>(null);
  const fetchPage = useCallback(async (page: number, signal: AbortSignal) => {
    if (!client) throw new Error('GitHub unavailable');
    const items = await client.pullRequestsPage(owner, repo, state, page, signal);
    return { items, nextPage: items.length === 100 ? page + 1 : null };
  }, [client, owner, repo, state]);
  const list = usePagedList(fetchPage, pullKey, Boolean(client));
  const { items, busy, failedPage } = list;
  const reload = list.reload;
  useImperativeHandle(ref, () => ({ refresh: async () => {
    if (client) await Promise.allSettled([reload(), search.current?.refresh()]);
  } }), [client, reload]);
  const error = failedPage === null ? '' : failedPage === 1
    ? t("PullRequestsPanel.couldNotLoadPullRequestsPleaseTryAgain")
    : t("PullRequestsPanel.couldNotLoadMorePullRequests");
  return <View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      <Action title={t("PullRequestsPanel.open")} secondary={state !== 'open'} onPress={() => setState('open')} />
      <Action title={t("DiscussionSearch.closed")} secondary={state !== 'closed'} onPress={() => setState('closed')} />
    </View>
    <DiscussionSearch ref={search} owner={owner} repo={repo} kind="pr" state={state} mode={mode} isPublic={isPublic}>
    {!!error && <ErrorText message={error} onRetry={() => { void list.more(); }} />}
    {items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/project/[owner]/[repo]/pull/[number]', params: { owner, repo, number: String(item.number), ...(mode ? { mode } : {}) } })}>
      <Card><PullTitle item={item} owner={owner} repo={repo} isPublic={isPublic} />
        <Text style={{ color: palette.muted, marginTop: 7 }}>{item.draft ? t("PullRequestsPanel.draft") : item.merged_at ? t("PullRequestsPanel.accepted") : item.state === 'open' ? t("PullRequestsPanel.awaitingReview") : t("DiscussionSearch.closed")} · #{item.number} · {item.user?.login || t("PullRequestsPanel.githubUser")}</Text>
      </Card>
    </Pressable>)}
    {busy && <Loading />}
    {!busy && !error && items.length === 0 && <Card><Text style={{ color: palette.muted }}>{state === 'open' ? t("PullRequestsPanel.noChangesAwaitingReview") : t("PullRequestsPanel.noHandledChangeRequestsYet")}</Text></Card>}
    {list.nextPage !== null && !busy && !error && <Action title={t("PullRequestsPanel.loadMore")} secondary onPress={() => { void list.more(); }} />}
    </DiscussionSearch>
  </View>;
}
