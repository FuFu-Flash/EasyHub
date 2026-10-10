import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { loadAllRepos } from '@/features/github/data';
import { loadOpenIssues, type OpenIssueGroup } from '@/features/github/openIssues';
import type { GitHubActivityCount, GitHubClient, GitHubIssue, GitHubRepo } from '@easyhub/github';
import { PullReviewGroups } from '@/components/PullReviewGroups';
import { DiscussionSearch } from '@/components/DiscussionSearch';
import { Action, Card, DirectionLabel, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';
import { MaterialArrow } from '@/components/MaterialArrow';
import { usePullRefresh, type RefreshHandle } from '@/features/github/usePullRefresh';

function IssueTitle({ issue, repo }: { issue: GitHubIssue; repo: GitHubRepo }) {
  const title = useTranslatedContent(issue.title, [repo.owner.login, repo.name, issue.user?.login || ''], repo.private === false).value;
  return <Text style={{ color: palette.ink, fontWeight: '600' }}>{title}</Text>;
}

export default function Issues() {
  const { activity } = useLocalSearchParams<{ activity?: string }>();
  const { client, ready, user } = useSession();
  const { t } = usePreferences();
  const [groups, setGroups] = useState<OpenIssueGroup[]>([]);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [counts, setCounts] = useState<Record<number, GitHubActivityCount>>({});
  const [loadedClient, setLoadedClient] = useState<GitHubClient | null>(null);
  const request = useRef<AbortController | null>(null);
  const searchRefresh = useRef<RefreshHandle>(null);
  const groupsRefresh = useRef<RefreshHandle>(null);
  const [activityTab, setActivityTab] = useState<'issues' | 'pulls'>('issues');
  const [pullFilter, setPullFilter] = useState<'open' | 'closed'>('open');
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>('open');
  useEffect(() => { if (activity === 'pulls' || activity === 'issues') queueMicrotask(() => setActivityTab(activity)); }, [activity]);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(0);
  const [error, setError] = useState('');
  const load = useCallback(async (force = false) => {
    if (!client) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const active = () => !controller.signal.aborted && request.current === controller;
    setBusy(true);
    await loadAllRepos(client, controller.signal).then(async (repos) => {
      if (!active()) return;
      const result = await loadOpenIssues(client, repos, { force, signal: controller.signal, state: issueFilter });
      if (active()) {
        setLoadedClient(client);
        setRepos(repos);
        setGroups(result.groups);
        setCounts(result.counts);
        setFailed(result.failed);
        setError('');
      }
    }).catch(() => { if (active()) setError(t('问题列表加载失败，请重试。', 'Could not load issues. Please try again.')); }).finally(() => { if (active()) setBusy(false); });
  }, [client, t, issueFilter]);
  useFocusEffect(useCallback(() => { void load(); return () => request.current?.abort(); }, [load]));
  const { refresh, refreshing } = usePullRefresh([
    () => load(true),
    () => searchRefresh.current?.refresh() ?? Promise.resolve(),
    () => groupsRefresh.current?.refresh() ?? Promise.resolve(),
  ]);
  const currentRepos = loadedClient === client ? repos : [];
  const currentGroups = loadedClient === client ? groups : [];
  const currentCounts = loadedClient === client ? counts : {};
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('问题', 'Issues')} subtitle={t('登录后查看你的项目问题。', 'Sign in to view issues in your projects.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh} refreshing={refreshing}><Heading title={activityTab === 'issues' ? t('问题', 'Issues') : t('代码提交审查', 'Code reviews')} subtitle={activityTab === 'issues' ? t('按项目整理，先处理最需要关注的事。', 'Grouped by project, with the busiest first.') : t('查看大家提交的改进，检查修改并给出审查意见。', 'Inspect proposed changes and leave a review.')} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 16 }}>
      {([
        { label: t('问题', 'Issues'), selected: activityTab === 'issues', onPress: () => setActivityTab('issues'), flex: 1 },
        { label: t('代码提交审查', 'Code reviews'), selected: activityTab === 'pulls', onPress: () => setActivityTab('pulls'), flex: 1.9 },
        ...(activityTab === 'pulls' ? [
          { label: t('待审查', 'Open'), selected: pullFilter === 'open', onPress: () => setPullFilter('open'), flex: 1.1 },
          { label: t('已处理', 'Handled'), selected: pullFilter === 'closed', onPress: () => setPullFilter('closed'), flex: 1.1 },
        ] : [
          { label: t('待处理', 'Open'), selected: issueFilter === 'open', onPress: () => setIssueFilter('open'), flex: 1.1 },
          { label: t('已解决', 'Closed'), selected: issueFilter === 'closed', onPress: () => setIssueFilter('closed'), flex: 1.1 },
        ]),
      ]).map((option) => <Pressable key={option.label} onPress={option.onPress} accessibilityRole="button" accessibilityState={{ selected: option.selected }} style={{ flex: option.flex, minWidth: 0, height: 41, paddingHorizontal: 3, borderRadius: 11, borderWidth: 1, borderColor: option.selected ? palette.blue : palette.border, backgroundColor: option.selected ? palette.blue : '#fff', justifyContent: 'center', alignItems: 'center' }}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: option.selected ? '#fff' : palette.ink, fontSize: 12, fontWeight: '800', textAlign: 'center' }}>{option.label}</Text></Pressable>)}
    </View>
    <DiscussionSearch ref={searchRefresh} key={`${user?.login || ''}:${activityTab}`} repositories={currentRepos} kind={activityTab === 'pulls' ? 'pr' : 'issue'} state={activityTab === 'pulls' ? pullFilter : issueFilter}>
    {busy && !refreshing && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {activityTab === 'pulls' && <PullReviewGroups ref={groupsRefresh} key={user?.login || ''} repos={currentRepos} counts={currentCounts} filter={pullFilter} />}
    {activityTab === 'issues' && <>
    {failed > 0 && !busy && <Text style={{ color: '#a75728', marginBottom: 12 }}>{t('部分项目的问题暂时无法加载，下拉可重试。', 'Some projects could not be checked. Pull down to retry.')}</Text>}
    {currentGroups.map(({ repo, issues, count }) => <Card key={repo.id}>
      <Pressable onPress={() => setExpanded((current) => current.includes(repo.id) ? current.filter((id) => id !== repo.id) : [...current, repo.id])} accessibilityRole="button" accessibilityState={{ expanded: expanded.includes(repo.id) }} style={{ minHeight: 48, justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '800', color: palette.ink }}>{repo.name}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{issueFilter === 'open' ? t('待处理的问题', 'Open issues') : t('已解决的问题', 'Closed issues')}</Text></View><View style={{ backgroundColor: '#fff0f1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ color: '#bd3548', fontWeight: '800' }}>{count}</Text></View><MaterialArrow name={expanded.includes(repo.id) ? 'expandLess' : 'expandMore'} color="#7488a3" /></View>
      </Pressable>
      {expanded.includes(repo.id) && issues.map((issue) => <Pressable key={issue.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]/issue/[number]', params: { owner: repo.owner.login, repo: repo.name, number: String(issue.number) } })} style={{ borderTopWidth: 1, borderTopColor: palette.border, marginTop: 12, paddingTop: 12 }}><IssueTitle issue={issue} repo={repo} /><Text style={{ color: palette.muted, marginTop: 4 }}>{issue.user?.login || t('GitHub 用户', 'GitHub user')}</Text></Pressable>)}
      <Pressable onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, section: 'issues', issueState: issueFilter } })} accessibilityRole="button" style={{ marginTop: 14, minHeight: 48, minWidth: 48, justifyContent: 'center' }}><DirectionLabel title={t('查看项目全部问题', 'View all issues')} name="forward" color={palette.blue} /></Pressable>
    </Card>)}
    {!busy && !error && failed === 0 && currentGroups.length === 0 && <Card style={{ alignItems: 'center', paddingVertical: 34 }}>
      <View style={{ width: 56, height: 56, borderRadius: 19, backgroundColor: '#e7f8ef', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}><Text style={{ color: '#159b5a', fontSize: 29, fontWeight: '800' }}>✓</Text></View>
      <Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800' }}>{issueFilter === 'open' ? t('目前没有待处理的问题', 'All caught up') : t('还没有已解决的问题', 'No closed issues yet')}</Text>
      <Text style={{ color: palette.muted, lineHeight: 21, textAlign: 'center', marginTop: 7, marginBottom: 20 }}>{t('新的反馈会按项目显示在这里。', 'New feedback will appear here, grouped by project.')}</Text>
      <Action title={t('查看我的项目', 'View my projects')} secondary onPress={() => router.push('/(tabs)/projects')} />
    </Card>}
    </>}
    </DiscussionSearch>
  </Page>;
}
