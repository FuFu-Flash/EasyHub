import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { friendlyGitHubError, type GitHubRepo, type GitHubSearchUser, type TrendingPage, type TrendingPeriod } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { type SearchEntry, type SearchScope, parseSearchHistory, rememberSearch } from '@/features/github/searchHistory';
import { recordObservations, starTrend, type StarObservations } from '@/features/github/starObservations';
import { loadStarObservations, saveStarObservations } from '@/features/github/starObservationStore';
import { Action, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

type DisplayMode = 'compact' | 'detailed';
const periods: { id: TrendingPeriod; title: [string, string] }[] = [
  { id: 'today', title: ['今日热门', 'Today'] }, { id: 'week', title: ['本周热门', 'This week'] }, { id: 'month', title: ['本月热门', 'This month'] },
];
const trendingCache = new Map<string, { at: number; value: TrendingPage }>();

function Choice({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 11, backgroundColor: selected ? '#e7f0ff' : '#fff', borderWidth: 1, borderColor: selected ? '#a8cbff' : palette.border }}>
    <Text style={{ color: selected ? '#166ee7' : '#52637c', fontWeight: '700' }}>{title}</Text>
  </Pressable>;
}

function OpenRepo({ repo, compact, rank, trend, width }: { repo: GitHubRepo; compact: boolean; rank?: number; trend?: string; width: number }) {
  const { t } = usePreferences();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${t('查看公开项目', 'View public project')} ${repo.full_name}`} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, mode: 'public' } })} style={{ width }}>
    <Card style={{ minHeight: compact ? 126 : 178, marginBottom: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {typeof rank === 'number' && <Text style={{ fontSize: 13, color: palette.blue, fontWeight: '800' }}>#{rank}</Text>}
        {repo.owner.avatar_url ? <Image source={{ uri: repo.owner.avatar_url }} style={{ width: 34, height: 34, borderRadius: 10 }} /> : <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#e8f2ff', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.blue, fontWeight: '800' }}>{repo.owner.login[0]?.toUpperCase()}</Text></View>}
        <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ fontWeight: '800', color: palette.ink, fontSize: 16 }}>{repo.name}</Text><Text numberOfLines={1} style={{ color: palette.muted, fontSize: 12 }}>{repo.owner.login}</Text></View>
      </View>
      {!compact && <Text numberOfLines={3} style={{ color: '#52647e', marginTop: 12, lineHeight: 20 }}>{repo.description || t('还没有项目简介。', 'No description yet.')}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 13 }}>
        {!compact && <Text style={{ color: palette.muted, fontSize: 12 }}>{repo.language || t('未标注语言', 'Language not listed')}</Text>}
        <Text style={{ color: palette.muted, fontSize: 12 }}>★ {(repo.stargazers_count ?? 0).toLocaleString()}</Text>
        {trend && <Text style={{ color: palette.muted, fontSize: 12 }}>{trend}</Text>}
      </View>
    </Card>
  </Pressable>;
}

function OpenUser({ user, compact, width, topRepos }: { user: GitHubSearchUser; compact: boolean; width: number; topRepos?: GitHubRepo[] }) {
  const { t } = usePreferences();
  return <View style={{ width }}><Card style={{ marginBottom: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t('查看', 'View')} ${user.login} ${t('的主页', 'profile')}`} onPress={() => router.push({ pathname: '/profile/[login]', params: { login: user.login } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      <Image source={{ uri: user.avatar_url }} style={{ width: 42, height: 42, borderRadius: 14 }} />
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: palette.ink, fontWeight: '800', fontSize: 16 }}>{user.login}</Text><Text style={{ color: palette.muted, fontSize: 12 }}>{t('GitHub 用户', 'GitHub user')}</Text></View>
    </Pressable>
    {!compact && <View style={{ marginTop: 15, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12 }}>
      <Text style={{ color: palette.muted, fontSize: 12, marginBottom: 8 }}>{t('Star 最高的 3 个公开项目', 'Top 3 public projects by Star')}</Text>
      {topRepos === undefined ? <Text style={{ color: palette.muted, fontSize: 12 }}>{t('正在加载项目…', 'Loading projects…')}</Text> : topRepos.length ? topRepos.map((repo) => <Pressable key={repo.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, mode: 'public' } })} style={{ paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text numberOfLines={1} style={{ flex: 1, color: palette.ink }}>{repo.name}</Text><Text style={{ color: palette.muted }}>★ {(repo.stargazers_count ?? 0).toLocaleString()}</Text></Pressable>) : <Text style={{ color: palette.muted, fontSize: 12 }}>{t('没有可展示的公开项目。', 'No public projects to show.')}</Text>}
    </View>}
    <Pressable onPress={() => router.push({ pathname: '/profile/[login]', params: { login: user.login } })} style={{ marginTop: 13 }}><Text style={{ color: palette.blue, fontWeight: '700' }}>{t('查看主页 →', 'View profile →')}</Text></Pressable>
  </Card></View>;
}

export default function Discover() {
  const { client, ready, user } = useSession();
  const { t } = usePreferences();
  const { width: screenWidth } = useWindowDimensions();
  const contentWidth = Math.max(260, screenWidth - 44);
  const halfWidth = (contentWidth - 10) / 2;
  const [scope, setScope] = useState<SearchScope>('projects');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<TrendingPeriod>('today');
  const [page, setPage] = useState(1);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('compact');
  const [history, setHistory] = useState<SearchEntry[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [trending, setTrending] = useState<TrendingPage | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [users, setUsers] = useState<GitHubSearchUser[]>([]);
  const [topRepos, setTopRepos] = useState<Record<string, GitHubRepo[]>>({});
  const [observations, setObservations] = useState<StarObservations>({});
  const [observedAt, setObservedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const search = query.trim();
  const searching = search.length >= 2;
  const historyKey = user ? `easyhub.discovery.history.${user.id ?? user.login}` : '';

  useEffect(() => {
    let active = true;
    if (!historyKey) return;
    void SecureStore.getItemAsync(historyKey).then((raw) => { if (active) setHistory(parseSearchHistory(raw)); })
      .catch(() => { if (active) setHistory([]); })
      .finally(() => { if (active) setHistoryReady(true); });
    return () => { active = false; };
  }, [historyKey]);
  useEffect(() => {
    if (historyReady && historyKey) void SecureStore.setItemAsync(historyKey, JSON.stringify(history)).catch(() => undefined);
  }, [history, historyKey, historyReady]);
  useEffect(() => {
    if (!user?.login) return;
    let active = true;
    void loadStarObservations(user.login).then((saved) => { if (active) { setObservations(saved); setObservedAt(Date.now()); } }).catch(() => undefined);
    return () => { active = false; };
  }, [user?.login]);
  const recordSearch = useCallback((value: string, kind: SearchScope) => {
    setHistory((current) => rememberSearch(current, value, kind));
  }, []);

  useEffect(() => {
    if (!client || scope !== 'projects' || search) return;
    let active = true;
    const key = `${period}:${page}`;
    const cached = trendingCache.get(key);
    if (refreshKey === 0 && cached && Date.now() - cached.at < 600000) {
      queueMicrotask(() => { if (active) { setTrending(cached.value); setError(''); setBusy(false); } });
      return () => { active = false; };
    }
    queueMicrotask(() => { if (active) { setTrending(null); setBusy(true); setError(''); } });
    const controller = new AbortController();
    void client.trending(period, page, controller.signal).then(async (value) => {
      if (!active) return;
      trendingCache.set(key, { at: Date.now(), value }); setTrending(value);
      if (user?.login) {
        const previous = await loadStarObservations(user.login).catch(() => ({}));
        const updated = recordObservations(previous, value.items, Date.now());
        await saveStarObservations(user.login, updated).catch(() => undefined);
        if (active) { setObservations(updated); setObservedAt(Date.now()); }
      }
    }).catch((cause: unknown) => { if (active) setError(friendlyGitHubError(cause)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [client, page, period, refreshKey, scope, search, user?.login]);

  useEffect(() => {
    if (!client || !searching) return;
    let active = true;
    const controller = new AbortController();
    queueMicrotask(() => { if (active) { setBusy(true); setError(''); setRepos([]); setUsers([]); setTopRepos({}); } });
    const timer = setTimeout(() => {
      const task = scope === 'projects' ? client.searchPublicRepos(search, controller.signal) : client.searchUsers(search, controller.signal);
      void task.then((items) => {
        if (!active) return;
        if (scope === 'projects') setRepos(items as GitHubRepo[]);
        else setUsers(items as GitHubSearchUser[]);
        recordSearch(search, scope);
      }).catch((cause: unknown) => { if (active) setError(friendlyGitHubError(cause)); })
        .finally(() => { if (active) setBusy(false); });
    }, 450);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [client, recordSearch, refreshKey, scope, search, searching]);

  useEffect(() => {
    if (!client || scope !== 'users' || displayMode !== 'detailed' || users.length === 0) return;
    let active = true;
    void (async () => {
      for (let index = 0; index < users.length && active; index += 2) {
        await Promise.all(users.slice(index, index + 2).map(async (item) => {
          try {
            const results = await client.topStarredRepos(item.login);
            if (active) setTopRepos((current) => ({ ...current, [item.login]: results }));
          } catch { if (active) setTopRepos((current) => ({ ...current, [item.login]: [] })); }
        }));
      }
    })();
    return () => { active = false; };
  }, [client, displayMode, scope, users]);

  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('发现 / 搜索', 'Discover / Search')} subtitle={t('登录后探索公开项目与 GitHub 用户。', 'Sign in to explore public projects and GitHub users.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  const visibleRepos = searching ? repos : trending?.items ?? [];
  const itemWidth = searching && displayMode === 'compact' ? halfWidth : contentWidth;
  const userWidth = displayMode === 'compact' ? halfWidth : contentWidth;
  return <Page refresh={() => setRefreshKey((value) => value + 1)}>
    <Text style={{ color: palette.blue, fontWeight: '700', marginBottom: 5 }}>{t('发现更多作品', 'Explore more creations')}</Text>
    <Heading title={t('发现 / 搜索', 'Discover / Search')} subtitle={t('搜索公开项目与 GitHub 用户，也可以看看大家最近在创作什么。', 'Search public projects and GitHub users, or see what people are creating.')} />
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}><Choice title={t('项目搜索', 'Projects')} selected={scope === 'projects'} onPress={() => setScope('projects')} /><Choice title={t('用户搜索', 'Users')} selected={scope === 'users'} onPress={() => setScope('users')} /></View>
    <TextInput accessibilityLabel={scope === 'users' ? t('搜索用户', 'Search users') : t('搜索公开项目', 'Search public projects')} value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" returnKeyType="search" placeholder={scope === 'users' ? t('搜索 GitHub 用户…', 'Search GitHub users…') : t('搜索所有公开项目…', 'Search all public projects…')} style={{ backgroundColor: '#fff', borderColor: '#cbdcf5', borderWidth: 1, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 14, color: palette.ink, fontSize: 16, marginBottom: 20 }} />
    {!search && history.length > 0 && <Card><View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t('搜索历史', 'Search history')}</Text><Pressable onPress={() => setHistory([])}><Text style={{ color: palette.blue }}>{t('清除全部', 'Clear all')}</Text></Pressable></View>{history.map((entry) => <Pressable key={`${entry.scope}:${entry.query}`} onPress={() => { setScope(entry.scope); setQuery(entry.query); }} style={{ paddingVertical: 9, flexDirection: 'row', gap: 9 }}><Text style={{ color: palette.muted }}>◷</Text><Text numberOfLines={1} style={{ color: palette.ink, flex: 1 }}>{entry.query}</Text><Text style={{ color: palette.muted, fontSize: 12 }}>{entry.scope === 'users' ? t('用户', 'User') : t('公开项目', 'Public project')}</Text></Pressable>)}</Card>}
    {scope === 'projects' && !search && <><View style={{ marginTop: 9, marginBottom: 12 }}><Text style={{ color: palette.ink, fontSize: 21, fontWeight: '800' }}>{t('EasyHub 热门', 'EasyHub Popular')}</Text><Text style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>{t('按 Star 数、近期活跃度和更新时间排列公开项目。不是 GitHub 官方 Trending。', 'Public projects ranked by Stars, recent activity and update time. This is not official GitHub Trending.')}</Text></View><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>{periods.map((item) => <Choice key={item.id} title={t(...item.title)} selected={period === item.id} onPress={() => { setPeriod(item.id); setPage(1); }} />)}</View></>}
    {searching && <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }}><Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800' }}>{scope === 'users' ? t('用户搜索结果', 'User results') : t('公开项目搜索结果', 'Public project results')}</Text><View style={{ flexDirection: 'row', gap: 5 }}><Choice title={t('精简', 'Compact')} selected={displayMode === 'compact'} onPress={() => setDisplayMode('compact')} /><Choice title={t('详细', 'Detailed')} selected={displayMode === 'detailed'} onPress={() => setDisplayMode('detailed')} /></View></View>}
    {!!search && !searching && <Text style={{ color: palette.muted }}>{t('输入至少 2 个字符，开始搜索。', 'Enter at least 2 characters to search.')}</Text>}
    {scope === 'users' && !search && <Text style={{ color: palette.muted }}>{t('输入至少 2 个字符，搜索 GitHub 用户。', 'Enter at least 2 characters to search GitHub users.')}</Text>}
    {busy && (searching || scope === 'projects' && !search) && <Loading />}{!!error && (searching || scope === 'projects' && !search) && <ErrorText message={error} onRetry={() => setRefreshKey((value) => value + 1)} />}
    {!busy && !error && scope === 'projects' && (!search || searching) && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {visibleRepos.map((repo, index) => <OpenRepo key={repo.id} repo={repo} compact={searching && displayMode === 'compact'} rank={searching ? undefined : (page - 1) * 30 + index + 1} trend={searching ? undefined : starTrend(repo, observations, period, observedAt)} width={itemWidth} />)}
      {visibleRepos.length === 0 && <Text style={{ color: palette.muted }}>{searching ? t('没有找到公开项目。', 'No public projects found.') : t('暂时没有符合条件的热门项目。', 'No popular projects found yet.')}</Text>}
    </View>}
    {!busy && !error && scope === 'users' && searching && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {users.map((item) => <OpenUser key={item.id} user={item} compact={displayMode === 'compact'} width={userWidth} topRepos={topRepos[item.login]} />)}
      {users.length === 0 && <Text style={{ color: palette.muted }}>{t('没有找到用户。', 'No users found.')}</Text>}
    </View>}
    {scope === 'projects' && !search && !busy && !error && (page > 1 || trending?.hasNextPage) && <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <Choice title={t('上一页', 'Previous')} selected={false} onPress={() => setPage((value) => Math.max(1, value - 1))} /><Text style={{ color: palette.muted }}>{t('第', 'Page ')} {page} {t('页', '')}</Text>{trending?.hasNextPage && <Choice title={t('下一页', 'Next')} selected={false} onPress={() => setPage((value) => value + 1)} />}
    </View>}
    {scope === 'projects' && !search && <Text style={{ color: palette.muted, fontSize: 12, marginTop: 19 }}>{t('近期增长需持续观察，首次收录时显示“增长观察中”。', 'Recent growth requires observation. New projects show “Observing growth”.')}</Text>}
  </Page>;
}
