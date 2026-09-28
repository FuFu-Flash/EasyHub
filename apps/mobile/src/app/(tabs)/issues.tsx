import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { loadAllRepos } from '@/features/github/data';
import { loadOpenIssues, type OpenIssueGroup } from '@/features/github/openIssues';
import type { GitHubActivityCount, GitHubRepo } from '@easyhub/github';
import { PullReviewGroups } from '@/components/PullReviewGroups';
import { Action, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

export default function Issues() {
  const { client, ready } = useSession();
  const { t } = usePreferences();
  const [groups, setGroups] = useState<OpenIssueGroup[]>([]);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [counts, setCounts] = useState<Record<number, GitHubActivityCount>>({});
  const [activityTab, setActivityTab] = useState<'issues' | 'pulls'>('issues');
  const [pullFilter, setPullFilter] = useState<'open' | 'closed'>('open');
  const [expanded, setExpanded] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(0);
  const [error, setError] = useState('');
  const refresh = useCallback((force = false) => {
    if (!client) return;
    let active = true;
    const controller = new AbortController();
    setBusy(true);
    loadAllRepos(client).then(async (repos) => {
      const result = await loadOpenIssues(client, repos, { force, signal: controller.signal });
      if (active) {
        setRepos(repos);
        setGroups(result.groups);
        setCounts(result.counts);
        setFailed(result.failed);
        setError('');
      }
    }).catch(() => { if (active) setError(t('问题列表加载失败，请重试。', 'Could not load issues. Please try again.')); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [client, t]);
  useFocusEffect(useCallback(() => refresh(), [refresh]));
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('问题', 'Issues')} subtitle={t('登录后查看你的项目问题。', 'Sign in to view issues in your projects.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={() => { refresh(true); }}><Heading title={activityTab === 'issues' ? t('问题', 'Issues') : t('代码提交审查', 'Code reviews')} subtitle={activityTab === 'issues' ? t('按项目整理，先处理最需要关注的事。', 'Grouped by project, with the busiest first.') : t('查看大家提交的改进，检查修改并给出审查意见。', 'Inspect proposed changes and leave a review.')} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 16 }}>
      {([
        { label: t('问题', 'Issues'), selected: activityTab === 'issues', onPress: () => setActivityTab('issues'), flex: 1 },
        { label: t('代码提交审查', 'Code reviews'), selected: activityTab === 'pulls', onPress: () => setActivityTab('pulls'), flex: 1.9 },
        ...(activityTab === 'pulls' ? [
          { label: t('待审查', 'Open'), selected: pullFilter === 'open', onPress: () => setPullFilter('open'), flex: 1.1 },
          { label: t('已处理', 'Handled'), selected: pullFilter === 'closed', onPress: () => setPullFilter('closed'), flex: 1.1 },
        ] : []),
      ]).map((option) => <Pressable key={option.label} onPress={option.onPress} accessibilityRole="button" accessibilityState={{ selected: option.selected }} style={{ flex: option.flex, minWidth: 0, height: 41, paddingHorizontal: 3, borderRadius: 11, borderWidth: 1, borderColor: option.selected ? palette.blue : palette.border, backgroundColor: option.selected ? palette.blue : '#fff', justifyContent: 'center', alignItems: 'center' }}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: option.selected ? '#fff' : palette.ink, fontSize: 12, fontWeight: '800', textAlign: 'center' }}>{option.label}</Text></Pressable>)}
    </View>
    {busy && <Loading />}{!!error && <ErrorText message={error} onRetry={() => { refresh(true); }} />}
    {activityTab === 'pulls' && !busy && !error && <PullReviewGroups key={pullFilter} repos={repos} counts={counts} filter={pullFilter} />}
    {activityTab === 'issues' && <>
    {failed > 0 && !busy && <Text style={{ color: '#a75728', marginBottom: 12 }}>{t('部分项目的问题暂时无法加载，下拉可重试。', 'Some projects could not be checked. Pull down to retry.')}</Text>}
    {groups.map(({ repo, issues, count }) => <Card key={repo.id}>
      <Pressable onPress={() => setExpanded((current) => current.includes(repo.id) ? current.filter((id) => id !== repo.id) : [...current, repo.id])}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '800', color: palette.ink }}>{repo.name}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{t('待处理的问题', 'Open issues')}</Text></View><View style={{ backgroundColor: '#fff0f1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ color: '#bd3548', fontWeight: '800' }}>{count}</Text></View><Text style={{ color: '#7488a3', fontSize: 20 }}>{expanded.includes(repo.id) ? '⌃' : '⌄'}</Text></View>
      </Pressable>
      {expanded.includes(repo.id) && issues.map((issue) => <Pressable key={issue.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]/issue/[number]', params: { owner: repo.owner.login, repo: repo.name, number: String(issue.number) } })} style={{ borderTopWidth: 1, borderTopColor: palette.border, marginTop: 12, paddingTop: 12 }}><Text style={{ color: palette.ink, fontWeight: '600' }}>{issue.title}</Text><Text style={{ color: palette.muted, marginTop: 4 }}>{issue.user?.login || t('GitHub 用户', 'GitHub user')}</Text></Pressable>)}
      <Text onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, section: 'issues' } })} style={{ color: palette.blue, marginTop: 14 }}>{t('查看项目全部问题 →', 'View all issues →')}</Text>
    </Card>)}
    {!busy && !error && failed === 0 && groups.length === 0 && <Card style={{ alignItems: 'center', paddingVertical: 34 }}>
      <View style={{ width: 56, height: 56, borderRadius: 19, backgroundColor: '#e7f8ef', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}><Text style={{ color: '#159b5a', fontSize: 29, fontWeight: '800' }}>✓</Text></View>
      <Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800' }}>{t('目前没有待处理的问题', 'All caught up')}</Text>
      <Text style={{ color: palette.muted, lineHeight: 21, textAlign: 'center', marginTop: 7, marginBottom: 20 }}>{t('新的反馈会按项目显示在这里。', 'New feedback will appear here, grouped by project.')}</Text>
      <Action title={t('查看我的项目', 'View my projects')} secondary onPress={() => router.push('/(tabs)/projects')} />
    </Card>}
    </>}
  </Page>;
}
