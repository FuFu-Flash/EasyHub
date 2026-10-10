import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { GitHubPullRequest } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
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
  const { t } = usePreferences();
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
    ? t('合并请求加载失败，请重试。', 'Could not load pull requests. Please try again.')
    : t('更多合并请求加载失败，请重试。', 'Could not load more pull requests.');
  return <View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      <Action title={t('待审查', 'Open')} secondary={state !== 'open'} onPress={() => setState('open')} />
      <Action title={t('已关闭', 'Closed')} secondary={state !== 'closed'} onPress={() => setState('closed')} />
    </View>
    <DiscussionSearch ref={search} owner={owner} repo={repo} kind="pr" state={state} mode={mode} isPublic={isPublic}>
    {!!error && <ErrorText message={error} onRetry={() => { void list.more(); }} />}
    {items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/project/[owner]/[repo]/pull/[number]', params: { owner, repo, number: String(item.number), ...(mode ? { mode } : {}) } })}>
      <Card><PullTitle item={item} owner={owner} repo={repo} isPublic={isPublic} />
        <Text style={{ color: palette.muted, marginTop: 7 }}>{item.draft ? t('草稿', 'Draft') : item.merged_at ? t('已采纳', 'Accepted') : item.state === 'open' ? t('待审查', 'Awaiting review') : t('已关闭', 'Closed')} · #{item.number} · {item.user?.login || t('GitHub 用户', 'GitHub user')}</Text>
      </Card>
    </Pressable>)}
    {busy && <Loading />}
    {!busy && !error && items.length === 0 && <Card><Text style={{ color: palette.muted }}>{state === 'open' ? t('没有待审查的改进请求', 'No changes awaiting review') : t('还没有已处理的改进请求', 'No handled change requests yet')}</Text></Card>}
    {list.nextPage !== null && !busy && !error && <Action title={t('加载更多', 'Load more')} secondary onPress={() => { void list.more(); }} />}
    </DiscussionSearch>
  </View>;
}
