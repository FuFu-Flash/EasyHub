import { useSessionReadFocusEffect } from '@/features/auth/useSessionReadFocusEffect';
import { friendlyGitHubError } from '@/features/localization/githubError';
import type { StaticMessageKey } from '@/features/localization';
import { useTranslation } from '@/features/localization/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { type GitHubClient, type GitHubRepo, type GitHubSearchPage, type GitHubSearchUser, type TrendingPage, type TrendingPeriod } from '@easyhub/github';
import { useSession } from '@/features/auth/session';

import { type SearchEntry, type SearchScope, parseSearchHistory, rememberSearch } from '@/features/github/searchHistory';
import { recordObservations, starTrend, type StarObservations } from '@/features/github/starObservations';
import { loadStarObservations, saveStarObservations } from '@/features/github/starObservationStore';
import { parseProjectAddress } from '@/features/github/projectAddress';
import { Action, Card, DirectionLabel, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';
import { usePullRefresh } from '@/features/github/usePullRefresh';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';

type DisplayMode = 'compact' | 'detailed';
const periods: { id: TrendingPeriod; title: StaticMessageKey }[] = [
  { id: 'today', title: "discover.today" }, { id: 'week', title: "discover.thisWeek" }, { id: 'month', title: "discover.thisMonth" },
];
const trendingCache = new Map<string, { at: number; value: TrendingPage }>();

async function readUserProjects(client: GitHubClient, users: GitHubSearchUser[], signal: AbortSignal) {
  const projects: Record<string, GitHubRepo[]> = {};
  for (let index = 0; index < users.length && !signal.aborted; index += 2) {
    await Promise.all(users.slice(index, index + 2).map(async (user) => {
      try { projects[user.login] = await client.topStarredRepos(user.login, signal); }
      catch { if (!signal.aborted) projects[user.login] = []; }
    }));
  }
  return projects;
}

function Choice({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{ maxWidth: '100%', minWidth: 0, flexShrink: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 11, backgroundColor: selected ? '#e7f0ff' : '#fff', borderWidth: 1, borderColor: selected ? '#a8cbff' : palette.border }}>
    <Text style={{ color: selected ? '#166ee7' : '#52637c', fontWeight: '700', textAlign: 'center' }}>{title}</Text>
  </Pressable>;
}

function OpenRepo({ repo, compact, rank, trend, width }: { repo: GitHubRepo; compact: boolean; rank?: number; trend?: string; width: number }) {
  const t = useTranslation();
  return <Pressable accessibilityRole="button" accessibilityLabel={t("discover.viewNamedPublicProject", { name: repo.full_name })} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, mode: 'public' } })} style={{ width }}>
    <Card style={{ minHeight: compact ? 126 : 178, marginBottom: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {typeof rank === 'number' && <Text style={{ fontSize: 13, color: palette.blue, fontWeight: '800' }}>#{rank}</Text>}
        {repo.owner.avatar_url ? <Image source={{ uri: repo.owner.avatar_url }} style={{ width: 34, height: 34, borderRadius: 10 }} /> : <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#e8f2ff', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.blue, fontWeight: '800' }}>{repo.owner.login[0]?.toUpperCase()}</Text></View>}
        <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ fontWeight: '800', color: palette.ink, fontSize: 16 }}>{repo.name}</Text><Text numberOfLines={1} style={{ color: palette.muted, fontSize: 12 }}>{repo.owner.login}</Text></View>
      </View>
      {!compact && <Text numberOfLines={3} style={{ color: '#52647e', marginTop: 12, lineHeight: 20 }}>{repo.description || t("discover.noDescriptionYet")}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 13 }}>
        {!compact && <Text style={{ color: palette.muted, fontSize: 12 }}>{repo.language || t("discover.languageNotListed")}</Text>}
        <Text style={{ color: palette.muted, fontSize: 12 }}>★ {(repo.stargazers_count ?? 0).toLocaleString()}</Text>
        {trend && <Text style={{ color: palette.muted, fontSize: 12 }}>{trend}</Text>}
      </View>
    </Card>
  </Pressable>;
}

function OpenUser({ user, compact, width, topRepos }: { user: GitHubSearchUser; compact: boolean; width: number; topRepos?: GitHubRepo[] }) {
  const t = useTranslation();
  return <View style={{ width }}><Card style={{ marginBottom: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("discover.viewNamedProfile", { name: user.login })} onPress={() => router.push({ pathname: '/profile/[login]', params: { login: user.login } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      <Image source={{ uri: user.avatar_url }} style={{ width: 42, height: 42, borderRadius: 14 }} />
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: palette.ink, fontWeight: '800', fontSize: 16 }}>{user.login}</Text><Text style={{ color: palette.muted, fontSize: 12 }}>{t("PullRequestsPanel.githubUser")}</Text></View>
    </Pressable>
    {!compact && <View style={{ marginTop: 15, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12 }}>
      <Text style={{ color: palette.muted, fontSize: 12, marginBottom: 8 }}>{t("discover.top3PublicProjectsByStar")}</Text>
      {topRepos === undefined ? <Text style={{ color: palette.muted, fontSize: 12 }}>{t("discover.loadingProjects")}</Text> : topRepos.length ? topRepos.map((repo) => <Pressable key={repo.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, mode: 'public' } })} style={{ paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text numberOfLines={1} style={{ flex: 1, color: palette.ink }}>{repo.name}</Text><Text style={{ color: palette.muted }}>★ {(repo.stargazers_count ?? 0).toLocaleString()}</Text></Pressable>) : <Text style={{ color: palette.muted, fontSize: 12 }}>{t("discover.noPublicProjectsToShow")}</Text>}
    </View>}
    <Pressable onPress={() => router.push({ pathname: '/profile/[login]', params: { login: user.login } })} accessibilityRole="button" style={{ marginTop: 13, minHeight: 48, minWidth: 48, justifyContent: 'center' }}><DirectionLabel title={t("discover.viewProfile")} name="forward" color={palette.blue} textStyle={{ fontWeight: '700' }} /></Pressable>
  </Card></View>;
}

export default function Discover() {
  const { client, ready, user } = useSession();
  const t = useTranslation();
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const contentWidth = Math.max(0, screenWidth - insets.left - insets.right - 44);
  const compactWidth = contentWidth >= 320 && fontScale <= 1.2 ? (contentWidth - 10) / 2 : contentWidth;
  const [scope, setScope] = useState<SearchScope>('projects');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<TrendingPeriod>('today');
  const [page, setPage] = useState(1);
  const [searchPage, setSearchPage] = useState(1);
  const [searchResult, setSearchResult] = useState<Omit<GitHubSearchPage<never>, 'items'> | null>(null);
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
  const { value: error, set: setError, capture } = usePageFeedback();
  const request = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const scheduled = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailedUsers = useRef<GitHubSearchUser[] | null>(null);
  const displayModeRef = useRef(displayMode);
  const [resultKey, setResultKey] = useState('');
  const search = query.trim();
  const searching = search.length >= 2;
  const address = useMemo(() => scope === 'projects' ? parseProjectAddress(search) : null, [scope, search]);
  const historyKey = user ? `easyhub.discovery.history.${user.id ?? user.login}` : '';
  const targetKey = !search ? `trending:${period}:${page}` : `${scope}:${search}:${searchPage}`;
  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);

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

  const load = useCallback(async (force = false) => {
    request.current?.abort();
    detailRequest.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const active = () => request.current === controller && !controller.signal.aborted;
    if (!client || !(scope === 'projects' && !search || searching && !address)) {
      setBusy(false); setError('');
      return;
    }
    setBusy(true); setError('');
    try {
      if (!search) {
        const key = `${period}:${page}`;
        const cached = trendingCache.get(key);
        const useCached = !force && cached && Date.now() - cached.at < 600000;
        const value = useCached ? cached.value : await client.trending(period, page, controller.signal);
        if (!active()) return;
        if (!useCached) trendingCache.set(key, { at: Date.now(), value });
        setTrending(value); setResultKey(targetKey);
        if (!useCached && user?.login) {
          const previous = await loadStarObservations(user.login).catch(() => ({}));
          if (!active()) return;
          const updated = recordObservations(previous, value.items, Date.now());
          await saveStarObservations(user.login, updated).catch(() => undefined);
          if (active()) { setObservations(updated); setObservedAt(Date.now()); }
        }
      } else {
        const result = scope === 'projects' ? await client.searchPublicReposPage(search, searchPage, controller.signal) : await client.searchUsersPage(search, searchPage, controller.signal);
        if (!active()) return;
        if (scope === 'projects') setRepos(result.items as GitHubRepo[]);
        else {
          const items = result.items as GitHubSearchUser[];
          const details = displayModeRef.current === 'detailed' ? await readUserProjects(client, items, controller.signal) : null;
          if (!active()) return;
          detailedUsers.current = details ? items : null;
          setUsers(items); setTopRepos(details ?? {});
        }
        setSearchResult({ page: result.page, totalCount: result.totalCount, hasNextPage: result.hasNextPage, incompleteResults: result.incompleteResults });
        setResultKey(targetKey);
        recordSearch(search, scope);
      }
    } catch (cause) { if (active()) setError(friendlyGitHubError(cause, t)); }
    finally { if (active()) setBusy(false); }
  }, [address, client, page, period, recordSearch, scope, search, searching, searchPage, targetKey, user, setError, t]);
  useSessionReadFocusEffect(useCallback(() => {
    const timer = setTimeout(() => { scheduled.current = null; void load(true); }, searching ? 450 : 0);
    scheduled.current = timer;
    return () => { clearTimeout(timer); scheduled.current = null; request.current?.abort(); };
  }, [load, searching]));
  const { refresh, refreshing } = usePullRefresh([() => {
    if (scheduled.current !== null) { clearTimeout(scheduled.current); scheduled.current = null; }
    return load(true);
  }]);

  const openAddress = async () => {
    if (!client || !address || busy) return;
    setBusy(true); setError('');
    const current = capture();
    try {
      const project = await client.repo(address.owner, address.name);
      if (!current()) return;
      recordSearch(search, scope);
      router.push({ pathname: '/project/[owner]/[repo]', params: { owner: project.owner.login, repo: project.name, ...(project.private ? {} : { mode: 'public' }) } });
    } catch (cause) { if (current()) setError(friendlyGitHubError(cause, t)); }
    finally { setBusy(false); }
  };

  useFocusEffect(useCallback(() => {
    if (!client || scope !== 'users' || displayMode !== 'detailed' || users.length === 0 || resultKey !== targetKey || detailedUsers.current === users) return;
    let active = true;
    const controller = new AbortController();
    detailRequest.current = controller;
    void readUserProjects(client, users, controller.signal).then((projects) => {
      if (active && !controller.signal.aborted && detailRequest.current === controller) {
        detailedUsers.current = users; setTopRepos(projects);
      }
    });
    return () => { active = false; controller.abort(); };
  }, [client, displayMode, resultKey, scope, targetKey, users]));

  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t("discover.discoverSearch")} subtitle={t("discover.signInToExplorePublicProjectsAndGitHubUsers")} /><Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} /></Page>;
  const matchingResult = resultKey === targetKey;
  const visibleRepos = matchingResult ? searching ? repos : trending?.items ?? [] : [];
  const visibleUsers = matchingResult ? users : [];
  const itemWidth = searching && displayMode === 'compact' ? compactWidth : contentWidth;
  const userWidth = displayMode === 'compact' ? compactWidth : contentWidth;
  return <Page refresh={refresh} refreshing={refreshing}>
    <Text style={{ color: palette.blue, fontWeight: '700', marginBottom: 5 }}>{t("discover.exploreMoreCreations")}</Text>
    <Heading title={t("discover.discoverSearch")} subtitle={t("discover.searchPublicProjectsAndGitHubUsersOrSeeWhatPeopleAre")} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}><Choice title={t("discover.projects")} selected={scope === 'projects'} onPress={() => { setScope('projects'); setSearchPage(1); }} /><Choice title={t("discover.users")} selected={scope === 'users'} onPress={() => { setScope('users'); setSearchPage(1); }} /></View>
    <TextInput accessibilityLabel={scope === 'users' ? t("discover.searchUsers") : t("discover.searchPublicProjectsOrPasteAnAddress")} value={query} onChangeText={(value) => { setQuery(value); setSearchPage(1); }} onSubmitEditing={() => { if (address) void openAddress(); }} autoCorrect={false} autoCapitalize="none" returnKeyType="search" placeholder={scope === 'users' ? t("discover.searchGitHubUsers") : t("discover.searchPublicProjectsOrPasteAGitHubAddress")} style={{ backgroundColor: '#fff', borderColor: '#cbdcf5', borderWidth: 1, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 14, color: palette.ink, fontSize: 16, marginBottom: 20 }} />
    {address && <Card><Text style={{ color: palette.ink, fontWeight: '800', marginBottom: 12 }}>{address.owner}/{address.name}</Text><Action title={t("discover.openThisProject")} disabled={busy} onPress={() => { void openAddress(); }} /></Card>}
    {!search && history.length > 0 && <Card><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 10 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t("discover.searchHistory")}</Text><Pressable onPress={() => setHistory([])}><Text style={{ color: palette.blue }}>{t("discover.clearAll")}</Text></Pressable></View>{history.map((entry) => <Pressable key={`${entry.scope}:${entry.query}`} onPress={() => { setScope(entry.scope); setQuery(entry.query); setSearchPage(1); }} style={{ paddingVertical: 9, flexDirection: 'row', gap: 9 }}><Text style={{ color: palette.muted }}>◷</Text><Text numberOfLines={1} style={{ color: palette.ink, flex: 1 }}>{entry.query}</Text><Text style={{ color: palette.muted, fontSize: 12 }}>{entry.scope === 'users' ? t("discover.user") : t("discover.publicProject")}</Text></Pressable>)}</Card>}
    {scope === 'projects' && !search && <><View style={{ marginTop: 9, marginBottom: 12 }}><Text style={{ color: palette.ink, fontSize: 21, fontWeight: '800' }}>{t("discover.easyhubPopular")}</Text><Text style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>{t("discover.publicProjectsRankedByStarsRecentActivityAndUpdateTimeThis")}</Text></View><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>{periods.map((item) => <Choice key={item.id} title={t(item.title)} selected={period === item.id} onPress={() => { setPeriod(item.id); setPage(1); }} />)}</View></>}
    {searching && <View style={{ gap: 10, marginBottom: 13 }}><Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800' }}>{scope === 'users' ? t("discover.userResults") : t("discover.publicProjectResults")}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}><Choice title={t("discover.compact")} selected={displayMode === 'compact'} onPress={() => setDisplayMode('compact')} /><Choice title={t("discover.detailed")} selected={displayMode === 'detailed'} onPress={() => setDisplayMode('detailed')} /></View></View>}
    {!!search && !searching && <Text style={{ color: palette.muted }}>{t("discover.enterAtLeast2CharactersToSearch")}</Text>}
    {scope === 'users' && !search && <Text style={{ color: palette.muted }}>{t("discover.enterAtLeast2CharactersToSearchGitHubUsers")}</Text>}
    {busy && !refreshing && (searching || scope === 'projects' && !search) && <Loading />}{!!error && (searching || scope === 'projects' && !search) && <ErrorText message={error} onRetry={refresh} />}
    {!address && scope === 'projects' && (!search || searching) && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {visibleRepos.map((repo, index) => <OpenRepo key={repo.id} repo={repo} compact={searching && displayMode === 'compact'} rank={searching ? undefined : (page - 1) * 30 + index + 1} trend={searching ? undefined : starTrend(repo, observations, period, observedAt)} width={itemWidth} />)}
      {!busy && !error && matchingResult && visibleRepos.length === 0 && <Text style={{ color: palette.muted }}>{searching ? t("discover.noPublicProjectsFound") : t("discover.noPopularProjectsFoundYet")}</Text>}
    </View>}
    {scope === 'users' && searching && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {visibleUsers.map((item) => <OpenUser key={item.id} user={item} compact={displayMode === 'compact'} width={userWidth} topRepos={topRepos[item.login]} />)}
      {!busy && !error && matchingResult && visibleUsers.length === 0 && <Text style={{ color: palette.muted }}>{t("discover.noUsersFound")}</Text>}
    </View>}
    {searching && !address && matchingResult && !busy && !error && searchResult && <View style={{ gap: 12, marginTop: 16 }}>
      <Text style={{ color: palette.muted }}>{t("discover.matches")}: {searchResult.totalCount.toLocaleString()}{searchResult.totalCount > 1000 ? t("discover.githubAllowsBrowsingTheFirst1000Results") : ''}</Text>
      {searchResult.incompleteResults && <Text style={{ color: palette.muted }}>{t("discover.githubReturnedIncompleteResultsTryANarrowerSearch")}</Text>}
      {(searchPage > 1 || searchResult.hasNextPage) && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        {searchPage > 1 && <Choice title={t("discover.previous")} selected={false} onPress={() => setSearchPage((value) => value - 1)} />}
        <Text style={{ color: palette.muted }}>{t("discover.page")} {searchPage} {t("discover.message")}</Text>
        {searchResult.hasNextPage && <Choice title={t("discover.next")} selected={false} onPress={() => setSearchPage((value) => value + 1)} />}
      </View>}
    </View>}
    {scope === 'projects' && !search && matchingResult && !busy && !error && (page > 1 || trending?.hasNextPage) && <View style={{ marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <Choice title={t("discover.previous")} selected={false} onPress={() => setPage((value) => Math.max(1, value - 1))} /><Text style={{ color: palette.muted }}>{t("discover.page")} {page} {t("discover.message")}</Text>{trending?.hasNextPage && <Choice title={t("discover.next")} selected={false} onPress={() => setPage((value) => value + 1)} />}
    </View>}
    {scope === 'projects' && !search && <Text style={{ color: palette.muted, fontSize: 12, marginTop: 19 }}>{t("discover.recentGrowthRequiresObservationNewProjectsShowObservingGrowth")}</Text>}
  </Page>;
}
