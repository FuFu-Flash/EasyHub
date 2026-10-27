import { useTranslation } from '@/features/localization/react';
import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { GitHubActivityCount, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';

import { usePagedList } from '@/features/github/usePagedList';
import { pullReviewGroupExpanded, pullReviewGroupKey, refreshPullReviewGroups, type PullReviewExpansion } from '@/features/github/pullReviewGroups';
import type { RefreshHandle } from '@/features/github/usePullRefresh';
import { Action, Card, palette } from '@/components/elements';
import { MaterialArrow } from './MaterialArrow';
import { themed } from '@/features/theme/theme';

const pullKey = (item: GitHubPullRequest) => item.id;

function PullReviewGroup({ repo, filter, count, visible, expanded, onToggle, ref }: {
  repo: GitHubRepo; filter: 'open' | 'closed'; count: number | undefined; visible: boolean; expanded: boolean; onToggle: () => void; ref?: Ref<RefreshHandle>;
}) {
  const { client } = useSession();
  const t = useTranslation();
  const owner = repo.owner.login;
  const name = repo.name;
  const fetchPage = useCallback(async (state: 'open' | 'closed', page: number, signal: AbortSignal) => {
    if (!client) throw new Error('GitHub unavailable');
    const items = await client.pullRequestsPage(owner, name, state, page, signal);
    return { items, nextPage: items.length === 100 ? page + 1 : null };
  }, [client, owner, name]);
  const fetchOpen = useCallback((page: number, signal: AbortSignal) => fetchPage('open', page, signal), [fetchPage]);
  const fetchClosed = useCallback((page: number, signal: AbortSignal) => fetchPage('closed', page, signal), [fetchPage]);
  // Keep a separate reading window for each filter when the reader switches back.
  const open = usePagedList(fetchOpen, pullKey, Boolean(client && expanded && filter === 'open'));
  const closed = usePagedList(fetchClosed, pullKey, Boolean(client && expanded && filter === 'closed'));
  const list = filter === 'open' ? open : closed;
  const reload = list.reload;
  useImperativeHandle(ref, () => ({ refresh: async () => { if (client && expanded) await reload(); } }), [client, expanded, reload]);
  if (!visible) return null;
  return <Card>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{name}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{filter === 'open' ? t("PullReviewGroups.changesAwaitingReview") : t("PullReviewGroups.handledChangeRequests")}</Text></View>
      <View style={{ backgroundColor: themed('#fff0f1'), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ color: themed('#bd3548'), fontWeight: '800' }}>{count ?? '…'}</Text></View><MaterialArrow name={expanded ? 'expandLess' : 'expandMore'} />
    </Pressable>
    {expanded && <View>
      {list.failedPage !== null && <View style={{ marginTop: 12, gap: 8 }}><Text style={{ color: themed('#bf3947') }}>{t("PullReviewGroups.couldNotLoadChangeRequestsPleaseTryAgain")}</Text><Action title={t("DiscussionSearch.retry")} secondary disabled={list.busy} onPress={() => { void list.more(); }} /></View>}
      {list.items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/project/[owner]/[repo]/pull/[number]', params: { owner, repo: name, number: String(item.number) } })} style={{ borderTopWidth: 1, borderTopColor: palette.border, marginTop: 12, paddingTop: 12 }}><Text style={{ color: palette.ink, fontWeight: '700' }}>{item.title}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 5 }}>{item.user?.login || t("PullRequestsPanel.githubUser")} · {item.draft ? t("PullRequestsPanel.draft") : item.merged_at ? t("PullRequestsPanel.accepted") : item.state === 'open' ? t("PullRequestsPanel.awaitingReview") : t("DiscussionSearch.closed")}</Text></Pressable>)}
      {list.busy && <Text style={{ color: palette.muted, marginTop: 12 }}>{t("PullReviewGroups.loadingChangeRequests")}</Text>}
      {list.loaded && !list.busy && list.failedPage === null && !list.items.length && <Text style={{ color: palette.muted, marginTop: 12 }}>{filter === 'open' ? t("PullRequestsPanel.noChangesAwaitingReview") : t("PullRequestsPanel.noHandledChangeRequestsYet")}</Text>}
      {list.nextPage !== null && !list.busy && list.failedPage === null && <View style={{ marginTop: 12 }}><Action title={t("PullReviewGroups.loadMoreChangeRequests")} secondary onPress={() => { void list.more(); }} /></View>}
    </View>}
  </Card>;
}

export function PullReviewGroups({ repos, counts, filter, ref }: { repos: GitHubRepo[]; counts: Record<number, GitHubActivityCount>; filter: 'open' | 'closed'; ref?: Ref<RefreshHandle> }) {
  const t = useTranslation();
  const [expanded, setExpanded] = useState<PullReviewExpansion>({});
  const groups = useRef(new Map<number, RefreshHandle>());
  useImperativeHandle(ref, () => ({ refresh: () => refreshPullReviewGroups(groups.current.values()) }), []);
  const numberFor = (repo: GitHubRepo) => filter === 'open' ? counts[repo.id]?.pullRequests : counts[repo.id]?.closedPullRequests;
  const ordered = [...repos].sort((a, b) => (numberFor(b) ?? -1) - (numberFor(a) ?? -1) || a.name.localeCompare(b.name));
  return <View>
    {ordered.map((repo) => <PullReviewGroup key={repo.id} ref={handle => { if (handle) groups.current.set(repo.id, handle); else groups.current.delete(repo.id); }} repo={repo} filter={filter} count={numberFor(repo)} visible={numberFor(repo) !== 0} expanded={numberFor(repo) !== 0 && pullReviewGroupExpanded(expanded, repo.id, filter, numberFor(repo))} onToggle={() => setExpanded((previous) => ({ ...previous, [pullReviewGroupKey(repo.id, filter)]: !pullReviewGroupExpanded(previous, repo.id, filter, numberFor(repo)) }))} />)}
    {!ordered.some(repo => numberFor(repo) !== 0) && <Card><Text style={{ color: palette.muted }}>{filter === 'open' ? t("PullRequestsPanel.noChangesAwaitingReview") : t("PullRequestsPanel.noHandledChangeRequestsYet")}</Text></Card>}
  </View>;
}
