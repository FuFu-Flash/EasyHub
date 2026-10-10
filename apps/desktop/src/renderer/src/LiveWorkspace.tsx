import { SegmentedControl } from './components/SegmentedControl';
import { AppUpdatePanel } from './components/AppUpdatePanel';
import { createDraftKey, removeDraft } from './draftStore';
import { useLocalDraft } from './useLocalDraft';
import { PagedContinuation } from './components/PagedContinuation';
import { DiscussionSearch, useDiscussionSearchState } from './components/DiscussionSearch';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { GitHubActivityCount, GitHubComment, GitHubCommit, GitHubIssue, GitHubIssuePage, GitHubPullRequest, GitHubRelease, GitHubRepo, GitHubSearchPage, GitHubSearchUser, GitHubUser, TrendingPeriod } from '@easyhub/github';
import type { CreateReleaseInput, LocalProjectLink, LocalProjectStatus, ProjectRelease, ReleaseProgress, ReleaseMutationFailure, SyncPreview, TranslationTargetLanguage } from '@easyhub/types';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, CloudDownload, Compass, Folder, FolderOpen, Globe2, Home, Info, Languages, LockKeyhole, MessageCircle, Minus, Pencil, Plus, RotateCw, Search, Send, Settings2, Square, Tag, X } from 'lucide-react';
import appIcon from './assets/easyhub-icon.svg';
import { LocalWorkspace } from './LocalWorkspace';
import { IntroductionEditor } from './components/IntroductionEditor';
import { ReadmeMarkdown } from './components/ReadmeMarkdown';
import { LiveProjectDangerZone } from './components/LiveProjectDangerZone';
import { PublicProjectBrowser } from './components/PublicProjectBrowser';
import { PullRequestsPanel } from './components/PullRequestsPanel';
import { PullReviewGroups } from './components/PullReviewGroups';
import { AiSettingsPanel } from './components/AiSettingsPanel';
import { HostsRepairPanel } from './components/HostsRepairPanel';
import { ForkContributionPanel } from './components/ForkContributionPanel';
import { ForksOverview } from './components/ForksOverview';
import { LocalDiscoveryPanel } from './components/LocalDiscoveryPanel';
import { ReleaseDownloads } from './components/ReleaseDownloads';
import { ReleaseEditor } from './components/ReleaseEditor';
import { DownloadNotifications, type ActivityNotice } from './components/DownloadNotifications';
import { DashboardIntro } from './components/DashboardIntro';
import { StyledDropdown } from './components/StyledDropdown';
import { ProfileMenu } from './components/ProfileMenu';
import { StarredProjects } from './components/StarredProjects';
import { StarProjectButton } from './components/StarProjectButton';
import { TranslationPreferencesContext } from './components/TranslatableContent';
import { TranslatableContent } from './components/TranslatableContent';
import { readmeReleaseLink } from './components/readmeReleaseLink';
import { useDownloadCenter } from './components/useDownloadCenter';
import { UserProfile } from './components/UserProfile';
import { TrendingDiscover, type DiscoverScope, type SearchDisplayMode } from './components/TrendingDiscover';
import { SearchPagination } from './components/SearchPagination';
import { createDomLocalizer, readLanguage, type Language } from './i18n';
import { historyKey, readSearchHistory, rememberSearch, type SearchEntry, type SearchScope } from './searchHistory';
import { publicBookmarksKey, readPublicBookmarks } from './publicBookmarks';
import { parseProjectAddress } from './projectAddress';
import { projectPresentation } from './projectPresentation';
import { LayoutSettingsPanel } from './components/LayoutSettingsPanel';
import { useLayoutPreference } from './layoutPreferences';
import { NavigationPages } from './components/NavigationPages';
import { SearchEmptyState } from './components/SearchEmptyState';
import { SearchHistory } from './components/SearchHistory';
import { usePageScroll } from './usePageScroll';
import { usePageHistory } from './usePageHistory';

type View = 'home' | 'projects' | 'discover' | 'profile' | 'starred' | 'project' | 'public-project' | 'downloads' | 'new-release' | 'issues' | 'issue' | 'pulls' | 'history' | 'recent-history' | 'version' | 'new-project' | 'local' | 'settings';
type Action = 'repos' | 'activityCounts' | 'searchPublicReposPage' | 'publicRepo' | 'repository' | 'createRepo' | 'readme' | 'issues' | 'issuesPage' | 'createIssue' | 'updateIssue' | 'comments' | 'createComment' | 'commits' | 'commit';

function api<T>(action: Action, ...args: unknown[]): Promise<T> {
  if (!window.easyHub) return Promise.reject(new Error('应用连接不可用，请重新启动 EasyHub。'));
  return window.easyHub.github<T>(action, ...args);
}

function message(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请稍后重试。'; }
function ownerOf(repo: GitHubRepo): string { return repo.owner.login; }
function RepoLogo({ repo, small = false }: { repo: GitHubRepo; small?: boolean }) {
  const color = ['logo-lilac', 'logo-peach', 'logo-mint', 'logo-sky'][repo.id % 4];
  return <span className={`project-logo ${small ? 'project-logo-small' : ''} ${color}`} aria-hidden="true">{repo.name.slice(0, 1).toUpperCase()}</span>;
}
function IssueListTitle({ issue, repo, automatic, target, names }: {
  issue: GitHubIssue; repo: GitHubRepo; automatic: boolean; target: TranslationTargetLanguage; names: string[];
}) {
  if (repo.private) return <strong>{issue.title}</strong>;
  return <TranslationPreferencesContext.Provider value={{ automatic, target, repository: { name: repo.name, owner: repo.owner.login, fullName: repo.full_name }, names }}>
    <TranslatableContent text={issue.title} format="text" protectedNames={issue.user?.login ? [issue.user.login] : []} render={(value) => <strong>{value}</strong>} />
  </TranslationPreferencesContext.Provider>;
}
function relativeDate(value: string, language: Language): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return language === 'en' ? 'Just now' : '刚刚';
  if (minutes < 60) return language === 'en' ? `${minutes} minutes ago` : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return language === 'en' ? `${hours} hours ago` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return language === 'en' ? `${days} days ago` : `${days} 天前`;
}

export function LiveWorkspace({ user, onLogout }: { user: GitHubUser; onLogout: () => void }) {
  const layout = useLayoutPreference();
  const [view, setView] = useState<View>('home');
  const [pageRevisions, setPageRevisions] = useState<Record<string, number>>({});
  const unavailableRepos = useRef(new Set<number>());
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selected, setSelected] = useState<GitHubRepo | null>(null);
  const [pullReturn, setPullReturn] = useState<GitHubRepo | null>(null);
  const [pullInitialRequest, setPullInitialRequest] = useState<GitHubPullRequest | null>(null);
  const [activityCounts, setActivityCounts] = useState<Record<number, GitHubActivityCount>>({});
  const [activityError, setActivityError] = useState('');
  const [publicSelected, setPublicSelected] = useState<GitHubRepo | null>(null);
  const [publicInitialDownload, setPublicInitialDownload] = useState<{ tag?: string } | null>(null);
  const [publicBackBoundary, setPublicBackBoundary] = useState<string | null>(null);
  const publicPageKeys = useRef(new Map<number, string>());
  const [downloadFocusTag, setDownloadFocusTag] = useState<string | undefined>();
  const [editReleaseOnOpen, setEditReleaseOnOpen] = useState(false);
  const [releaseHistory, setReleaseHistory] = useState<ProjectRelease[]>([]);
  const [releaseImages, setReleaseImages] = useState<Record<string, string>>({});
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseProgress, setReleaseProgress] = useState<ReleaseProgress | null>(null);
  const [releaseFailures, setReleaseFailures] = useState<Record<number, ReleaseMutationFailure<unknown> | undefined>>({});
  const releaseFailure = selected ? releaseFailures[selected.id] ?? null : null;
  const releaseSubmitting = useRef(false);
  const [publicReturnView, setPublicReturnView] = useState<'projects' | 'discover' | 'profile' | 'starred'>('discover');
  const [profileUser, setProfileUser] = useState<GitHubUser>(user);
  const [profileReturnView, setProfileReturnView] = useState<'home' | 'discover'>('home');
  const [starredReturnView, setStarredReturnView] = useState<View>('home');
  const [starredRefresh, setStarredRefresh] = useState(0);
  const [starredOriginProjectId, setStarredOriginProjectId] = useState<number | null>(null);
  const [savedPublicRepos, setSavedPublicRepos] = useState<GitHubRepo[]>(() => readPublicBookmarks(window.localStorage, user.login));
  const [readme, setReadme] = useState('');
  const [localLinks, setLocalLinks] = useState<LocalProjectLink[]>([]);
  const [localStatuses, setLocalStatuses] = useState<Record<string, LocalProjectStatus>>({});
  const [remotePreviews, setRemotePreviews] = useState<Record<string, SyncPreview>>({});
  const [checkingLocal, setCheckingLocal] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, boolean>>({});
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  const [introductionLoading, setIntroductionLoading] = useState(false);
  const [introductionError, setIntroductionError] = useState('');
  const [recentUpdates, setRecentUpdates] = useState<{ repo: GitHubRepo; commit: GitHubCommit }[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState('');
  const [homeUpdateMessage, setHomeUpdateMessage] = useState('');
  const [homeSyncReview, setHomeSyncReview] = useState<{ id: string; preview: SyncPreview; message: string } | null>(null);
  const [introEditing, setIntroEditing] = useState(false);
  const [introExpected, setIntroExpected] = useState('');
  const [introSaving, setIntroSaving] = useState(false);
  const [introError, setIntroError] = useState('');
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [issue, setIssue] = useState<GitHubIssue | null>(null);
  const [expandedRepo, setExpandedRepo] = useState<number | null>(null);
  const [issueGroups, setIssueGroups] = useState<Record<number, GitHubIssue[]>>({});
  const [issueNextPages, setIssueNextPages] = useState<Record<number, number | null>>({});
  const [loadingMoreIssues, setLoadingMoreIssues] = useState(false);
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>('open');
  const [showOtherIssueRepos, setShowOtherIssueRepos] = useState(false);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [issueReadBusy, setIssueReadBusy] = useState(false);
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [historyRefresh, setHistoryRefresh] = useState<Record<number, number>>({});
  const [commit, setCommit] = useState<GitHubCommit | null>(null);
  const [versionReturnView, setVersionReturnView] = useState<'history' | 'recent-history'>('history');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshIcon = useRef<SVGSVGElement>(null);
  const [refreshError, setRefreshError] = useState('');
  const refreshInFlight = useRef(false);
  const [canCancel, setCanCancel] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, updateSearch] = useState('');
  const [searchScope, updateSearchScope] = useState<SearchScope>('mine');
  const [discoverScope, updateDiscoverScope] = useState<DiscoverScope>('projects');
  const [discoverPeriod, setDiscoverPeriod] = useState<TrendingPeriod>('today');
  const [discoverPage, setDiscoverPage] = useState(1);
  const [searchDisplayMode, setSearchDisplayMode] = useState<SearchDisplayMode>(() => window.localStorage.getItem('easyhub:search-display-mode') === 'detailed' ? 'detailed' : 'compact');
  const [searchHistory, setSearchHistory] = useState(() => readSearchHistory(window.localStorage, user.login));
  const [publicRepos, setPublicRepos] = useState<GitHubRepo[]>([]);
  const [publicSearchPage, setPublicSearchPage] = useState(1);
  const [publicSearchTotalCount, setPublicSearchTotalCount] = useState<number | null>(null);
  const [publicSearchHasNextPage, setPublicSearchHasNextPage] = useState(false);
  const [publicSearchBusy, setPublicSearchBusy] = useState(false);
  const [publicSearchError, setPublicSearchError] = useState('');
  function setSearch(value: string): void { if (value !== search) setPublicSearchPage(1); updateSearch(value); }
  function setSearchScope(value: SearchScope): void { if (value !== searchScope) setPublicSearchPage(1); updateSearchScope(value); }
  function setDiscoverScope(value: DiscoverScope): void { if (value !== discoverScope) setPublicSearchPage(1); updateDiscoverScope(value); }
  function changeSearchPage(page: number): void {
    setPublicSearchPage(page); discoverScrollPosition.current = null;
    scrollArea.current?.scrollTo({ top: 0 });
  }
  const replyKey = createDraftKey(user.login, selected?.full_name ?? '', 'reply', issue?.number ?? 'none');
  const [reply, setReply, clearReply] = useLocalDraft(replyKey);
  const [issueSearch, changeIssueSearch] = useDiscussionSearchState(user.login, `own:${selected ? `${selected.id}:${selected.full_name}` : 'all'}:issue`);
  const issueSearchActive = Boolean(issueSearch.query);
  const issueReturnProject = useRef<GitHubRepo | null>(null);
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [windowStyle, setWindowStyle] = useState<'windows' | 'reference'>(() => window.localStorage.getItem('easyhub:window-control-style') === 'reference' ? 'reference' : 'windows');
  const [automaticTranslation, setAutomaticTranslation] = useState(() => window.localStorage.getItem('easyhub:auto-translate') === 'true');
  const [translationTarget, setTranslationTarget] = useState<TranslationTargetLanguage>(() => window.localStorage.getItem('easyhub:translation-target') === 'en' ? 'en' : 'zh-CN');
  const [translationNamesText, setTranslationNamesText] = useState(() => window.localStorage.getItem(`easyhub:translation-names:${user.login}`) ?? '');
  const translationNames = useMemo(() => [...new Set(translationNamesText.split(/[,\n]/u).map((name) => name.trim()).filter((name) => name.length >= 2 && name.length <= 80))].slice(0, 100), [translationNamesText]);
  const issueAuthorNames = [issue?.user?.login, ...comments.map((item) => item.user?.login)].filter((name): name is string => Boolean(name));
  const issuePagingRepo = selected ?? repos.find((repo) => repo.id === expandedRepo) ?? null;
  const [canScrollDown, setCanScrollDown] = useState(false);
  const date = (value: string): string => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const appRoot = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const discoverScrollPosition = useRef<number | null>(null);
  const focusDiscoverSearch = useRef(false);
  const localizer = useRef(createDomLocalizer());
  const cancelled = useRef(false);
  const projectLoad = useRef(0);
  const issueLoad = useRef(0);
  const issueDataGeneration = useRef(0);
  const staleIssueGroups = useRef(new Set<number>());
  const issueContext = useRef<string | null>(null);
  const selectedRepoId = useRef<number | null>(null);
  const currentView = useRef<View>(view);
  const nav = view === 'issue' || view === 'issues' || view === 'pulls' ? 'issues' : view === 'settings' ? 'settings' : view === 'home' ? 'home' : view === 'discover' || view === 'public-project' && publicReturnView === 'discover' ? 'discover' : view === 'profile' || view === 'starred' || view === 'public-project' && (publicReturnView === 'profile' || publicReturnView === 'starred') ? 'profile' : 'projects';
  const navigationKey = JSON.stringify([view,
    view === 'public-project' ? publicSelected?.id : view === 'profile' ? profileUser.login
      : ['project', 'local', 'issue', 'issues', 'history', 'version', 'new-release', 'downloads', 'pulls'].includes(view) ? selected?.id : null,
    view === 'local' ? selectedLocalId : null, view === 'issue' ? issue?.id : view === 'version' ? commit?.sha : null,
    view === 'downloads' ? downloadFocusTag : view === 'public-project' ? publicInitialDownload : null]);
  const pageKey = `${navigationKey}:${view === 'projects' || view === 'discover' ? `${searchScope}:${discoverScope}:${search}:${publicSearchPage}:${discoverPage}:${discoverPeriod}` : ''}`;
  const rememberPage = usePageScroll(pageKey, scrollArea);
  const navigationSnapshots = useRef(new Map<string, () => void>());
  const previousIssueProject = issueReturnProject.current;
  const restoreCurrentPage = (): void => {
    projectLoad.current++; issueLoad.current++;
    if (selected && unavailableRepos.current.has(selected.id)) {
      setSelected(null); setView('projects'); return;
    }
    setBusy(false); setCanCancel(false); setError('');
    setView(view); setSelected(selected); setSelectedLocalId(selectedLocalId);
    setPublicSelected(publicSelected); setPublicReturnView(publicReturnView); setPublicInitialDownload(publicInitialDownload);
    setPublicBackBoundary(publicBackBoundary);
    setPullReturn(pullReturn); setPullInitialRequest(pullInitialRequest);
    setDownloadFocusTag(downloadFocusTag); setEditReleaseOnOpen(editReleaseOnOpen);
    setProfileUser(profileUser); setProfileReturnView(profileReturnView); setStarredReturnView(starredReturnView); setStarredOriginProjectId(starredOriginProjectId);
    updateSearch(search); updateSearchScope(searchScope); updateDiscoverScope(discoverScope);
    setPublicSearchPage(publicSearchPage); setDiscoverPage(discoverPage); setDiscoverPeriod(discoverPeriod);
    setIssue(issue); setIssueFilter(issueFilter); setExpandedRepo(expandedRepo); setShowOtherIssueRepos(showOtherIssueRepos);
    setReadme(readme); setIssues(issues); setCommits(commits); setCommit(commit); setComments(comments);
    setReleaseHistory(releaseHistory); setReleaseImages(releaseImages);
    setIntroductionLoading(false); setIntroductionError(introductionError); setVersionReturnView(versionReturnView);
    issueReturnProject.current = previousIssueProject;
    if (view === 'project' && selected && introductionLoading) void openProject(selected, selectedLocalId);
    if (view === 'issue' && selected && issue && issueReadBusy) {
      const request = ++issueLoad.current;
      setIssueReadBusy(true);
      void api<GitHubComment[]>('comments', ownerOf(selected), selected.name, issue.number)
        .then((items) => { if (request === issueLoad.current && selectedRepoId.current === selected.id) setComments(items); })
        .catch((cause: unknown) => { if (request === issueLoad.current) setError(message(cause)); })
        .finally(() => { if (request === issueLoad.current) setIssueReadBusy(false); });
    }
  };
  const pageHistory = usePageHistory(navigationKey, restoreCurrentPage);
  const goBack = (fallback: () => void): void => { rememberPage(); pageHistory.back(fallback); };

  function navigateSidebar(next: 'home' | 'projects' | 'discover' | 'issues' | 'settings'): void {
    if (next === nav) {
      rememberPage();
      if (next === 'issues') setSelected(null);
      setView(next); return;
    }
    rememberPage();
    navigationSnapshots.current.set(nav, () => {
      restoreCurrentPage();
      if (view === 'public-project' && publicSelected) setPublicBackBoundary(publicPageKeys.current.get(publicSelected.id) ?? null);
    });
    const restore = navigationSnapshots.current.get(next);
    if (restore) { restore(); return; }
    if (next === 'projects' || next === 'discover') setSearch('');
    if (next === 'discover') setSearchScope('public');
    if (next === 'issues') setSelected(null);
    setView(next);
  }

  useLayoutEffect(() => {
    selectedRepoId.current = selected?.id ?? null;
    issueContext.current = view === 'issue' ? replyKey : null;
    if (view !== 'issue') { issueLoad.current++; setIssueReadBusy(false); }
  }, [view, replyKey, selected?.id]);

  useLayoutEffect(() => {
    currentView.current = view;
    setError('');
  }, [view]);

  useLayoutEffect(() => {
    if (view !== 'discover' || !focusDiscoverSearch.current) return;
    focusDiscoverSearch.current = false;
    const input = appRoot.current?.querySelector<HTMLInputElement>('.discover-search input');
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [view]);

  function continueSearch(value: string): void {
    setSearch(value);
    if (!value.trim()) return;
    focusDiscoverSearch.current = true;
    rememberDiscoverPosition(); setSearchScope('public'); setView('discover');
  }

  useEffect(() => window.easyHub?.onReleaseProgress((value) => setReleaseProgress(value)), []);

  const recordSearch = useCallback((query: string, scope: SearchScope) => {
    if (!query.trim() || ((scope === 'public' || scope === 'users') && query.trim().length < 2)) return;
    setSearchHistory((current) => {
      const next = rememberSearch(current, query, scope);
      window.localStorage.setItem(historyKey(user.login), JSON.stringify(next));
      return next;
    });
  }, [user.login]);
  const recordUserSearch = useCallback((query: string) => recordSearch(query, 'users'), [recordSearch]);
  function selectSearchHistory(entry: SearchEntry): void {
    if (parseProjectAddress(entry.query)) { void openProjectAddress(entry.query); return; }
    setSearch(entry.query);
    if (entry.scope === 'users' || entry.scope === 'public') {
      setDiscoverScope(entry.scope === 'users' ? 'users' : 'projects'); setSearchScope('public'); setView('discover');
    } else { setSearchScope(entry.scope); setView('projects'); }
  }
  function clearSearchHistory(): void { setSearchHistory([]); window.localStorage.removeItem(historyKey(user.login)); }
  function openSearchedUser(candidate: GitHubSearchUser): void {
    rememberDiscoverPosition();
    setProfileUser({ id: candidate.id, login: candidate.login, name: null, avatar_url: candidate.avatar_url, html_url: candidate.html_url });
    setProfileReturnView('discover'); setView('profile'); setError('');
  }

  function addPublicProject(repo: GitHubRepo): void {
    setSavedPublicRepos((current) => {
      const next = [repo, ...current.filter((item) => item.id !== repo.id)].slice(0, 50);
      window.localStorage.setItem(publicBookmarksKey(user.login), JSON.stringify(next));
      return next;
    });
  }

  function openPublicProject(repo: GitHubRepo): void {
    rememberDiscoverPosition();
    setPublicBackBoundary(null);
    setPublicReturnView(view === 'profile' ? 'profile' : view === 'discover' ? 'discover' : view === 'starred' ? 'starred' : 'projects');
    setPublicInitialDownload(null); setPublicSelected(repo); setView('public-project'); setError('');
  }
  async function browseForkOriginal(owner: string, name: string): Promise<void> {
    try { openPublicProject(await api<GitHubRepo>('publicRepo', owner, name)); }
    catch (cause) { setError(message(cause)); }
  }
  function openCreatedFork(fork: GitHubRepo): void {
    setRepos((current) => [fork, ...current.filter((item) => item.id !== fork.id)]);
    setSearchScope('forks');
    setNotice('仓库副本已创建。下载到电脑并发布修改后，就可以向原项目提交合并请求。');
    void openProject(fork);
  }
  async function openProjectAddress(value: string): Promise<void> {
    const address = parseProjectAddress(value);
    if (!address) return;
    setPublicSearchError(''); setPublicSearchBusy(true);
    try {
      const known = repos.find((item) => item.owner.login.toLowerCase() === address.owner.toLowerCase() && item.name.toLowerCase() === address.name.toLowerCase());
      const remote = known ?? await api<GitHubRepo>('repository', address.owner, address.name);
      if (remote.owner.login.toLowerCase() === user.login.toLowerCase() || remote.permissions?.push) await openProject(remote);
      else if (!remote.private) openPublicProject(remote);
      else throw new Error('这个项目当前无法浏览。');
      recordSearch(value, 'public');
    } catch (cause) { setError(message(cause)); }
    finally { setPublicSearchBusy(false); }
  }
  function submitProjectSearch(value: string): void {
    if (parseProjectAddress(value)) void openProjectAddress(value);
    else recordSearch(value, discoverScope === 'users' ? 'users' : 'public');
  }
  async function openReadmeLink(url: string, current: GitHubRepo): Promise<void> {
    const release = readmeReleaseLink(url);
    if (!release) {
      try { await window.easyHub?.openExternalLink(url); }
      catch (cause) { setError(message(cause)); }
      return;
    }
    setIntroEditing(false);
    if (release.owner.toLowerCase() === current.owner.login.toLowerCase() && release.repo.toLowerCase() === current.name.toLowerCase()) {
      setDownloadFocusTag(release.tag); setEditReleaseOnOpen(false); setView('downloads'); return;
    }
    const owned = repos.find((item) => item.owner.login.toLowerCase() === release.owner.toLowerCase() && item.name.toLowerCase() === release.repo.toLowerCase());
    if (owned) { setSelected(owned); setDownloadFocusTag(release.tag); setEditReleaseOnOpen(false); setView('downloads'); return; }
    try {
      const remote = await api<GitHubRepo>('publicRepo', release.owner, release.repo);
      setPublicBackBoundary(null);
      if (view !== 'public-project') setPublicReturnView(view === 'profile' ? 'profile' : view === 'discover' ? 'discover' : view === 'starred' ? 'starred' : 'projects');
      setPublicInitialDownload({ tag: release.tag }); setPublicSelected(remote); setView('public-project'); setError('');
    } catch (cause) { setError(message(cause)); }
  }
  async function openProfileRepository(fullName: string): Promise<void> {
    const [owner, name] = fullName.split('/');
    if (!owner || !name) return;
    try { openPublicProject(await api<GitHubRepo>('publicRepo', owner, name)); }
    catch (cause) { setError(message(cause)); }
  }

  function rememberDiscoverPosition(): void {
    rememberPage();
    if (view === 'discover') discoverScrollPosition.current = scrollArea.current?.scrollTop ?? 0;
  }

  function changeDiscoverPage(nextPage: number): void {
    if (nextPage < 1 || nextPage > 34) return;
    setDiscoverPage(nextPage);
    scrollArea.current?.querySelector('.trending-heading')?.scrollIntoView({ block: 'start' });
  }

  useLayoutEffect(() => {
    if (appRoot.current) localizer.current.apply(appRoot.current, language);
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  });
  useEffect(() => {
    const root = appRoot.current;
    if (!root) return;
    const observer = new MutationObserver(() => localizer.current.apply(root, language));
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
    return () => observer.disconnect();
  }, [language]);
  useEffect(() => { window.localStorage.setItem('easyhub:language', language); }, [language]);
  useEffect(() => { window.localStorage.setItem('easyhub:window-control-style', windowStyle); }, [windowStyle]);
  useEffect(() => { window.localStorage.setItem('easyhub:auto-translate', String(automaticTranslation)); }, [automaticTranslation]);
  useEffect(() => { window.localStorage.setItem('easyhub:translation-target', translationTarget); }, [translationTarget]);
  useEffect(() => { window.localStorage.setItem(`easyhub:translation-names:${user.login}`, translationNamesText); }, [translationNamesText, user.login]);
  useEffect(() => { window.localStorage.setItem('easyhub:search-display-mode', searchDisplayMode); }, [searchDisplayMode]);
  useLayoutEffect(() => {
    const area = scrollArea.current;
    if (!area) return;
    const update = (): void => setCanScrollDown(area.scrollTop + area.clientHeight < area.scrollHeight - 3);
    const observer = new ResizeObserver(update);
    let content: Element | null = null;
    const watchContent = (): void => {
      const next = area.querySelector('.page-content');
      if (next !== content) {
        if (content) observer.unobserve(content);
        content = next;
        if (content) observer.observe(content);
      }
      update();
    };
    observer.observe(area);
    const pages = new MutationObserver(watchContent);
    pages.observe(area, { childList: true, subtree: true });
    area.addEventListener('scroll', update, { passive: true });
    watchContent();
    return () => { pages.disconnect(); observer.disconnect(); area.removeEventListener('scroll', update); };
  }, [view, repos, issues, commits, comments, busy]);

  const loadRepos = useCallback(async (background = false): Promise<boolean> => {
    cancelled.current = false;
    if (!background) { setBusy(true); setCanCancel(true); setError(''); }
    try {
      const all: GitHubRepo[] = [];
      for (let page = 1; page <= 100; page++) {
        const batch = await api<GitHubRepo[]>('repos', page);
        all.push(...batch);
        if (!background) setRepos([...all]);
        if (batch.length < 100 || cancelled.current) break;
      }
      if (cancelled.current) return false;
      setRepos(all);
      if (all.length) {
        void api<Record<number, GitHubActivityCount>>('activityCounts', all.map((repo) => ({ id: repo.id, owner: repo.owner.login, name: repo.name })))
          .then((counts) => { setActivityCounts(counts); setActivityError(''); })
          .catch(() => setActivityError('暂时无法获取准确的反馈数量。打开项目仍可查看内容。'));
      } else { setActivityCounts({}); setActivityError(''); }
      return true;
    } catch (cause) {
      if (!cancelled.current) (background ? setRefreshError : setError)(message(cause));
      return false;
    }
    finally { if (!background) { setBusy(false); setCanCancel(false); } }
  }, []);

  useEffect(() => { void loadRepos(); }, [loadRepos]);
  async function refreshActivityCount(repo: GitHubRepo): Promise<void> {
    try {
      const result = await api<Record<number, GitHubActivityCount>>('activityCounts', [{ id: repo.id, owner: repo.owner.login, name: repo.name }]);
      const count = result[repo.id];
      if (count) setActivityCounts((current) => ({ ...current, [repo.id]: count }));
    } catch { setActivityError('暂时无法更新反馈数量。稍后重新打开页面即可重试。'); }
  }
  const refreshLocalLinks = useCallback(async () => { setLocalLinks(await window.easyHub?.localList() ?? []); }, []);
  const downloads = useDownloadCenter(refreshLocalLinks);
  useEffect(() => { void refreshLocalLinks(); }, [refreshLocalLinks]);
  useEffect(() => window.easyHub?.onLocalStatus(({ id, status }) => {
    setLocalStatuses((current) => ({ ...current, [id]: status }));
  }), []);
  useEffect(() => {
    if (!['home', 'projects', 'project'].includes(view) || !window.easyHub || localLinks.length === 0) return;
    let active = true;
    setCheckingLocal(true);
    void (async () => {
      for (const link of localLinks) {
        if (!active) break;
        try {
          const status = await window.easyHub!.localStatus(link.id);
          if (active) { setLocalStatuses((current) => ({ ...current, [link.id]: status })); setLocalErrors((current) => ({ ...current, [link.id]: false })); }
          if (active && status.files.length === 0) {
            const preview = await window.easyHub!.localCheckSync(link.id);
            if (active) setRemotePreviews((current) => ({ ...current, [link.id]: preview }));
          }
        } catch { if (active) setLocalErrors((current) => ({ ...current, [link.id]: true })); }
      }
      if (active) setCheckingLocal(false);
    })();
    return () => { active = false; };
  }, [view, localLinks]);

  const recentRepoKey = repos.filter((repo) => !repo.fork).slice(0, 4).map((repo) => `${repo.id}:${repo.updated_at}`).join('|');
  useEffect(() => {
    if (!['home', 'recent-history'].includes(view)) return;
    let active = true;
    const targets = repos.filter((repo) => !repo.fork).slice(0, 4);
    setRecentLoading(true); setRecentError('');
    void Promise.allSettled(targets.map(async (repo) => ({ repo, commits: await api<GitHubCommit[]>('commits', ownerOf(repo), repo.name) }))).then((results) => {
      if (!active) return;
      const updates = results.flatMap((result) => result.status === 'fulfilled' ? result.value.commits.slice(0, 3).map((commit) => ({ repo: result.value.repo, commit })) : []);
      updates.sort((a, b) => (Date.parse(b.commit.commit.author?.date ?? '') || 0) - (Date.parse(a.commit.commit.author?.date ?? '') || 0));
      setRecentUpdates(updates);
      if (results.some((result) => result.status === 'rejected')) setRecentError('部分项目的更新暂时无法加载。');
      setRecentLoading(false);
    });
    return () => { active = false; };
    // The repository key refreshes history when cloud data changes, without reacting to unrelated views.
  }, [recentRepoKey, view]);

  useEffect(() => {
    if (searchScope !== 'public' || search.trim().length < 2 || parseProjectAddress(search) || view === 'discover' && discoverScope === 'users' || view !== 'discover' && view !== 'projects') {
      setPublicRepos([]); setPublicSearchTotalCount(null); setPublicSearchHasNextPage(false); setPublicSearchBusy(false); setPublicSearchError(''); return;
    }
    let active = true;
    setPublicRepos([]); setPublicSearchTotalCount(null); setPublicSearchHasNextPage(false); setPublicSearchBusy(true); setPublicSearchError('');
    const timer = window.setTimeout(() => {
      void api<GitHubSearchPage<GitHubRepo>>('searchPublicReposPage', search.trim(), publicSearchPage).then((result) => {
        if (active) { setPublicRepos(result.items); setPublicSearchTotalCount(result.totalCount); setPublicSearchHasNextPage(result.hasNextPage); recordSearch(search, 'public'); }
      }).catch((cause: unknown) => {
        if (active) setPublicSearchError(message(cause));
      }).finally(() => { if (active) setPublicSearchBusy(false); });
    }, 450);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, searchScope, discoverScope, view, publicSearchPage, recordSearch]);

  async function beginEditIntroduction(): Promise<void> {
    if (!selected || selected.archived || !window.easyHub) return;
    setError(''); setIntroError('');
    try {
      const links = await window.easyHub.localList();
      setLocalLinks(links);
      const link = links.find((item) => selectedLocalId ? item.id === selectedLocalId : item.repositoryId === selected.id);
      if (!link) { setView('local'); return; }
      setIntroExpected(await window.easyHub.localReadIntroduction(link.id)); setIntroEditing(true);
    }
    catch (cause) { setError(message(cause)); }
  }

  async function saveIntroduction(content: string): Promise<void> {
    if (!selected || !window.easyHub) return;
    const link = localLinks.find((item) => selectedLocalId ? item.id === selectedLocalId : item.repositoryId === selected.id);
    if (!link) return;
    setIntroSaving(true); setIntroError('');
    try {
      await window.easyHub.localSaveIntroduction(link.id, introExpected, content);
      setReadme(content); setIntroEditing(false); setNotice('介绍已保存到本地，发布源码后同步到 GitHub。');
    } catch (cause) { setIntroError(message(cause)); }
    finally { setIntroSaving(false); }
  }

  async function openProject(repo: GitHubRepo, localId: string | null = null, background = false): Promise<void> {
    const request = ++projectLoad.current;
    const current = (): boolean => request === projectLoad.current && !cancelled.current
      && (!background || currentView.current === 'project' && selectedRepoId.current === repo.id);
    cancelled.current = false;
    if (!background) {
      setSelected(repo); setSelectedLocalId(localId); setView('project'); setReadme(''); setIssues([]); setCommits([]); setError(''); setBusy(true); setCanCancel(true); setIntroductionLoading(true);
    }
    setIntroductionError('');
    try {
      const introRequest = api<string>('readme', ownerOf(repo), repo.name).catch(async (cause: unknown) => {
        const link = localLinks.find((item) => localId ? item.id === localId : item.repositoryId === repo.id);
        if (link && window.easyHub) return window.easyHub.localReadIntroduction(link.id);
        throw cause;
      }).then((intro) => { if (current()) setReadme(intro); })
        .catch(() => { if (current()) (background ? setRefreshError : setIntroductionError)('项目介绍暂时无法加载，请重试。'); })
        .finally(() => { if (!background && request === projectLoad.current) setIntroductionLoading(false); });
      const [items, history] = await Promise.allSettled([
        api<GitHubIssuePage>('issuesPage', ownerOf(repo), repo.name, 'all', 1),
        api<GitHubCommit[]>('commits', ownerOf(repo), repo.name),
      ]);
      if (current()) {
        if (items.status === 'fulfilled') { setIssues(items.value.items); setIssueNextPages((current) => ({ ...current, [repo.id]: items.value.nextPage })); }
        if (history.status === 'fulfilled') {
          setCommits(history.value);
          if (background) setHistoryRefresh((current) => ({ ...current, [repo.id]: (current[repo.id] ?? 0) + 1 }));
        }
        if (currentView.current === 'project' && (items.status === 'rejected' || history.status === 'rejected')) (background ? setRefreshError : setError)('部分反馈或历史版本暂时无法加载，请刷新重试。');
      }
      await introRequest;
      void refreshActivityCount(repo);
    } catch (cause) { if (current() && currentView.current === 'project') (background ? setRefreshError : setError)(message(cause)); }
    finally { if (!background && request === projectLoad.current) { setBusy(false); setCanCancel(false); } }
  }

  async function openIssue(item: GitHubIssue, project: GitHubRepo | null = selected): Promise<void> {
    if (!project) return;
    issueReturnProject.current = selected;
    const request = ++issueLoad.current;
    cancelled.current = false; setSelected(project); setIssues(issueGroups[project.id] ?? (selected?.id === project.id ? issues : []));
    setIssue(item); setView('issue'); setComments([]); setIssueReadBusy(true); setError('');
    try {
      const items = await api<GitHubComment[]>('comments', ownerOf(project), project.name, item.number);
      if (request === issueLoad.current && !cancelled.current) setComments(items);
    }
    catch (cause) { if (request === issueLoad.current && !cancelled.current) setError(message(cause)); }
    finally { if (request === issueLoad.current) setIssueReadBusy(false); }
  }

  function renderIssueMarkdown(content: string) {
    if (!selected) return null;
    return <ReadmeMarkdown markdown={content} repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }} onOpenLink={(url) => void openReadmeLink(url, selected)} />;
  }

  async function toggleIssueGroup(repo: GitHubRepo): Promise<void> {
    if (expandedRepo === repo.id) { setExpandedRepo(null); return; }
    setExpandedRepo(repo.id); setError('');
    if (issueGroups[repo.id] && !staleIssueGroups.current.has(repo.id)) return;
    const generation = issueDataGeneration.current;
    cancelled.current = false; setBusy(true); setCanCancel(true);
    try {
      const result = await api<GitHubIssuePage>('issuesPage', ownerOf(repo), repo.name, 'all', 1);
      if (generation === issueDataGeneration.current && !cancelled.current) {
        staleIssueGroups.current.delete(repo.id);
        setIssueGroups((groups) => ({ ...groups, [repo.id]: result.items }));
        setIssueNextPages((current) => ({ ...current, [repo.id]: result.nextPage }));
      }
    }
    catch (cause) { if (generation === issueDataGeneration.current && !cancelled.current) setError(message(cause)); }
    finally { if (generation === issueDataGeneration.current) { setBusy(false); setCanCancel(false); } }
  }

  async function openVersionFor(repo: GitHubRepo, item: GitHubCommit): Promise<void> {
    setSelected(repo);
    setVersionReturnView(view === 'home' || view === 'recent-history' ? 'recent-history' : 'history');
    cancelled.current = false; setCommit(item); setView('version'); setBusy(true); setCanCancel(true); setError('');
    try { setCommit(await api<GitHubCommit>('commit', ownerOf(repo), repo.name, item.sha)); }
    catch (cause) { if (!cancelled.current) setError(message(cause)); }
    finally { setBusy(false); setCanCancel(false); }
  }
  async function openVersion(item: GitHubCommit): Promise<void> { if (selected) await openVersionFor(selected, item); }

  async function sendReply(event: FormEvent): Promise<void> {
    event.preventDefault(); if (!selected || !issue || !reply.trim() || refreshInFlight.current) return;
    const sentDraftKey = replyKey;
    const sentDraft = reply;
    setBusy(true); setError('');
    try {
      const result = await api<GitHubComment>('createComment', ownerOf(selected), selected.name, issue.number, reply.trim());
      clearReply(sentDraft);
      if (issueContext.current === sentDraftKey) { setComments((items) => [...items, result]); setNotice('回复已发送。'); }
    } catch (cause) { if (issueContext.current === sentDraftKey) setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function changeIssueState(): Promise<void> {
    if (!selected || !issue || refreshInFlight.current) return;
    setBusy(true); setError('');
    try {
      const next = await api<GitHubIssue>('updateIssue', ownerOf(selected), selected.name, issue.number, issue.state === 'open' ? 'closed' : 'open');
      setIssue(next); setIssues((items) => items.map((item) => item.number === next.number ? next : item));
      setIssueGroups((groups) => { const current = groups[selected.id]; return current ? { ...groups, [selected.id]: current.map((item) => item.number === next.number ? next : item) } : groups; });
      void refreshActivityCount(selected);
      setNotice(next.state === 'closed' ? '问题已标记为解决。' : '问题已重新打开。');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function download(ref: string): Promise<void> {
    if (!selected) return;
    await downloads.start({ kind: 'archive', repo: selected, ref, fileName: `${selected.name}-${ref.slice(0, 8)}.zip` });
  }

  async function loadMoreIssuesFor(repo: GitHubRepo): Promise<void> {
    const nextPage = issueNextPages[repo.id];
    if (!nextPage || loadingMoreIssues) return;
    const generation = issueDataGeneration.current;
    setLoadingMoreIssues(true); setError('');
    try {
      const result = await api<GitHubIssuePage>('issuesPage', ownerOf(repo), repo.name, 'all', nextPage);
      if (generation !== issueDataGeneration.current || cancelled.current) return;
      const append = (current: GitHubIssue[]): GitHubIssue[] => [...current, ...result.items.filter((item) => !current.some((known) => known.id === item.id))];
      setIssueGroups((groups) => ({ ...groups, [repo.id]: append(groups[repo.id] ?? (selected?.id === repo.id ? issues : [])) }));
      if (selectedRepoId.current === repo.id) setIssues(append);
      setIssueNextPages((current) => ({ ...current, [repo.id]: result.nextPage }));
    } catch (cause) { setError(message(cause)); }
    finally { setLoadingMoreIssues(false); }
  }

  async function openNewRelease(): Promise<void> {
    if (!selected || selected.archived || !window.easyHub) return;
    setReleaseFailures((current) => ({ ...current, [selected.id]: undefined }));
    setBusy(true); setError(''); setReleaseImages({}); setReleaseProgress(null);
    try {
      const items = await window.easyHub.github<GitHubRelease[]>('releases', ownerOf(selected), selected.name);
      setReleaseHistory(items.map((item) => ({
        id: String(item.id), tagName: item.tag_name, title: item.name || item.tag_name,
        body: item.body || '', channel: /^alpha/i.test(item.tag_name) ? 'alpha' : /^beta/i.test(item.tag_name) ? 'beta' : 'stable',
        publishedAt: item.published_at || '',
        assets: item.assets.map((asset) => ({ id: String(asset.id), name: asset.name, size: asset.size, mimeType: asset.content_type })),
      })));
      setView('new-release');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function publishNewRelease(input: CreateReleaseInput): Promise<void> {
    if (!selected || !window.easyHub || releaseSubmitting.current) return;
    releaseSubmitting.current = true;
    const repositoryId = selected.id;
    setReleaseBusy(true); setReleaseFailures((current) => ({ ...current, [repositoryId]: undefined })); setError(''); setReleaseProgress(null);
    try {
      const result = await window.easyHub.publishRelease({ owner: ownerOf(selected), repo: selected.name,
        tagName: input.tagName, title: input.title, body: input.body, channel: input.channel, assetIds: input.assets.map((asset) => asset.id) });
      if ('status' in result && result.status === 'failed') {
        setReleaseFailures((current) => ({ ...current, [repositoryId]: result }));
        if (currentView.current === 'new-release' && selectedRepoId.current === repositoryId) setError(result.error);
        else setNotice(`${selected.name} 的新版本尚未完成，请返回发布页面重试。`);
        return;
      }
      if ('status' in result) return;
      removeDraft(createDraftKey(user.login, selected.id, 'release', 'new'));
      setNotice('新版本已发布到 GitHub。');
      if (currentView.current === 'new-release' && selectedRepoId.current === repositoryId) {
        setPageRevisions((current) => ({ ...current, [navigationKey]: (current[navigationKey] ?? 0) + 1 }));
        pageHistory.replace(() => { setDownloadFocusTag(result.tag_name); setEditReleaseOnOpen(false); setView('downloads'); });
      }
    } catch (cause) {
      if (currentView.current === 'new-release' && selectedRepoId.current === repositoryId) setError(message(cause));
      else setNotice(`${selected.name} 的新版本尚未完成，请返回发布页面重试。`);
    }
    finally { releaseSubmitting.current = false; setReleaseBusy(false); setReleaseProgress(null); }
  }

  async function refreshCurrent(): Promise<void> {
    if (refreshInFlight.current || busy || issueReadBusy) return;
    refreshInFlight.current = true;
    const refreshStartedAt = performance.now();
    setRefreshing(true); setRefreshError('');
    const generation = ++issueDataGeneration.current;
    const refreshView = view;
    const refreshSelectedId = selected?.id ?? null;
    const refreshIssueKey = replyKey;
    const current = (): boolean => generation === issueDataGeneration.current && !cancelled.current
      && currentView.current === refreshView && selectedRepoId.current === refreshSelectedId
      && (refreshView !== 'issue' || issueContext.current === refreshIssueKey);
    // Mark cached groups stale without removing the rows the user is reading.
    // A later expansion still fetches fresh data, including after a failed refresh.
    const refreshRepo = view === 'issues' ? selected ?? repos.find((repo) => repo.id === expandedRepo) : null;
    Object.keys(issueGroups).forEach((id) => staleIssueGroups.current.add(Number(id)));
    try {
      if (!await loadRepos(true) || !current()) return;
      if (view === 'issues') {
        if (!refreshRepo) return;
        const result = await api<GitHubIssuePage>('issuesPage', ownerOf(refreshRepo), refreshRepo.name, 'all', 1);
        if (current()) {
          staleIssueGroups.current.delete(refreshRepo.id);
          setIssueGroups((groups) => ({ ...groups, [refreshRepo.id]: result.items }));
          setIssueNextPages((current) => ({ ...current, [refreshRepo.id]: result.nextPage }));
          if (selected?.id === refreshRepo.id) setIssues(result.items);
        }
        return;
      }
      if (!selected) return;
      if (view === 'project') { await openProject(selected, selectedLocalId, true); return; }
      const [intro, items, history] = await Promise.all([
        api<string>('readme', ownerOf(selected), selected.name),
        api<GitHubIssuePage>('issuesPage', ownerOf(selected), selected.name, 'all', 1),
        api<GitHubCommit[]>('commits', ownerOf(selected), selected.name),
      ]);
      if (!current()) return;
      setReadme(intro); setIssues(items.items); setCommits(history);
      setHistoryRefresh((current) => ({ ...current, [selected.id]: (current[selected.id] ?? 0) + 1 }));
      setIssueGroups((groups) => ({ ...groups, [selected.id]: items.items }));
      setIssueNextPages((current) => ({ ...current, [selected.id]: items.nextPage }));
      if (view === 'issue' && issue) {
        setIssue(items.items.find((item) => item.number === issue.number) ?? issue);
        const refreshedComments = await api<GitHubComment[]>('comments', ownerOf(selected), selected.name, issue.number);
        if (current()) { issueLoad.current++; setComments(refreshedComments); }
      }
      if (view === 'version' && commit) {
        const refreshedCommit = await api<GitHubCommit>('commit', ownerOf(selected), selected.name, commit.sha);
        if (current()) setCommit(refreshedCommit);
      }
    } catch (cause) { if (current()) setRefreshError(message(cause)); }
    finally {
      // Fast or cached reads can finish before the browser paints a frame.
      // Keep the click feedback visible for a full turn; data updates above are immediate.
      const feedbackRemaining = 1200 - (performance.now() - refreshStartedAt);
      if (feedbackRemaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, feedbackRemaining));
      // Stop on the icon's own cycle boundary, rather than snapping a partial
      // turn back to zero. Cancellation/detachment must never lock the button.
      const icon = refreshIcon.current;
      const rotation = icon?.getAnimations().find((animation) => animation instanceof CSSAnimation
        && animation.animationName === 'live-spin' && animation.playState === 'running');
      const duration = rotation?.effect?.getComputedTiming().duration;
      if (icon?.isConnected && rotation && typeof duration === 'number' && duration > 0) {
        await new Promise<void>((resolve) => {
          const finish = (): void => {
            window.clearTimeout(timeout);
            icon.removeEventListener('animationiteration', onIteration);
            rotation.removeEventListener('cancel', finish);
            rotation.removeEventListener('finish', finish);
            resolve();
          };
          const onIteration = (event: AnimationEvent): void => {
            if (event.target === icon && event.animationName === 'live-spin') finish();
          };
          const timeout = window.setTimeout(finish, duration + 150);
          icon.addEventListener('animationiteration', onIteration);
          rotation.addEventListener('cancel', finish);
          rotation.addEventListener('finish', finish);
        });
      }
      refreshInFlight.current = false; setRefreshing(false);
    }
  }

  function cancelReads(): void { cancelled.current = true; issueLoad.current++; setIssueReadBusy(false); void window.easyHub?.cancelGithubReads(); }

  async function publishFromHome(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!pendingLocal || !homeUpdateMessage.trim() || !window.easyHub) return;
    setBusy(true); setError('');
    try {
      const preview = await window.easyHub.localCheckSync(pendingLocal.link.id);
      if (preview.state === 'blocked') { setError(preview.message ?? '暂时无法安全发布。'); return; }
      if (preview.state === 'review') {
        setHomeSyncReview({ id: pendingLocal.link.id, preview, message: homeUpdateMessage.trim() });
        openLocal(pendingLocal.link, pendingLocal.repo); return;
      }
      const result = await window.easyHub.localPublish(pendingLocal.link.id, homeUpdateMessage.trim());
      setNotice(`发布成功，${result.changed} 个文件已保存到 GitHub。`);
      setHomeUpdateMessage('');
      setRemotePreviews((current) => { const next = { ...current }; delete next[pendingLocal.link.id]; return next; });
      setLocalStatuses((current) => ({ ...current, [pendingLocal.link.id]: { files: [], needsReview: false } }));
      await loadRepos();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function getLatestFromHome(link: LocalProjectLink, repo: GitHubRepo): Promise<void> {
    if (!window.easyHub) return;
    setBusy(true); setError('');
    try {
      const preview = await window.easyHub.localCheckSync(link.id);
      if (preview.state === 'blocked') { setError(preview.message ?? '暂时无法安全获取最新内容。'); return; }
      if (preview.state === 'review') { setHomeSyncReview({ id: link.id, preview, message: '' }); openLocal(link, repo); return; }
      if (preview.state === 'ready') {
        const result = await window.easyHub.localSync(link.id, preview.remoteRevision, []);
        setNotice(`已获取 GitHub 上的最新内容，更新了 ${result.updated} 个文件。`);
        setLocalStatuses((current) => ({ ...current, [link.id]: { files: [], needsReview: false } }));
      } else setNotice('这个项目已经是最新的。');
      setRemotePreviews((current) => ({ ...current, [link.id]: { state: 'current', changedFiles: 0, files: [] } }));
      await loadRepos();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  const ownRepos = repos.filter((repo) => !repo.fork);
  const forkRepos = repos.filter((repo) => repo.fork && repo.owner.login.toLowerCase() === user.login.toLowerCase());
  const filtered = ownRepos.filter((repo) => `${repo.name} ${repo.description ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const savedPublicMatches = savedPublicRepos.filter((repo) => `${repo.full_name} ${repo.description ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const visibleIssues = issues.filter((item) => item.state === 'open');
  const pendingIssueCount = (repo: GitHubRepo): number | null => activityCounts[repo.id]?.issues ?? null;
  const orderedIssueRepos = [...repos].sort((a, b) => (pendingIssueCount(b) ?? -1) - (pendingIssueCount(a) ?? -1) || a.name.localeCompare(b.name));
  const totalPendingIssues = repos.every((repo) => activityCounts[repo.id]) ? repos.reduce((total, repo) => total + (activityCounts[repo.id]?.issues ?? 0), 0) : null;
  const totalPendingPulls = repos.every((repo) => activityCounts[repo.id]) ? repos.reduce((total, repo) => total + (activityCounts[repo.id]?.pullRequests ?? 0), 0) : null;
  const pendingLocal = localLinks.map((link) => ({ link, repo: repos.find((repo) => repo.id === link.repositoryId), status: localStatuses[link.id] })).find((item) => item.repo && item.status?.files.length);
  const localStates = localLinks.map((link) => projectPresentation(localStatuses[link.id], remotePreviews[link.id], localErrors[link.id]));
  const localState = localLinks.length === 0 ? 'none' : checkingLocal || localStates.some((state) => state.state === 'checking') ? 'checking' : localStates.some((state) => state.state === 'unavailable' || state.state === 'review') ? 'unavailable' : localStates.some((state) => state.state === 'remote') ? 'remote' : 'saved';
  const unpublishedCount = localLinks.some((link) => !localStatuses[link.id] || localErrors[link.id]) ? null : localLinks.reduce((total, link) => total + (localStatuses[link.id]?.files.length ?? 0), 0);
  const selectedLocalLink = localLinks.find((link) => link.id === selectedLocalId && link.repositoryId === selected?.id) ?? localLinks.find((link) => link.repositoryId === selected?.id);
  const selectedState = selectedLocalLink ? projectPresentation(localStatuses[selectedLocalLink.id], remotePreviews[selectedLocalLink.id], localErrors[selectedLocalLink.id]) : { state: 'saved' as const, text: selected?.archived ? '已存档 · 只读' : '保存在 GitHub' };
  const emptyIssueRepos = orderedIssueRepos.filter((repo) => (issueFilter === 'open' ? activityCounts[repo.id]?.issues : activityCounts[repo.id]?.closedIssues) === 0);
  const shownIssueRepos = orderedIssueRepos.filter((repo) => showOtherIssueRepos || !emptyIssueRepos.includes(repo));
  function openLocal(link: LocalProjectLink, repo?: GitHubRepo): void { setSelectedLocalId(link.id); setSelected(repo ?? null); setView('local'); }
  const activityNotices: ActivityNotice[] = [];
  for (const link of localLinks) {
    const repo = repos.find((item) => item.id === link.repositoryId);
    const changed = localStatuses[link.id]?.files.length ?? 0;
    if (repo && changed > 0) activityNotices.push({ id: `local-${link.id}`, title: `${repo.name} 有 ${changed} 个文件还没发布`, detail: '查看本地修改', onOpen: () => openLocal(link, repo) });
  }
  for (const repo of orderedIssueRepos) {
    const count = activityCounts[repo.id];
    if (count?.issues) activityNotices.push({ id: `issues-${repo.id}`, title: `${repo.name} 有 ${count.issues} 个待处理的问题`, detail: '查看问题', onOpen: () => { setSelected(null); setView('issues'); void toggleIssueGroup(repo); } });
    if (count?.pullRequests) activityNotices.push({ id: `pulls-${repo.id}`, title: `${repo.name} 有 ${count.pullRequests} 个合并请求`, detail: '合并请求审查', onOpen: () => { setSelected(repo); setPullReturn(null); setView('pulls'); } });
  }
  const canEditSelectedRelease = Boolean(selected && !selected.archived && (selected.permissions?.push || selected.permissions?.admin || selected.owner.login.toLowerCase() === user.login.toLowerCase()));

  function issueSectionTabs(active: 'issues' | 'pulls') {
    return <div className="issue-section-tabs" role="tablist" aria-label={language === 'en' ? 'Issues and pull request reviews' : '问题与合并请求审查'}>
      <button type="button" role="tab" aria-selected={active === 'issues'} className={active === 'issues' ? 'selected' : ''} onClick={() => { if (active === 'pulls') { setSelected(pullReturn); setPullInitialRequest(null); setView('issues'); } }}>问题 <span>{selected ? activityCounts[selected.id]?.issues ?? '…' : totalPendingIssues ?? '…'}</span></button>
      <button type="button" role="tab" aria-selected={active === 'pulls'} className={active === 'pulls' ? 'selected' : ''} onClick={() => { if (active === 'issues') { setPullReturn(selected); setPullInitialRequest(null); setView('pulls'); } }}>合并请求审查 <span>{selected ? activityCounts[selected.id]?.pullRequests ?? '…' : totalPendingPulls ?? '…'}</span></button>
    </div>;
  }

  function homeRepoRow(repo: GitHubRepo) {
    const link = localLinks.find((item) => item.repositoryId === repo.id);
    const changed = link ? localStatuses[link.id]?.files.length ?? 0 : 0;
    const remote = link ? remotePreviews[link.id] : undefined;
    const state = link ? projectPresentation(localStatuses[link.id], remote, localErrors[link.id]) : { state: 'saved', text: '保存在 GitHub' };
    const hasRemote = remote?.state === 'ready' || remote?.state === 'review';
    return <div className="home-project-row" key={repo.id}>
      <RepoLogo repo={repo} />
      <button className="home-project-name" onClick={() => void openProject(repo)}><strong>{repo.name}</strong><span>{repo.description || '还没有项目介绍'}</span></button>
      <div className="home-project-meta"><span className={`home-row-status ${state.state}`}><i />{state.text}</span><small>{relativeDate(repo.updated_at, language)}更新 · {pendingIssueCount(repo) ?? '…'} 个问题</small></div>
      <div className="home-project-actions">{remote?.state === 'review' ? <button className="button button-primary" onClick={() => { setHomeSyncReview({ id: link!.id, preview: remote, message: '' }); openLocal(link!, repo); }}>确认内容</button> : changed && link ? <button className="button button-primary" onClick={() => openLocal(link, repo)}>查看修改</button> : hasRemote && link ? <button className="button button-quiet" disabled={busy} onClick={() => void getLatestFromHome(link, repo)}>获取最新</button> : <button className="button button-quiet" onClick={() => void openProject(repo)}>打开项目</button>}</div>
    </div>;
  }

  return <div className="app-shell live-shell" data-layout-preference={layout.preference} data-layout={layout.density} ref={appRoot}>
    <aside className="sidebar"><nav className="sidebar-nav" aria-label="主导航">
      <button className={nav === 'home' ? 'active' : ''} onClick={() => navigateSidebar('home')}><Home size={19} />首页</button>
      <button className={nav === 'projects' ? 'active' : ''} onClick={() => navigateSidebar('projects')}><Folder size={19} />我的项目</button>
      <button className={nav === 'discover' ? 'active' : ''} onClick={() => navigateSidebar('discover')}><Compass size={19} />发现</button>
      <button className={nav === 'issues' ? 'active' : ''} onClick={() => navigateSidebar('issues')}><MessageCircle size={19} />问题{totalPendingIssues !== null && totalPendingIssues > 0 && <span className="nav-count">{totalPendingIssues}</span>}</button>
      <button className={nav === 'settings' ? 'active' : ''} onClick={() => navigateSidebar('settings')}><Settings2 size={19} />设置</button>
    </nav><div className="sidebar-bottom live-sidebar-bottom"><button type="button" className={`sidebar-refresh${busy || issueReadBusy || refreshing ? ' is-refreshing' : ''}`} aria-label={language === 'en' ? 'Refresh GitHub data' : '刷新 GitHub 数据'} title={refreshing ? language === 'en' ? 'Refreshing GitHub data…' : '正在刷新 GitHub 数据…' : language === 'en' ? 'Refresh GitHub data' : '刷新 GitHub 数据'} aria-busy={refreshing} disabled={busy || issueReadBusy || refreshing} onClick={() => void refreshCurrent()}><RotateCw ref={refreshIcon} size={15} className={busy || issueReadBusy || refreshing ? 'live-spin' : undefined} /></button><span className="sidebar-demo live-connected"><span />{language === 'en' ? 'Connected to GitHub' : '已连接 GitHub'} · {user.login}</span></div></aside>
    <div className="main-column" ref={scrollArea}><header className={`topbar topbar-${windowStyle}`}>
      {windowStyle === 'reference' && <div className="window-controls" aria-label="窗口控制"><button className="window-dot window-close" aria-label="关闭窗口" onClick={() => void window.easyHub?.closeWindow()} /><button className="window-dot window-minimize" aria-label="最小化窗口" onClick={() => void window.easyHub?.minimizeWindow()} /><button className="window-dot window-maximize" aria-label="最大化或还原窗口" onClick={() => void window.easyHub?.toggleMaximizeWindow()} /></div>}
      <button className="topbar-brand" onClick={() => navigateSidebar('home')}><img src={appIcon} alt="" /><span>EasyHub</span></button>
      {view === 'discover' ? <div className="topbar-context">发现 / 搜索</div> : <label className="topbar-search"><Search size={20} /><input aria-label="搜索项目/用户" placeholder="搜索项目/用户…" value={search} onChange={(event) => { if (event.nativeEvent instanceof InputEvent && event.nativeEvent.isComposing) setSearch(event.target.value); else continueSearch(event.target.value); }} onCompositionEnd={(event) => continueSearch(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) submitProjectSearch(search); }} /></label>}
      <div className="topbar-actions">
        <button className={`icon-button translation-toggle ${automaticTranslation ? 'active' : ''}`} type="button" aria-label={automaticTranslation ? '关闭翻译' : '开启翻译'} aria-pressed={automaticTranslation} title={automaticTranslation ? '关闭翻译' : '开启翻译'} onClick={() => setAutomaticTranslation((enabled) => !enabled)}><Languages size={21} strokeWidth={1.8} /></button>
        <div className="language-switcher"><button className="icon-button language-trigger" aria-label="选择语言" aria-expanded={languageMenuOpen} title="语言" onClick={() => setLanguageMenuOpen((open) => !open)}><Globe2 size={21} strokeWidth={1.8} /></button>{languageMenuOpen && <div className="language-menu" role="group" aria-label="语言选项"><button aria-pressed={language === 'zh'} onClick={() => { setLanguage('zh'); setLanguageMenuOpen(false); }}><span>中文</span>{language === 'zh' && <Check size={16} />}</button><button aria-pressed={language === 'en'} onClick={() => { setLanguage('en'); setLanguageMenuOpen(false); }}><span>English</span>{language === 'en' && <Check size={16} />}</button></div>}</div>
        <DownloadNotifications center={downloads} savedPublicRepoIds={savedPublicRepos.map((item) => item.id)} onAddPublic={addPublicProject} activity={activityNotices} account={user.login} />
        <button className="icon-button" aria-label="设置" onClick={() => navigateSidebar('settings')}><Settings2 size={20} /></button>
        <ProfileMenu avatar={user.avatar_url ? <img src={user.avatar_url} alt="" /> : user.login.slice(0, 1).toUpperCase()} name={user.login}
          onProfile={() => { rememberDiscoverPosition(); setProfileUser(user); setProfileReturnView(view === 'discover' ? 'discover' : 'home'); setView('profile'); }}
          onStarred={() => { rememberDiscoverPosition(); setStarredReturnView(view); setStarredRefresh((current) => current + 1); setView('starred'); }} />
      </div>
      {windowStyle === 'windows' && <div className="windows-window-controls" aria-label="窗口控制"><button className="windows-control-button" aria-label="最小化窗口" title="最小化" onClick={() => void window.easyHub?.minimizeWindow()}><Minus size={17} strokeWidth={1.6} /></button><button className="windows-control-button" aria-label="最大化或还原窗口" title="最大化或还原" onClick={() => void window.easyHub?.toggleMaximizeWindow()}><Square size={13} strokeWidth={1.7} /></button><button className="windows-control-button windows-control-close" aria-label="关闭窗口" title="关闭" onClick={() => void window.easyHub?.closeWindow()}><X size={17} strokeWidth={1.6} /></button></div>}
    </header><NavigationPages active={`${navigationKey}:${pageRevisions[navigationKey] ?? 0}`}><main className={`page-content live-page${view === 'home' || view === 'projects' ? ' page-with-footer' : ''}`}><div className="v2-page-transition" key={view}>
      {pageHistory.hasBack && ['home', 'projects', 'discover', 'issues', 'pulls', 'settings'].includes(view) && <button className="back-link" onClick={() => goBack(() => setView('home'))}><ArrowLeft size={17} />返回</button>}
      {error && <div className="live-error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div>}
      {notice && <div className="live-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={15} /></button></div>}
      {(busy || issueReadBusy) && <div className="live-loading"><RotateCw size={16} className="live-spin" />正在与 GitHub 同步…{(canCancel || issueReadBusy) && <button className="text-link" onClick={cancelReads}>取消</button>}</div>}

      {view === 'home' && <>
        <DashboardIntro projectCount={ownRepos.length} unpublishedCount={unpublishedCount} localState={localState} projectChanges={pendingLocal?.status?.files.length} pendingCount={totalPendingIssues === null || totalPendingPulls === null ? null : totalPendingIssues + totalPendingPulls} projectName={pendingLocal?.repo?.name} onCreate={() => setView('new-project')} onContinue={() => { if (pendingLocal) openLocal(pendingLocal.link, pendingLocal.repo); else { setSearchScope(localLinks.length ? 'local' : 'mine'); setView('projects'); } }} onProjects={() => { setSearchScope('mine'); setView('projects'); }} onChanges={() => { setSearchScope('local'); setView('projects'); }} onPending={() => { setSelected(null); setView(totalPendingPulls && !totalPendingIssues ? 'pulls' : 'issues'); }} />
        {pendingLocal?.repo && pendingLocal.status ? <form className="home-publish" onSubmit={(event) => void publishFromHome(event)}><RepoLogo repo={pendingLocal.repo} /><div className="home-publish-content"><strong>{pendingLocal.repo.name} 有 {pendingLocal.status.files.length} 个文件发生变化</strong><label htmlFor="live-home-update-message">这次改了什么？</label><div className="home-publish-controls"><input id="live-home-update-message" value={homeUpdateMessage} onChange={(event) => setHomeUpdateMessage(event.target.value)} placeholder="例如：修复窗口缩放问题" maxLength={120} /><button className="button button-primary" type="submit" disabled={busy || !homeUpdateMessage.trim()}><Send size={17} />发布更新</button></div></div><button className="icon-button home-publish-detail" type="button" aria-label="查看修改" onClick={() => { openLocal(pendingLocal.link, pendingLocal.repo); }}><ChevronRight size={20} /></button></form> : <div className={`home-all-saved ${localState}`} >{localState === 'checking' ? <RotateCw size={20} className="live-spin" /> : localState === 'saved' ? <CheckCircle2 size={20} /> : <Info size={20} />}{localState === 'checking' ? '正在检查本地修改…' : localState === 'remote' ? 'GitHub 上有新内容。' : localState === 'unavailable' ? '有项目需要检查。' : localState === 'none' ? '添加本地项目，开始创作。' : '你的项目已连接到 GitHub。'}<button onClick={() => { setSelected(null); setSelectedLocalId(null); setView('local'); }}>查看本地修改 <ArrowRight size={16} /></button></div>}
        <div className="home-dashboard"><section className="home-panel home-projects-panel"><div className="home-panel-heading"><h2>我的项目</h2><button className="text-link" onClick={() => setView('projects')}>查看全部 <ChevronRight size={17} /></button></div><div className="home-project-list">{ownRepos.slice(0, 3).map(homeRepoRow)}{ownRepos.length === 0 && !busy && <p className="live-empty">还没有项目。你可以先创建一个。</p>}</div></section><section className="home-panel home-recent-panel"><div className="home-panel-heading"><h2>最近更新</h2><button className="text-link" onClick={() => setView('recent-history')}>查看全部 <ChevronRight size={17} /></button></div><div className="home-recent-list">{recentUpdates.slice(0, 4).map(({ repo, commit: item }) => <button className="home-recent-row" key={`${repo.id}:${item.sha}`} onClick={() => void openVersionFor(repo, item)}><RepoLogo repo={repo} small /><span><strong>{repo.name}</strong><small>{relativeDate(item.commit.author?.date ?? repo.pushed_at ?? repo.updated_at, language)}</small><em>{item.commit.message.split('\n')[0]}</em></span></button>)}{recentLoading && <p className="muted">正在获取最近更新…</p>}{recentError && <p className="muted">{recentError}</p>}{!recentLoading && !recentUpdates.length && !recentError && <p className="muted">还没有历史版本。</p>}</div></section></div>
        <div className="home-shortcuts"><button onClick={() => { setSelected(null); setSelectedLocalId(null); setSearchScope('mine'); setView('projects'); }}><CloudDownload size={17} />从 GitHub 下载项目 <ArrowRight size={15} /></button><button onClick={() => { setSelected(null); setSelectedLocalId(null); setView('local'); }}><FolderOpen size={17} />添加现有文件夹 <ArrowRight size={15} /></button></div>
      </>}

      {view === 'profile' && <UserProfile key={profileUser.login} login={profileUser.login} initialUser={profileUser} onBack={() => goBack(() => setView(profileReturnView))} onOpenRepository={(fullName) => void openProfileRepository(fullName)} />}

      {view === 'starred' && <StarredProjects key={starredRefresh} onBack={() => goBack(() => setView(starredReturnView))} onOpen={(repo) => {
        if (repo.owner.login.toLowerCase() === user.login.toLowerCase() || repo.permissions?.push) {
          setStarredOriginProjectId(repo.id);
          void openProject(repo);
        } else openPublicProject(repo);
      }} />}

      {view === 'discover' && <TrendingDiscover query={search} setQuery={setSearch} scope={discoverScope} onScopeChange={setDiscoverScope} period={discoverPeriod} onPeriodChange={(period) => { setDiscoverPeriod(period); setDiscoverPage(1); }} page={discoverPage} onPageChange={changeDiscoverPage} displayMode={searchDisplayMode} onDisplayMode={setSearchDisplayMode} history={searchHistory} onSelectHistory={selectSearchHistory} onClearHistory={clearSearchHistory} searchResults={publicRepos} searchBusy={publicSearchBusy} searchError={publicSearchError} searchPage={publicSearchPage} searchTotalCount={publicSearchTotalCount} searchHasNextPage={publicSearchHasNextPage} onSearchPageChange={changeSearchPage} onOpen={openPublicProject} onOpenProfile={openSearchedUser} onSearch={submitProjectSearch} onUserSearched={recordUserSearch} />}

      {view === 'projects' && <>
        <div className="page-header"><div><div className="eyebrow">你的作品</div><h1>我的项目</h1><p>所有灵感和进展，都在这里。</p></div><button className="button button-primary" onClick={() => setView('new-project')}><Plus size={18} />新建项目</button></div>
        <div className="toolbar"><SegmentedControl role="group" aria-label="搜索范围"><button className={searchScope === 'local' ? 'selected' : ''} aria-pressed={searchScope === 'local'} onClick={() => setSearchScope('local')}>这台电脑 <span>{localLinks.length}</span></button><button className={searchScope === 'mine' ? 'selected' : ''} aria-pressed={searchScope === 'mine'} onClick={() => setSearchScope('mine')}>我的云端项目 <span>{ownRepos.length}</span></button><button className={searchScope === 'forks' ? 'selected' : ''} aria-pressed={searchScope === 'forks'} onClick={() => setSearchScope('forks')}>仓库副本 <span>{forkRepos.length}</span></button><button className={searchScope === 'public' ? 'selected' : ''} aria-pressed={searchScope === 'public'} onClick={() => setSearchScope('public')}>所有公开项目</button></SegmentedControl><label className="search-box"><Search size={17} /><input aria-label="筛选项目" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { if (parseProjectAddress(search)) void openProjectAddress(search); else recordSearch(search, searchScope); } }} onBlur={() => { if (searchScope !== 'public' && !parseProjectAddress(search)) recordSearch(search, searchScope); }} placeholder={searchScope === 'public' ? '搜索公开项目' : '搜索项目'} />{search && <button type="button" className="icon-button" aria-label={language === 'en' ? 'Clear search' : '清除搜索'} onClick={() => setSearch('')}><X size={16} /></button>}</label></div>
        {!search.trim() && <SearchHistory entries={searchHistory} onSelect={selectSearchHistory} onClear={clearSearchHistory} />}
        {searchScope === 'local' && <LocalDiscoveryPanel onAdded={refreshLocalLinks} />}
        {searchScope === 'mine' && savedPublicMatches.length > 0 && <section className="panel saved-public-section"><div className="panel-heading"><h2>已添加的公开项目</h2><span className="muted">这台电脑上的只读快捷入口</span></div>{savedPublicMatches.map((repo) => <div className="cloud-row" key={repo.id}><RepoLogo repo={repo} small /><div><button className="plain-heading" onClick={() => openPublicProject(repo)}>{repo.full_name}</button><small>{repo.description || '还没有一句介绍'}</small></div><span className="public-readonly-label">只读</span><button className="button button-quiet" onClick={() => openPublicProject(repo)}>浏览</button></div>)}</section>}
        {searchScope === 'forks' ? <ForksOverview repos={forkRepos} search={search} onClearSearch={() => setSearch('')} onOpen={(repo) => void openProject(repo)} onBrowseOriginal={(owner, name) => void browseForkOriginal(owner, name)} /> : searchScope === 'local' ? <div className="project-grid">{localLinks.filter((link) => `${link.name} ${link.localPath}`.toLowerCase().includes(search.toLowerCase())).map((link) => { const repo = repos.find((item) => item.id === link.repositoryId); const state = projectPresentation(localStatuses[link.id], remotePreviews[link.id], localErrors[link.id]); return <article className="project-card" key={link.id}><div className="card-head">{repo ? <RepoLogo repo={repo} /> : <span className="project-logo logo-sky"><Folder size={23} /></span>}</div><button className="plain-heading" onClick={() => openLocal(link, repo)}>{link.name}</button><p className="card-description">{repo?.description || '还没有项目介绍'}</p><small className="local-copy-path" title={link.localPath}>{link.localPath}</small><span className={`status status-${state.state}`}><span className="status-dot" />{state.text}</span><div className="card-footer"><span><Clock3 size={14} />{relativeDate(link.lastOpenedAt, language)}</span></div><div className="card-actions"><button className="button button-quiet" onClick={() => openLocal(link, repo)}>打开项目</button>{repo && <button className="button button-primary" onClick={() => void openProject(repo, link.id)}>查看详情</button>}</div></article>; })}{localLinks.length === 0 && <div className="empty-state"><span className="empty-icon"><FolderOpen size={28} /></span><h3>这台电脑还没有项目</h3><p>可以从 GitHub 下载，或添加已有文件夹。</p><button className="button button-primary" onClick={() => { setSelected(null); setSelectedLocalId(null); setView('local'); }}>添加项目</button></div>}</div> : <div className="cloud-list">{(searchScope === 'public' ? publicRepos : filtered).map((repo) => { const external = searchScope === 'public' && repo.owner.login !== user.login; const browse = (): void => { if (external) openPublicProject(repo); else void openProject(repo); }; return <div className="cloud-row" key={repo.id}><RepoLogo repo={repo} small /><div><button className="plain-heading" onClick={browse}>{searchScope === 'public' ? repo.full_name : repo.name}</button><small>{repo.description || '还没有一句介绍'} · {relativeDate(repo.updated_at, language)}更新</small></div><span className="cloud-private">{external ? '只读' : repo.private ? <><LockKeyhole size={14} />只有我</> : '所有人'}</span><button className="button button-quiet" onClick={browse}>{external ? '只读浏览' : '查看'}</button>{!external && <button className="button button-primary" onClick={() => { setSelected(repo); setSelectedLocalId(null); setView('local'); }}>下载 <ArrowDownToLine size={16} /></button>}</div>; })}{searchScope === 'public' ? (publicSearchBusy ? <p className="live-empty">正在搜索公开项目…</p> : publicSearchError ? <p className="live-empty live-search-error" role="alert">{publicSearchError}</p> : search.trim().length < 2 ? <p className="live-empty">输入至少 2 个字符，搜索 GitHub 上的公开项目。</p> : publicRepos.length === 0 ? <SearchEmptyState language={language} onClear={() => setSearch('')} /> : null) : filtered.length === 0 && !busy && savedPublicMatches.length === 0 && search.trim() ? <SearchEmptyState language={language} onClear={() => setSearch('')} /> : <p className="live-empty">还没有项目。</p>}</div>}
        {searchScope === 'local' && search.trim() && localLinks.filter((link) => `${link.name} ${link.localPath}`.toLowerCase().includes(search.toLowerCase())).length === 0 && <SearchEmptyState language={language} onClear={() => setSearch('')} />}
        {searchScope === 'public' && search.trim().length >= 2 && !parseProjectAddress(search) && <SearchPagination page={publicSearchPage} totalCount={publicSearchTotalCount} hasNextPage={publicSearchHasNextPage} busy={publicSearchBusy} onPageChange={changeSearchPage} />}
        <div className="home-shortcuts"><button onClick={() => { setSelected(null); setSelectedLocalId(null); setSearchScope('mine'); setView('projects'); }}><CloudDownload size={17} />从 GitHub 下载项目 <ArrowRight size={15} /></button><button onClick={() => { setSelected(null); setSelectedLocalId(null); setView('local'); }}><FolderOpen size={17} />添加现有文件夹 <ArrowRight size={15} /></button></div>
      </>}


      {view === 'new-project' && <LocalWorkspace mode="create" repos={repos} selectedRepo={null} onBack={() => goBack(() => setView('projects'))} onCreated={async () => { await loadRepos(); await refreshLocalLinks(); }} onDownloadProject={(repo) => downloads.start({ kind: 'project', repo, fileName: repo.name })} downloadBusy={downloads.busy} />}

      {view === 'local' && <LocalWorkspace mode="list" repos={repos} selectedRepo={selected} initialLocalId={selectedLocalId} initialSyncReview={homeSyncReview} onSyncReviewOpened={() => setHomeSyncReview(null)} onBack={() => goBack(() => { if (selected) void openProject(selected, selectedLocalId); else setView('projects'); })} onCreated={async () => { await loadRepos(); await refreshLocalLinks(); }} onDownloadProject={(repo) => downloads.start({ kind: 'project', repo, fileName: repo.name })} downloadBusy={downloads.busy} />}

      {view === 'public-project' && publicSelected && <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation && !publicSelected.private, target: translationTarget, repository: { name: publicSelected.name, owner: publicSelected.owner.login, fullName: publicSelected.full_name }, names: translationNames }}><PublicProjectBrowser outerBackBoundary={publicBackBoundary} onPageChange={(key) => { if (publicSelected) publicPageKeys.current.set(publicSelected.id, key); }} repo={publicSelected} language={language} currentUser={user.login} onBack={() => goBack(() => setView(publicReturnView))} scrollArea={scrollArea} onOpenLink={(url) => void openReadmeLink(url, publicSelected)} onDownload={(request) => void downloads.start(request)} onForkReady={openCreatedFork} onOpenAiSettings={() => navigateSidebar('settings')} downloadBusy={downloads.busy} startInDownloads={Boolean(publicInitialDownload)} initialFocusTag={publicInitialDownload?.tag} /></TranslationPreferencesContext.Provider>}

      {view === 'downloads' && selected && <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}><ReleaseDownloads draftAccount={user.login} repo={selected} language={language} focusTag={downloadFocusTag} editOnOpen={editReleaseOnOpen} canEdit={canEditSelectedRelease} onDownload={(request) => void downloads.start(request)} downloadBusy={downloads.busy} onBack={() => goBack(() => setView('project'))} onOpenLink={(url) => void openReadmeLink(url, selected)} /></TranslationPreferencesContext.Provider>}

      {view === 'new-release' && selected && <ReleaseEditor draftAccount={user.login} draftRepository={selected.id} key={selected.id} project={{ name: selected.name,
        health: localLinks.some((link) => link.repositoryId === selected.id && (localStatuses[link.id]?.files.length ?? 0) > 0) ? 'changes' : 'saved',
        releases: releaseHistory }} language={language} busy={releaseBusy} progress={releaseProgress} failure={releaseFailure} imageSources={releaseImages}
        onRegisterInlineImage={(id, source) => setReleaseImages((current) => ({ ...current, [id]: typeof source === 'string' ? source : URL.createObjectURL(source) }))}
        onChooseFiles={(inline) => window.easyHub!.chooseReleaseFiles(inline)} onPublish={(input) => void publishNewRelease(input)}
        onBack={() => { if (releaseBusy) void window.easyHub?.cancelRelease(); else goBack(() => setView('project')); }} onOpenUpdate={() => setView('local')}
        onOpenLink={(url) => void window.easyHub?.openExternalLink(url)} />}


      {view === 'project' && selected && <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}>
        <button className="back-link" onClick={() => goBack(() => { setView(starredOriginProjectId === selected.id ? 'starred' : 'projects'); setStarredOriginProjectId(null); })}><ArrowLeft size={17} />{starredOriginProjectId === selected.id ? '返回收藏' : '所有项目'}</button>
        <section className="detail-hero"><div className="detail-main"><RepoLogo repo={selected} /><div><div className="detail-name-row"><h1>{selected.name}</h1><span className="visibility-label">{selected.private ? <><LockKeyhole size={13} />只有我</> : <><Globe2 size={13} />所有人</>}</span></div>{!selected.private && selected.description ? <TranslatableContent text={selected.description} format="text" render={(value) => <p>{value}</p>} /> : <p>{selected.description || '还没有项目介绍'}</p>}<span className={`status status-${selectedState.state}`}><span className="status-dot" />{selected.archived ? '已存档 · 只读' : selectedState.text}</span></div></div><div className="detail-actions"><StarProjectButton repo={selected} /><button className="button button-primary" disabled={selected.archived} onClick={() => setView('local')}><FolderOpen size={17} />本地项目与发布源码</button><div className="detail-release-actions">{!selected.fork && !selected.archived && (selected.permissions?.push || ownerOf(selected).toLowerCase() === user.login.toLowerCase()) && <button className="button button-quiet" disabled={busy} onClick={() => void openNewRelease()}><Tag size={17} />发布新版本</button>}<button className="button button-quiet" onClick={() => { setDownloadFocusTag(undefined); setEditReleaseOnOpen(canEditSelectedRelease); setView('downloads'); }}>{canEditSelectedRelease ? <Pencil size={17} /> : <ArrowDownToLine size={17} />}{canEditSelectedRelease ? '编辑发行版' : '下载发行版或源码'}</button></div></div></section>
        {selected.fork && <ForkContributionPanel key={selected.id} repo={selected} localLinkId={localLinks.find((item) => item.repositoryId === selected.id)?.id} suggestedTitle={commits[0]?.commit.message.split('\n')[0] ?? ''} onOpenLocal={() => setView('local')} onBrowseOriginal={(owner, name) => void browseForkOriginal(owner, name)} onOpenExternal={(url) => void window.easyHub?.openExternalLink(url)} />}
        <div className="detail-grid"><div className="detail-primary"><section className="panel"><div className="panel-heading"><h2>项目介绍</h2><button className="text-link" disabled={selected.archived} onClick={() => void beginEditIntroduction()}><Pencil size={15} />编辑介绍</button></div>{introductionLoading ? <p className="muted" role="status">正在读取项目介绍…</p> : introductionError ? <div className="live-error" role="alert">{introductionError}<button className="text-link" onClick={() => void openProject(selected, selectedLocalId)}>重试</button></div> : readme ? !selected.private ? <TranslatableContent text={readme} format="markdown" paragraphMode render={(value) => <ReadmeMarkdown markdown={value} repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }} onOpenLink={(href) => void openReadmeLink(href, selected)} />} /> : <ReadmeMarkdown markdown={readme} repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }} onOpenLink={(href) => void openReadmeLink(href, selected)} /> : <p className="muted">这个项目还没有介绍。</p>}</section><section className="panel"><div className="panel-heading"><h2>历史版本</h2><button className="text-link" onClick={() => setView('history')}>查看全部 <ArrowRight size={16} /></button></div><div className="timeline-list">{commits.slice(0, 3).map((item) => <button className="timeline-item" key={item.sha} onClick={() => void openVersion(item)}><span className="timeline-dot" /><span><strong>{item.commit.message.split('\n')[0]}</strong><small>{item.commit.author?.date ? relativeDate(item.commit.author.date, language) : ''}</small></span><ChevronRight size={17} /></button>)}{commits.length === 0 && <p className="muted">还没有历史版本。</p>}</div></section></div><div className="detail-side"><section className="panel side-panel"><div className="panel-heading"><h2>问题</h2><span className="count-bubble">{activityCounts[selected.id]?.issues ?? (busy ? '…' : visibleIssues.length)}</span></div><p>看看大家的反馈，一起让项目变得更好。</p><button className="button button-quiet full-width" onClick={() => setView('issues')}>查看问题 <ArrowRight size={16} /></button></section><section className="panel side-panel"><div className="panel-heading"><h2>合并请求审查</h2><span className="count-bubble">{activityCounts[selected.id]?.pullRequests ?? '…'}</span></div><p>查看改进说明和修改文件，再决定是否采纳。</p><button className="button button-quiet full-width" onClick={() => { setPullReturn(selected); setPullInitialRequest(null); setView('pulls'); }}>合并请求审查 <ArrowRight size={16} /></button></section><section className="panel side-panel"><div className="panel-heading"><h2>项目状态</h2></div><div className="status-detail"><span className={`big-status-dot ${selectedState.state}`} /><div><strong>{selectedState.text}</strong><small>上次更新：{relativeDate(selected.updated_at, language)}</small></div></div><button className="text-link" onClick={() => setView('local')}>查看本地修改 <ArrowRight size={16} /></button></section></div></div>
        {(selected.owner.login.toLowerCase() === user.login.toLowerCase() || selected.permissions?.admin) && <LiveProjectDangerZone repo={selected} language={language} onUpdate={(updated) => { setSelected(updated); setRepos((items) => items.map((item) => item.id === updated.id ? updated : item)); }} onTransferred={() => {
          unavailableRepos.current.add(selected.id);
          pageHistory.prune((key) => JSON.parse(key)[1] !== selected.id);
          pageHistory.replace(() => { setSelected(null); setView('projects'); });
          void loadRepos();
        }} onNotice={setNotice} />}
      </TranslationPreferencesContext.Provider>}

      {view === 'pulls' && <>
        <div className="page-header"><div><div className="eyebrow">一起完善作品</div><h1>合并请求审查</h1><p>查看大家提交的改进，检查修改并决定是否合入项目。</p></div></div>
        {issueSectionTabs('pulls')}
        {activityError && <p className="live-error" role="alert">{activityError}</p>}
        {selected ? <>
          <div className="toolbar"><button className="filter-project" onClick={() => { setSelected(null); setPullReturn(null); setPullInitialRequest(null); }}>{selected.name}<X size={15} /></button></div>
          <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation && !selected.private, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}><PullRequestsPanel scrollArea={scrollArea} repo={selected} initialRequest={pullInitialRequest} currentUser={user.login} language={language} downloadBusy={downloads.busy} onActivityChanged={() => void refreshActivityCount(selected)} onOpenAiSettings={() => navigateSidebar('settings')} onDownloadFile={(number, path, headSha) => downloads.start({ kind: 'pull-file', repo: selected, number, path, headSha, fileName: path.split('/').pop() || path })} /></TranslationPreferencesContext.Provider>
        </> : <PullReviewGroups repos={repos} counts={activityCounts} logo={(repo) => <RepoLogo repo={repo} small />} onOpen={(repo, request) => { setPullReturn(null); setPullInitialRequest(request); setSelected(repo); }} />}
      </>}

      {view === 'issues' && <>
        <div className="page-header"><div><div className="eyebrow">一起完善作品</div><h1>问题</h1><p>查看反馈、回复想法，解决遇到的困难。</p></div></div>
        {issueSectionTabs('issues')}
        {activityError && <p className="live-error" role="alert">{activityError}</p>}
        <DiscussionSearch filters={<div className="toolbar"><SegmentedControl><button className={issueFilter === 'open' ? 'selected' : ''} onClick={() => setIssueFilter('open')}>待处理 <span>{selected ? activityCounts[selected.id]?.issues ?? '…' : totalPendingIssues ?? '…'}</span></button><button className={issueFilter === 'closed' ? 'selected' : ''} onClick={() => setIssueFilter('closed')}>已解决</button></SegmentedControl>{selected && <button className="filter-project" onClick={() => setSelected(null)}>{selected.name}<X size={15} /></button>}</div>} repositories={selected ? [selected] : repos} kind="issue" state={issueFilter} language={language} search={issueSearch} onSearchChange={changeIssueSearch} onOpen={(item, repo) => void openIssue(item, repo)} />
        <div hidden={issueSearchActive}>
        {selected ? <div className="issue-list">{issues.filter((item) => item.state === issueFilter).map((item) => <button className="issue-row" key={item.id} onClick={() => void openIssue(item)}><span className={`issue-indicator ${item.state === 'closed' ? 'closed' : ''}`}><CircleHelp size={19} /></span><span className="issue-row-main"><IssueListTitle issue={item} repo={selected} automatic={automaticTranslation} target={translationTarget} names={translationNames} /><small>{selected.name} · {item.user?.login || 'GitHub 用户'} · {relativeDate(item.created_at, language)}</small></span><span className="issue-comments"><MessageCircle size={16} />{item.comments}</span><ChevronRight size={18} className="chevron" /></button>)}{!busy && issues.filter((item) => item.state === issueFilter).length === 0 && <div className="empty-state"><span className="empty-icon"><MessageCircle size={28} /></span><h3>{issueFilter === 'open' ? '没有待处理的问题' : '还没有已解决的问题'}</h3><p>这里会显示项目收到的反馈。</p></div>}</div> : <div className="issue-project-list">{shownIssueRepos.map((repo) => { const expanded = expandedRepo === repo.id; const items = (issueGroups[repo.id] || []).filter((item) => item.state === issueFilter); return <section className="issue-project-group live-issue-group" key={repo.id}><button className="issue-project-header" aria-expanded={expanded} onClick={() => void toggleIssueGroup(repo)}><RepoLogo repo={repo} small /><span className="issue-project-heading"><strong>{repo.name}</strong><small>{repo.description || '还没有项目介绍'}</small></span><span className={`issue-project-count ${issueFilter === 'open' && (pendingIssueCount(repo) ?? 0) > 0 ? 'live-pending-count' : ''}`}>{issueFilter === 'open' ? `${pendingIssueCount(repo) ?? '…'} 个待处理的问题` : expanded ? `${items.length} 个已解决的问题` : '查看已解决的问题'}</span><ChevronDown className={`issue-project-chevron ${expanded ? 'expanded' : ''}`} size={19} /></button><div className="issue-project-items live-group-items" hidden={!expanded}>{expanded && (items.length ? items.map((item) => <button className="issue-row" key={item.id} onClick={() => void openIssue(item, repo)}><span className={`issue-indicator ${item.state === 'closed' ? 'closed' : ''}`}><CircleHelp size={19} /></span><span className="issue-row-main"><IssueListTitle issue={item} repo={repo} automatic={automaticTranslation} target={translationTarget} names={translationNames} /><small>{item.user?.login || 'GitHub 用户'} · {relativeDate(item.created_at, language)}</small></span><span className="issue-comments"><MessageCircle size={16} />{item.comments}</span><ChevronRight size={18} className="chevron" /></button>) : issueGroups[repo.id] && <p className="live-empty">{issueFilter === 'open' ? '没有待处理的问题' : '还没有已解决的问题'}</p>)}</div></section>; })}</div>}
        {!selected && shownIssueRepos.length === 0 && <div className="empty-state"><span className="empty-icon"><MessageCircle size={28} /></span><h3>{issueFilter === 'open' ? '没有待处理的问题' : '还没有已解决的问题'}</h3><p>这里会显示项目收到的反馈。</p></div>}
        {!selected && emptyIssueRepos.length > 0 && <button className="text-link other-projects-toggle" aria-expanded={showOtherIssueRepos} onClick={() => setShowOtherIssueRepos((value) => !value)}>{showOtherIssueRepos ? '收起其他项目' : '查看其他项目'} <span>{emptyIssueRepos.length}</span><ChevronDown size={16} /></button>}
        {issuePagingRepo && issueNextPages[issuePagingRepo.id] && <button className="button button-quiet pull-more" disabled={loadingMoreIssues} onClick={() => void loadMoreIssuesFor(issuePagingRepo)}>{loadingMoreIssues ? '正在加载…' : '加载更多问题'}</button>}
        </div>
      </>}

      {view === 'issue' && issue && selected && <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}>
        <button className="back-link" onClick={() => goBack(() => { setSelected(issueReturnProject.current); setView('issues'); })}><ArrowLeft size={17} />返回问题</button>
        <div className="issue-detail"><div className="issue-title"><span className={`issue-state ${issue.state === 'closed' ? 'closed' : ''}`}>{issue.state === 'open' ? '待处理' : '已解决'}</span>{selected.private ? <h1>{issue.title}</h1> : <TranslatableContent text={issue.title} format="text" protectedNames={issueAuthorNames} render={(value) => <h1>{value}</h1>} />}<p>{selected.name} · {issue.user?.login || 'GitHub 用户'} 提出于 {date(issue.created_at)}</p></div>
        <div className="conversation"><div className="message"><div className="avatar author-avatar">{(issue.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box"><div><strong>{issue.user?.login || 'GitHub 用户'}</strong><small>{relativeDate(issue.created_at, language)}</small></div>{!selected.private && issue.body ? <TranslatableContent text={issue.body} format="markdown" paragraphMode protectedNames={issueAuthorNames} render={(value) => renderIssueMarkdown(value)} /> : renderIssueMarkdown(issue.body || '没有详细描述。')}</div></div>{comments.map((item) => <div className="message" key={item.id}><div className="avatar">{(item.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box"><div><strong>{item.user?.login || 'GitHub 用户'}</strong><small>{relativeDate(item.created_at, language)}</small></div>{selected.private ? renderIssueMarkdown(item.body) : <TranslatableContent text={item.body} format="markdown" paragraphMode protectedNames={issueAuthorNames} render={(value) => renderIssueMarkdown(value)} />}</div></div>)}</div>
        {!issueReadBusy && <PagedContinuation<GitHubComment> key={`${replyKey}:${issueLoad.current}`} action="commentsPage" args={[ownerOf(selected), selected.name, issue.number]} firstCount={comments.length} language={language} label={language === 'en' ? 'Load more replies' : '加载更多回复'} onItems={(items) => setComments((old) => [...old, ...items.filter((item) => !old.some((known) => known.id === item.id))].sort((a, b) => a.id - b.id))} />}
        <form className="reply-card" onSubmit={(event) => void sendReply(event)}><label htmlFor="live-reply">写一条回复</label><textarea id="live-reply" rows={4} maxLength={65536} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="说说你的想法或处理进度…" /><div><button type="button" className="button button-quiet" disabled={busy || refreshing} onClick={() => void changeIssueState()}>{issue.state === 'open' ? '标记为已解决' : '重新打开'}</button><button className="button button-primary" disabled={busy || issueReadBusy || refreshing || !reply.trim()} type="submit">发送回复 <ArrowRight size={16} /></button></div></form></div>
      </TranslationPreferencesContext.Provider>}

      {view === 'recent-history' && <><button className="back-link" onClick={() => goBack(() => setView('home'))}><ArrowLeft size={17} />返回首页</button><div className="page-header"><div><h1>最近更新</h1><p>最近项目的更新说明和历史版本。</p></div></div><div className="history-list">{recentUpdates.map(({ repo, commit: item }) => <button className="history-row" key={`${repo.id}:${item.sha}`} onClick={() => void openVersionFor(repo, item)}><RepoLogo repo={repo} small /><span className="history-main"><strong>{item.commit.message.split('\n')[0]}</strong><small>{repo.name} · {relativeDate(item.commit.author?.date ?? repo.updated_at, language)}</small></span><ChevronRight size={18} /></button>)}</div>{recentLoading && <p className="muted">正在获取最近更新…</p>}{recentError && <p className="muted">{recentError}</p>}</>}
      {view === 'history' && selected && <>
        <button className="back-link" onClick={() => goBack(() => setView('project'))}><ArrowLeft size={17} />返回项目</button><div className="page-header"><div><div className="eyebrow">{selected.name}</div><h1>历史版本</h1><p>每一次更新，都有迹可循。</p></div></div>
        <div className="history-list">{commits.map((item) => <button className="history-row" key={item.sha} onClick={() => void openVersion(item)}><span className="history-icon"><Clock3 size={19} /></span><span className="history-main"><strong>{item.commit.message.split('\n')[0]}</strong><small>{item.commit.author?.date ? date(item.commit.author.date) : ''} · {item.author?.login || item.commit.author?.name || '未知作者'}</small></span><span className="button button-quiet small-button">查看 <ArrowRight size={15} /></span></button>)}{commits.length === 0 && !busy && <p className="live-empty">还没有历史版本。</p>}</div>{!busy && <PagedContinuation<GitHubCommit> key={`${selected.id}:${historyRefresh[selected.id] ?? 0}`} action="commitsPage" args={[ownerOf(selected), selected.name]} firstCount={commits.length} language={language} onItems={(items) => setCommits((old) => [...old, ...items.filter((item) => !old.some((known) => known.sha === item.sha))])} />}
      </>}

      {view === 'version' && selected && commit && <>
        <button className="back-link" onClick={() => goBack(() => setView(versionReturnView))}><ArrowLeft size={17} />{versionReturnView === 'recent-history' ? '最近更新' : '历史版本'}</button><div className="narrow-page"><div className="eyebrow">{selected.name} · 历史版本</div><h1>{commit.commit.message.split('\n')[0]}</h1><p className="page-subtitle">{commit.author?.login || commit.commit.author?.name || '未知作者'} 发布于 {commit.commit.author?.date ? date(commit.commit.author.date) : ''}</p>
        <div className="version-stats"><div><strong>{commit.files?.length ?? '—'}</strong><span>修改文件</span></div><div><strong className="positive">+{commit.stats?.additions ?? '—'}</strong><span>新增行数</span></div><div><strong className="negative">−{commit.stats?.deletions ?? '—'}</strong><span>删除行数</span></div></div><section className="panel"><div className="panel-heading"><h2>修改文件</h2></div>{commit.files?.length ? <div className="file-list">{commit.files.map((file) => <div className="file-row" key={file.filename}><span className="file-kind"><Folder size={16} /></span><span>{file.filename}</span></div>)}</div> : <p className="muted">这个版本没有文件明细。</p>}</section><button className="button button-primary version-download" disabled={busy} onClick={() => void download(commit.sha)}><ArrowDownToLine size={18} />下载这个版本</button></div>
      </>}

      {view === 'settings' && <>
        <div className="page-header"><div><div className="eyebrow">个性化体验</div><h1>设置</h1><p>调整 EasyHub 的外观并管理 GitHub 连接。</p></div></div>
        <div className="settings-stack"><section className="panel settings-panel"><div className="settings-icon"><Globe2 size={22} /></div><div><h2>账户与连接</h2><p>已连接 GitHub：{user.login}。你的项目仍保存在 GitHub。</p><button className="button button-quiet" onClick={onLogout}>退出登录</button></div></section><section className="panel settings-panel"><div className="settings-icon blue"><Square size={22} /></div><div className="settings-panel-content"><h2>窗口控件</h2><p>选择窗口顶部按钮的外观。更改会立即生效，并保存在这台电脑上。</p><div className="window-style-options" role="group" aria-label="窗口控件样式"><button className={`window-style-option ${windowStyle === 'windows' ? 'selected' : ''}`} aria-pressed={windowStyle === 'windows'} onClick={() => setWindowStyle('windows')}><span className="window-style-preview windows-preview" aria-hidden="true"><span /><span /><span /></span><span><strong>Windows 风格</strong><small>默认 · 右上角按钮</small></span>{windowStyle === 'windows' && <Check size={18} className="window-style-check" />}</button><button className={`window-style-option ${windowStyle === 'reference' ? 'selected' : ''}`} aria-pressed={windowStyle === 'reference'} onClick={() => setWindowStyle('reference')}><span className="window-style-preview reference-preview" aria-hidden="true"><span /><span /><span /></span><span><strong>圆点风格</strong><small>参考图 · 左上角圆点</small></span>{windowStyle === 'reference' && <Check size={18} className="window-style-check" />}</button></div></div></section><LayoutSettingsPanel language={language} preference={layout.preference} density={layout.density} onChange={layout.setPreference} /><AiSettingsPanel language={language} />
        <section className="panel settings-panel"><div className="settings-icon blue"><Languages size={22} /></div><div className="translation-settings"><div><h2>内容翻译</h2><p>使用顶部的翻译开关查看译文，再次关闭即可查看原文。公开文本由第三方服务翻译，译文保存在这台电脑上。</p></div><div className="translation-target-row"><span>目标语言</span><StyledDropdown label="翻译目标语言" value={translationTarget} options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]} onChange={(value) => setTranslationTarget(value as TranslationTargetLanguage)} /></div><label className="translation-names-label" htmlFor="translation-names">不翻译的名称</label><p className="translation-names-help">当前项目、作者和链接中的 GitHub 项目名称会自动保留。其他产品名或专有名称可在这里补充，每行一个。</p><textarea id="translation-names" aria-label="不翻译的名称" rows={4} maxLength={8000} value={translationNamesText} onChange={(event) => setTranslationNamesText(event.target.value)} placeholder="每行输入一个需要保留的名称" /><small className="muted">已保存 {translationNames.length} 个名称，仅保存在这台电脑上。</small></div></section>
        <HostsRepairPanel language={language} />
        <section className="panel settings-panel"><div className="settings-icon amber"><Info size={22} /></div><div><h2>关于 EasyHub</h2><p>Windows 桌面版 · 直接连接 GitHub</p><span className="settings-version">版本 1.2.2</span><AppUpdatePanel language={language} /><div className="license-details"><strong>Apache 2.0</strong><span>本应用采用 Apache License 2.0 许可协议。</span><button className="text-link" onClick={() => void window.easyHub?.openLicense()}>查看许可协议 <ArrowRight size={15} /></button></div></div></section></div>
      </>}
    </div></main></NavigationPages>{canScrollDown && <button className="scroll-down-cue" aria-label="向下滚动" onClick={() => scrollArea.current?.scrollBy({ top: Math.max(300, scrollArea.current.clientHeight * 0.75), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}><ChevronRight size={27} strokeWidth={2.6} style={{ transform: 'rotate(90deg)' }} /></button>}</div>

    {refreshError && <div className="live-error refresh-feedback" role="alert">{refreshError}<button onClick={() => setRefreshError('')} aria-label={language === 'en' ? 'Dismiss refresh error' : '关闭刷新错误'}><X size={15} /></button></div>}
    {introEditing && selected && <IntroductionEditor initialMarkdown={introExpected} repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }} live saving={introSaving} saveError={introError} onSave={(content) => void saveIntroduction(content)} onCancel={() => setIntroEditing(false)} onOpenLink={(href) => void openReadmeLink(href, selected)} />}

  </div>;
}
