import { useTranslation } from '@/features/localization/react';
import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { GitHubActivityCount, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';

import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { usePagedList } from '@/features/github/usePagedList';
import type { RefreshHandle } from '@/features/github/usePullRefresh';
import { Action, Card, palette } from '@/components/elements';
import { MaterialArrow } from './MaterialArrow';

const pullKey = (item: GitHubPullRequest) => item.id;

function PullTitle({ item, repo }: { item: GitHubPullRequest; repo: GitHubRepo }) {
  const title = useTranslatedContent(item.title, [repo.owner.login, repo.name, item.user?.login || ''], repo.private === false).value;
  return <Text style={{ color: palette.ink, fontWeight: '700' }}>{title}</Text>;
}

function PullReviewGroup({ repo, filter, count, expanded, onToggle, ref }: {
  repo: GitHubRepo; filter: 'open' | 'closed'; count: number; expanded: boolean; onToggle: () => void; ref?: Ref<RefreshHandle>;
}) {
  const { client } = useSession();
  const t = useTranslation();
  const owner = repo.owner.login;
  const name = repo.name;
  const fetchPage = useCallback(async (page: number, signal: AbortSignal) => {
    if (!client) throw new Error('GitHub unavailable');
    const items = await client.pullRequestsPage(owner, name, filter, page, signal);
    return { items, nextPage: items.length === 100 ? page + 1 : null };
  }, [client, owner, name, filter]);
  const list = usePagedList(fetchPage, pullKey, Boolean(client && expanded));
  const reload = list.reload;
  useImperativeHandle(ref, () => ({ refresh: async () => { if (client && expanded) await reload(); } }), [client, expanded, reload]);
  return <Card>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{name}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{filter === 'open' ? t("PullReviewGroups.changesAwaitingReview") : t("PullReviewGroups.handledChangeRequests")}</Text></View>
      <View style={{ backgroundColor: '#fff0f1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ color: '#bd3548', fontWeight: '800' }}>{count}</Text></View><MaterialArrow name={expanded ? 'expandLess' : 'expandMore'} />
    </Pressable>
    {expanded && <View>
      {list.failedPage !== null && <View style={{ marginTop: 12, gap: 8 }}><Text style={{ color: '#bf3947' }}>{t("PullReviewGroups.couldNotLoadChangeRequestsPleaseTryAgain")}</Text><Action title={t("DiscussionSearch.retry")} secondary disabled={list.busy} onPress={() => { void list.more(); }} /></View>}
      {list.items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/project/[owner]/[repo]/pull/[number]', params: { owner, repo: name, number: String(item.number) } })} style={{ borderTopWidth: 1, borderTopColor: palette.border, marginTop: 12, paddingTop: 12 }}><PullTitle item={item} repo={repo} /><Text style={{ color: palette.muted, fontSize: 12, marginTop: 5 }}>{item.user?.login || t("PullRequestsPanel.githubUser")} · {item.draft ? t("PullRequestsPanel.draft") : item.merged_at ? t("PullRequestsPanel.accepted") : item.state === 'open' ? t("PullRequestsPanel.awaitingReview") : t("DiscussionSearch.closed")}</Text></Pressable>)}
      {list.busy && <Text style={{ color: palette.muted, marginTop: 12 }}>{t("PullReviewGroups.loadingChangeRequests")}</Text>}
      {list.nextPage !== null && !list.busy && list.failedPage === null && <View style={{ marginTop: 12 }}><Action title={t("PullReviewGroups.loadMoreChangeRequests")} secondary onPress={() => { void list.more(); }} /></View>}
    </View>}
  </Card>;
}

export function PullReviewGroups({ repos, counts, filter, ref }: { repos: GitHubRepo[]; counts: Record<number, GitHubActivityCount>; filter: 'open' | 'closed'; ref?: Ref<RefreshHandle> }) {
  const t = useTranslation();
  const [expanded, setExpanded] = useState<number | null>(null);
  const currentGroup = useRef<RefreshHandle>(null);
  useImperativeHandle(ref, () => ({ refresh: async () => { await currentGroup.current?.refresh(); } }), []);
  const numberFor = (repo: GitHubRepo) => filter === 'open' ? counts[repo.id]?.pullRequests ?? 0 : counts[repo.id]?.closedPullRequests ?? 0;
  const ordered = [...repos].filter((repo) => numberFor(repo) > 0).sort((a, b) => numberFor(b) - numberFor(a) || a.name.localeCompare(b.name));
  return <View>
    {ordered.map((repo) => <PullReviewGroup key={repo.id} ref={expanded === repo.id ? currentGroup : undefined} repo={repo} filter={filter} count={numberFor(repo)} expanded={expanded === repo.id} onToggle={() => setExpanded((previous) => previous === repo.id ? null : repo.id)} />)}
    {ordered.length === 0 && <Card><Text style={{ color: palette.muted }}>{filter === 'open' ? t("PullRequestsPanel.noChangesAwaitingReview") : t("PullRequestsPanel.noHandledChangeRequestsYet")}</Text></Card>}
  </View>;
}
