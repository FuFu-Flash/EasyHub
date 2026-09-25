import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GitHubComment, GitHubCommit, GitHubIssue, GitHubRelease, GitHubRepo, GitHubSearchUser, GitHubUser, TrendingPeriod } from '@easyhub/github';
import type { CreateReleaseInput, LocalProjectLink, LocalProjectStatus, ProjectRelease, ReleaseProgress, SyncPreview, TranslationTargetLanguage } from '@easyhub/types';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, CloudDownload, Compass, Folder, FolderOpen, Globe2, Home, Info, Languages, LockKeyhole, MessageCircle, Minus, Pencil, Plus, RotateCw, Search, Send, Settings2, Square, Tag, X } from 'lucide-react';
import appIcon from './assets/easyhub-icon.svg';
import pottedPlant from './assets/easyhub-potted-plant.svg';
import { LocalWorkspace } from './LocalWorkspace';
import { IntroductionEditor } from './components/IntroductionEditor';
import { ReadmeMarkdown } from './components/ReadmeMarkdown';
import { LiveProjectDangerZone } from './components/LiveProjectDangerZone';
import { PublicProjectBrowser } from './components/PublicProjectBrowser';
import { ReleaseDownloads } from './components/ReleaseDownloads';
import { ReleaseEditor } from './components/ReleaseEditor';
import { DownloadNotifications } from './components/DownloadNotifications';
import { TranslationPreferencesContext } from './components/TranslatableContent';
import { TranslatableContent } from './components/TranslatableContent';
import { readmeReleaseLink } from './components/readmeReleaseLink';
import { useDownloadCenter } from './components/useDownloadCenter';
import { UserProfile } from './components/UserProfile';
import { TrendingDiscover, type DiscoverScope, type SearchDisplayMode } from './components/TrendingDiscover';
import { createDomLocalizer, readLanguage, type Language } from './i18n';
import { historyKey, readSearchHistory, rememberSearch, type SearchEntry, type SearchScope } from './searchHistory';
import { publicBookmarksKey, readPublicBookmarks } from './publicBookmarks';

type View = 'home' | 'projects' | 'discover' | 'profile' | 'project' | 'public-project' | 'downloads' | 'new-release' | 'issues' | 'issue' | 'history' | 'version' | 'new-project' | 'local' | 'settings';
type Action = 'repos' | 'searchPublicRepos' | 'publicRepo' | 'createRepo' | 'readme' | 'issues' | 'createIssue' | 'updateIssue' | 'comments' | 'createComment' | 'commits' | 'commit';

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
  const [view, setView] = useState<View>('home');
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selected, setSelected] = useState<GitHubRepo | null>(null);
  const [publicSelected, setPublicSelected] = useState<GitHubRepo | null>(null);
  const [publicInitialDownload, setPublicInitialDownload] = useState<{ tag?: string } | null>(null);
  const [downloadFocusTag, setDownloadFocusTag] = useState<string | undefined>();
  const [releaseHistory, setReleaseHistory] = useState<ProjectRelease[]>([]);
  const [releaseImages, setReleaseImages] = useState<Record<string, string>>({});
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseProgress, setReleaseProgress] = useState<ReleaseProgress | null>(null);
  const [publicReturnView, setPublicReturnView] = useState<'projects' | 'discover' | 'profile'>('discover');
  const [profileUser, setProfileUser] = useState<GitHubUser>(user);
  const [profileReturnView, setProfileReturnView] = useState<'home' | 'discover'>('home');
  const [savedPublicRepos, setSavedPublicRepos] = useState<GitHubRepo[]>(() => readPublicBookmarks(window.localStorage, user.login));
  const [readme, setReadme] = useState('');
  const [localLinks, setLocalLinks] = useState<LocalProjectLink[]>([]);
  const [localStatuses, setLocalStatuses] = useState<Record<string, LocalProjectStatus>>({});
  const [remotePreviews, setRemotePreviews] = useState<Record<string, SyncPreview>>({});
  const [checkingLocal, setCheckingLocal] = useState(false);
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
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>('open');
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [commit, setCommit] = useState<GitHubCommit | null>(null);
  const [busy, setBusy] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('mine');
  const [discoverScope, setDiscoverScope] = useState<DiscoverScope>('projects');
  const [discoverPeriod, setDiscoverPeriod] = useState<TrendingPeriod>('today');
  const [discoverPage, setDiscoverPage] = useState(1);
  const [searchDisplayMode, setSearchDisplayMode] = useState<SearchDisplayMode>(() => window.localStorage.getItem('easyhub:search-display-mode') === 'detailed' ? 'detailed' : 'compact');
  const [searchHistory, setSearchHistory] = useState(() => readSearchHistory(window.localStorage, user.login));
  const [publicRepos, setPublicRepos] = useState<GitHubRepo[]>([]);
  const [publicSearchBusy, setPublicSearchBusy] = useState(false);
  const [publicSearchError, setPublicSearchError] = useState('');
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [reply, setReply] = useState('');
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [windowStyle, setWindowStyle] = useState<'windows' | 'reference'>(() => window.localStorage.getItem('easyhub:window-control-style') === 'reference' ? 'reference' : 'windows');
  const [automaticTranslation, setAutomaticTranslation] = useState(() => window.localStorage.getItem('easyhub:auto-translate') === 'true');
  const [translationTarget, setTranslationTarget] = useState<TranslationTargetLanguage>(() => window.localStorage.getItem('easyhub:translation-target') === 'en' ? 'en' : 'zh-CN');
  const [translationNamesText, setTranslationNamesText] = useState(() => window.localStorage.getItem(`easyhub:translation-names:${user.login}`) ?? '');
  const translationNames = useMemo(() => [...new Set(translationNamesText.split(/[,\n]/u).map((name) => name.trim()).filter((name) => name.length >= 2 && name.length <= 80))].slice(0, 100), [translationNamesText]);
  const issueAuthorNames = [issue?.user?.login, ...comments.map((item) => item.user?.login)].filter((name): name is string => Boolean(name));
  const [canScrollDown, setCanScrollDown] = useState(false);
  const date = (value: string): string => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const appRoot = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const discoverScrollPosition = useRef<number | null>(null);
  const localizer = useRef(createDomLocalizer());
  const cancelled = useRef(false);

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
    setPublicReturnView(view === 'profile' ? 'profile' : view === 'discover' ? 'discover' : 'projects');
    setPublicInitialDownload(null); setPublicSelected(repo); setView('public-project'); setError('');
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
      setDownloadFocusTag(release.tag); setView('downloads'); return;
    }
    const owned = repos.find((item) => item.owner.login.toLowerCase() === release.owner.toLowerCase() && item.name.toLowerCase() === release.repo.toLowerCase());
    if (owned) { setSelected(owned); setDownloadFocusTag(release.tag); setView('downloads'); return; }
    try {
      const remote = await api<GitHubRepo>('publicRepo', release.owner, release.repo);
      if (view !== 'public-project') setPublicReturnView(view === 'profile' ? 'profile' : view === 'discover' ? 'discover' : 'projects');
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
    const content = area?.querySelector('.page-content');
    if (!area || !content) return;
    const update = (): void => setCanScrollDown(area.scrollTop + area.clientHeight < area.scrollHeight - 3);
    const observer = new ResizeObserver(update);
    observer.observe(area); observer.observe(content);
    area.addEventListener('scroll', update, { passive: true });
    update();
    return () => { observer.disconnect(); area.removeEventListener('scroll', update); };
  }, [view, repos, issues, commits, comments, busy]);

  useLayoutEffect(() => {
    if (view !== 'discover' || discoverScrollPosition.current === null) return;
    const area = scrollArea.current;
    const content = area?.querySelector('.page-content');
    if (!area || !content) return;
    const restore = (): void => {
      if (discoverScrollPosition.current === null) return;
      if (!content.querySelector('.trending-card, .user-search-card')) return;
      const target = discoverScrollPosition.current;
      area.scrollTop = target;
      if (Math.abs(area.scrollTop - target) < 2) discoverScrollPosition.current = null;
    };
    const observer = new ResizeObserver(restore);
    observer.observe(content);
    restore();
    return () => observer.disconnect();
  }, [view, discoverPeriod, discoverPage, discoverScope, search]);

  const loadRepos = useCallback(async () => {
    cancelled.current = false; setBusy(true); setCanCancel(true); setError('');
    try {
      const all: GitHubRepo[] = [];
      for (let page = 1; page <= 100; page++) {
        const batch = await api<GitHubRepo[]>('repos', page);
        all.push(...batch);
        setRepos([...all]);
        if (batch.length < 100 || cancelled.current) break;
      }
      setRepos(all);
    } catch (cause) { if (!cancelled.current) setError(message(cause)); }
    finally { setBusy(false); setCanCancel(false); }
  }, []);

  useEffect(() => { void loadRepos(); }, [loadRepos]);
  const refreshLocalLinks = useCallback(async () => { setLocalLinks(await window.easyHub?.localList() ?? []); }, []);
  const downloads = useDownloadCenter(refreshLocalLinks);
  useEffect(() => { void refreshLocalLinks(); }, [refreshLocalLinks]);
  useEffect(() => {
    if (view !== 'home' || !window.easyHub || localLinks.length === 0) return;
    let active = true;
    setCheckingLocal(true);
    void (async () => {
      for (const link of localLinks.slice(0, 4)) {
        if (!active) break;
        try {
          const status = await window.easyHub!.localStatus(link.id);
          if (active) setLocalStatuses((current) => ({ ...current, [link.id]: status }));
          if (active && status.files.length === 0) {
            const preview = await window.easyHub!.localCheckSync(link.id);
            if (active) setRemotePreviews((current) => ({ ...current, [link.id]: preview }));
          }
        } catch { /* A missing folder can be repaired in the local projects view. */ }
      }
      if (active) setCheckingLocal(false);
    })();
    return () => { active = false; };
  }, [view, localLinks]);

  useEffect(() => {
    if (searchScope !== 'public' || search.trim().length < 2 || view === 'discover' && discoverScope === 'users' || view !== 'discover' && view !== 'projects') {
      setPublicRepos([]); setPublicSearchBusy(false); setPublicSearchError(''); return;
    }
    let active = true;
    setPublicRepos([]); setPublicSearchBusy(true); setPublicSearchError('');
    const timer = window.setTimeout(() => {
      void api<GitHubRepo[]>('searchPublicRepos', search.trim()).then((items) => {
        if (active) { setPublicRepos(items); recordSearch(search, 'public'); }
      }).catch((cause: unknown) => {
        if (active) setPublicSearchError(message(cause));
      }).finally(() => { if (active) setPublicSearchBusy(false); });
    }, 450);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, searchScope, discoverScope, view, recordSearch]);

  async function beginEditIntroduction(): Promise<void> {
    if (!selected || selected.archived || !window.easyHub) return;
    setError(''); setIntroError('');
    try {
      const links = await window.easyHub.localList();
      setLocalLinks(links);
      const link = links.find((item) => item.repositoryId === selected.id);
      if (!link) { setView('local'); return; }
      setIntroExpected(await window.easyHub.localReadIntroduction(link.id)); setIntroEditing(true);
    }
    catch (cause) { setError(message(cause)); }
  }

  async function saveIntroduction(content: string): Promise<void> {
    if (!selected || !window.easyHub) return;
    const link = localLinks.find((item) => item.repositoryId === selected.id);
    if (!link) return;
    setIntroSaving(true); setIntroError('');
    try {
      await window.easyHub.localSaveIntroduction(link.id, introExpected, content);
      setReadme(content); setIntroEditing(false); setNotice('介绍已保存到本地，发布源码后同步到 GitHub。');
    } catch (cause) { setIntroError(message(cause)); }
    finally { setIntroSaving(false); }
  }

  async function openProject(repo: GitHubRepo): Promise<void> {
    cancelled.current = false; setSelected(repo); setView('project'); setReadme(''); setIssues([]); setCommits([]); setError(''); setBusy(true); setCanCancel(true);
    try {
      const [intro, items, history] = await Promise.all([
        api<string>('readme', ownerOf(repo), repo.name),
        api<GitHubIssue[]>('issues', ownerOf(repo), repo.name, 'all'),
        api<GitHubCommit[]>('commits', ownerOf(repo), repo.name),
      ]);
      setReadme(intro); setIssues(items); setCommits(history);
    } catch (cause) { if (!cancelled.current) setError(message(cause)); }
    finally { setBusy(false); setCanCancel(false); }
  }

  async function openIssue(item: GitHubIssue, project: GitHubRepo | null = selected): Promise<void> {
    if (!project) return;
    cancelled.current = false; setSelected(project); setIssues(issueGroups[project.id] ?? (selected?.id === project.id ? issues : []));
    setIssue(item); setView('issue'); setComments([]); setBusy(true); setCanCancel(true); setError('');
    try { setComments(await api<GitHubComment[]>('comments', ownerOf(project), project.name, item.number)); }
    catch (cause) { if (!cancelled.current) setError(message(cause)); }
    finally { setBusy(false); setCanCancel(false); }
  }

  async function toggleIssueGroup(repo: GitHubRepo): Promise<void> {
    if (expandedRepo === repo.id) { setExpandedRepo(null); return; }
    setExpandedRepo(repo.id); setError('');
    if (issueGroups[repo.id]) return;
    cancelled.current = false; setBusy(true); setCanCancel(true);
    try { const items = await api<GitHubIssue[]>('issues', ownerOf(repo), repo.name, 'all'); setIssueGroups((groups) => ({ ...groups, [repo.id]: items })); }
    catch (cause) { if (!cancelled.current) setError(message(cause)); }
    finally { setBusy(false); setCanCancel(false); }
  }

  async function openVersion(item: GitHubCommit): Promise<void> {
    if (!selected) return;
    cancelled.current = false; setCommit(item); setView('version'); setBusy(true); setCanCancel(true); setError('');
    try { setCommit(await api<GitHubCommit>('commit', ownerOf(selected), selected.name, item.sha)); }
    catch (cause) { if (!cancelled.current) setError(message(cause)); }
    finally { setBusy(false); setCanCancel(false); }
  }

  async function createIssue(event: FormEvent): Promise<void> {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError('');
    try {
      const result = await api<GitHubIssue>('createIssue', ownerOf(selected), selected.name, issueTitle.trim(), issueBody.trim());
      setIssues((items) => [result, ...items]); setShowIssueForm(false); setIssueTitle(''); setIssueBody(''); setNotice('问题已创建。');
      await openIssue(result);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function sendReply(event: FormEvent): Promise<void> {
    event.preventDefault(); if (!selected || !issue || !reply.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await api<GitHubComment>('createComment', ownerOf(selected), selected.name, issue.number, reply.trim());
      setComments((items) => [...items, result]); setReply(''); setNotice('回复已发送。');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function changeIssueState(): Promise<void> {
    if (!selected || !issue) return;
    setBusy(true); setError('');
    try {
      const next = await api<GitHubIssue>('updateIssue', ownerOf(selected), selected.name, issue.number, issue.state === 'open' ? 'closed' : 'open');
      setIssue(next); setIssues((items) => items.map((item) => item.number === next.number ? next : item));
      setIssueGroups((groups) => { const current = groups[selected.id]; return current ? { ...groups, [selected.id]: current.map((item) => item.number === next.number ? next : item) } : groups; });
      setNotice(next.state === 'closed' ? '问题已标记为解决。' : '问题已重新打开。');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function download(ref: string): Promise<void> {
    if (!selected) return;
    await downloads.start({ kind: 'archive', repo: selected, ref, fileName: `${selected.name}-${ref.slice(0, 8)}.zip` });
  }

  async function openNewRelease(): Promise<void> {
    if (!selected || selected.archived || !window.easyHub) return;
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
    if (!selected || !window.easyHub) return;
    setReleaseBusy(true); setError(''); setReleaseProgress(null);
    try {
      const result = await window.easyHub.publishRelease({ owner: ownerOf(selected), repo: selected.name,
        tagName: input.tagName, title: input.title, body: input.body, channel: input.channel, assetIds: input.assets.map((asset) => asset.id) });
      setNotice('新版本已发布到 GitHub。'); setDownloadFocusTag(result.tag_name); setView('downloads');
    } catch (cause) { setError(message(cause)); }
    finally { setReleaseBusy(false); setReleaseProgress(null); }
  }

  async function refreshCurrent(): Promise<void> {
    await loadRepos();
    if (!selected || cancelled.current) return;
    setBusy(true); setCanCancel(true); setError('');
    try {
      const [intro, items, history] = await Promise.all([
        api<string>('readme', ownerOf(selected), selected.name),
        api<GitHubIssue[]>('issues', ownerOf(selected), selected.name, 'all'),
        api<GitHubCommit[]>('commits', ownerOf(selected), selected.name),
      ]);
      setReadme(intro); setIssues(items); setCommits(history);
      setIssueGroups((groups) => ({ ...groups, [selected.id]: items }));
      if (view === 'issue' && issue) {
        setIssue(items.find((item) => item.number === issue.number) ?? issue);
        setComments(await api<GitHubComment[]>('comments', ownerOf(selected), selected.name, issue.number));
      }
      if (view === 'version' && commit) setCommit(await api<GitHubCommit>('commit', ownerOf(selected), selected.name, commit.sha));
    } catch (cause) { if (!cancelled.current) setError(message(cause)); }
    finally { setBusy(false); setCanCancel(false); }
  }

  function cancelReads(): void { cancelled.current = true; void window.easyHub?.cancelGithubReads(); }

  async function publishFromHome(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!pendingLocal || !homeUpdateMessage.trim() || !window.easyHub) return;
    setBusy(true); setError('');
    try {
      const preview = await window.easyHub.localCheckSync(pendingLocal.link.id);
      if (preview.state === 'blocked') { setError(preview.message ?? '暂时无法安全发布。'); return; }
      if (preview.state === 'review') {
        setHomeSyncReview({ id: pendingLocal.link.id, preview, message: homeUpdateMessage.trim() });
        setSelected(pendingLocal.repo ?? null); setView('local'); return;
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
      if (preview.state === 'review') { setHomeSyncReview({ id: link.id, preview, message: '' }); setSelected(repo); setView('local'); return; }
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

  const filtered = repos.filter((repo) => `${repo.name} ${repo.description ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const savedPublicMatches = savedPublicRepos.filter((repo) => `${repo.full_name} ${repo.description ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const visibleIssues = issues.filter((item) => item.state === 'open');
  const pendingIssueCount = (repo: GitHubRepo): number => issueGroups[repo.id]?.filter((item) => item.state === 'open').length ?? repo.open_issues_count;
  const orderedIssueRepos = [...repos].sort((a, b) => Number(pendingIssueCount(b) > 0) - Number(pendingIssueCount(a) > 0) || pendingIssueCount(b) - pendingIssueCount(a) || a.name.localeCompare(b.name));
  const totalPendingIssues = repos.reduce((total, repo) => total + pendingIssueCount(repo), 0);
  const pendingLocal = localLinks.map((link) => ({ link, repo: repos.find((repo) => repo.id === link.repositoryId), status: localStatuses[link.id] })).find((item) => item.repo && item.status?.files.length);
  const nav = view === 'issue' || view === 'issues' ? 'issues' : view === 'settings' ? 'settings' : view === 'home' ? 'home' : view === 'discover' || view === 'public-project' && publicReturnView === 'discover' ? 'discover' : view === 'profile' || view === 'public-project' && publicReturnView === 'profile' ? 'profile' : 'projects';

  function homeRepoRow(repo: GitHubRepo) {
    const link = localLinks.find((item) => item.repositoryId === repo.id);
    const changed = link ? localStatuses[link.id]?.files.length ?? 0 : 0;
    const remote = link ? remotePreviews[link.id] : undefined;
    const hasRemote = remote?.state === 'ready' || remote?.state === 'review';
    return <div className="home-project-row" key={repo.id}>
      <RepoLogo repo={repo} />
      <button className="home-project-name" onClick={() => void openProject(repo)}><strong>{repo.name}</strong><span>{repo.description || '还没有项目介绍'}</span></button>
      <div className="home-project-meta"><span className={`home-row-status ${remote?.state === 'review' ? 'changes' : changed ? 'changes' : hasRemote ? 'remote' : 'saved'}`}><i />{remote?.state === 'review' ? '有内容需要确认' : changed ? `有 ${changed} 个文件还没发布` : hasRemote ? 'GitHub 上有新内容' : link && localStatuses[link.id] ? '已保存' : '保存在 GitHub'}</span><small>{relativeDate(repo.updated_at, language)}更新 · {pendingIssueCount(repo)} 个问题</small></div>
      <div className="home-project-actions">{remote?.state === 'review' ? <button className="button button-primary" onClick={() => { setHomeSyncReview({ id: link!.id, preview: remote, message: '' }); setSelected(repo); setView('local'); }}>确认内容</button> : changed ? <button className="button button-primary" onClick={() => { setSelected(repo); setView('local'); }}>查看修改</button> : hasRemote && link ? <button className="button button-quiet" disabled={busy} onClick={() => void getLatestFromHome(link, repo)}>获取最新</button> : <button className="button button-quiet" onClick={() => void openProject(repo)}>打开项目</button>}</div>
    </div>;
  }

  return <div className="app-shell live-shell" ref={appRoot}>
    <aside className="sidebar"><nav className="sidebar-nav" aria-label="主导航">
      <button className={nav === 'home' ? 'active' : ''} onClick={() => { rememberDiscoverPosition(); setView('home'); }}><Home size={19} />首页</button>
      <button className={nav === 'projects' ? 'active' : ''} onClick={() => { rememberDiscoverPosition(); setView('projects'); }}><Folder size={19} />我的项目</button>
      <button className={nav === 'discover' ? 'active' : ''} onClick={() => { if (nav !== 'discover' && discoverScrollPosition.current === null) setSearch(''); setSearchScope('public'); setView('discover'); }}><Compass size={19} />发现</button>
      <button className={nav === 'issues' ? 'active' : ''} onClick={() => { rememberDiscoverPosition(); setSelected(null); setView('issues'); }}><MessageCircle size={19} />问题{totalPendingIssues > 0 && <span className="nav-count">{totalPendingIssues}</span>}</button>
      <button className={nav === 'settings' ? 'active' : ''} onClick={() => { rememberDiscoverPosition(); setView('settings'); }}><Settings2 size={19} />设置</button>
    </nav><div className="sidebar-bottom"><span className="sidebar-demo live-connected"><span />{language === 'en' ? 'Connected to GitHub' : '已连接 GitHub'} · {user.login}</span></div></aside>
    <div className="main-column" ref={scrollArea}><header className={`topbar topbar-${windowStyle}`}>
      {windowStyle === 'reference' && <div className="window-controls" aria-label="窗口控制"><button className="window-dot window-close" aria-label="关闭窗口" onClick={() => void window.easyHub?.closeWindow()} /><button className="window-dot window-minimize" aria-label="最小化窗口" onClick={() => void window.easyHub?.minimizeWindow()} /><button className="window-dot window-maximize" aria-label="最大化或还原窗口" onClick={() => void window.easyHub?.toggleMaximizeWindow()} /></div>}
      <button className="topbar-brand" onClick={() => { rememberDiscoverPosition(); setView('home'); }}><img src={appIcon} alt="" /><span>EasyHub</span></button>
      <label className="topbar-search"><Search size={19} /><input aria-label="搜索项目/用户" value={search} onFocus={() => { setSearchScope('public'); setView('discover'); }} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') recordSearch(search, discoverScope === 'users' ? 'users' : 'public'); }} placeholder="搜索项目/用户..." /></label>
      <div className="topbar-actions">
        <button className={`icon-button translation-toggle ${automaticTranslation ? 'active' : ''}`} type="button" aria-label={automaticTranslation ? '关闭翻译' : '开启翻译'} aria-pressed={automaticTranslation} title={automaticTranslation ? '关闭翻译' : '开启翻译'} onClick={() => setAutomaticTranslation((enabled) => !enabled)}><Languages size={21} strokeWidth={1.8} /></button>
        <div className="language-switcher"><button className="icon-button language-trigger" aria-label="选择语言" aria-expanded={languageMenuOpen} title="语言" onClick={() => setLanguageMenuOpen((open) => !open)}><Globe2 size={21} strokeWidth={1.8} /></button>{languageMenuOpen && <div className="language-menu" role="group" aria-label="语言选项"><button aria-pressed={language === 'zh'} onClick={() => { setLanguage('zh'); setLanguageMenuOpen(false); }}><span>中文</span>{language === 'zh' && <Check size={16} />}</button><button aria-pressed={language === 'en'} onClick={() => { setLanguage('en'); setLanguageMenuOpen(false); }}><span>English</span>{language === 'en' && <Check size={16} />}</button></div>}</div>
        <DownloadNotifications center={downloads} savedPublicRepoIds={savedPublicRepos.map((item) => item.id)} onAddPublic={addPublicProject} />
        <button className="icon-button" aria-label="设置" onClick={() => { rememberDiscoverPosition(); setView('settings'); }}><Settings2 size={20} /></button>
        <button className="topbar-profile" aria-label="个人页面" onClick={() => { rememberDiscoverPosition(); setProfileUser(user); setProfileReturnView(view === 'discover' ? 'discover' : 'home'); setView('profile'); }}><span className="topbar-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="" /> : user.login.slice(0, 1).toUpperCase()}</span><ChevronDown size={16} /></button>
      </div>
      {windowStyle === 'windows' && <div className="windows-window-controls" aria-label="窗口控制"><button className="windows-control-button" aria-label="最小化窗口" title="最小化" onClick={() => void window.easyHub?.minimizeWindow()}><Minus size={17} strokeWidth={1.6} /></button><button className="windows-control-button" aria-label="最大化或还原窗口" title="最大化或还原" onClick={() => void window.easyHub?.toggleMaximizeWindow()}><Square size={13} strokeWidth={1.7} /></button><button className="windows-control-button windows-control-close" aria-label="关闭窗口" title="关闭" onClick={() => void window.easyHub?.closeWindow()}><X size={17} strokeWidth={1.6} /></button></div>}
    </header><main className="page-content live-page">
      {error && <div className="live-error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div>}
      {notice && <div className="live-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={15} /></button></div>}
      {busy && <div className="live-loading"><RotateCw size={16} className="live-spin" />正在与 GitHub 同步…{canCancel && <button className="text-link" onClick={cancelReads}>取消</button>}</div>}

      {view === 'home' && <>
        <section className="home-hero"><div className="home-hero-copy"><h1>早上好，<br />今天也来做点有趣的事情吧！ <span className="wave">👋</span></h1><p>你的项目都在这里，随时可以继续创作和发布更新。</p></div><div className="home-mascot" aria-hidden="true"><div className="mascot-cloud" /><div className="mascot-note">记录创意<br />分享给世界<br />从这里开始！</div><div className="mascot-character"><img src={appIcon} alt="" /><div className="mascot-arm left" /><div className="mascot-arm right" /><div className="mascot-laptop"><span>✦</span></div></div><img className="mascot-plant" src={pottedPlant} alt="" /></div></section>
        <button className="home-create" onClick={() => setView('new-project')}><span className="home-create-icon"><Plus size={31} /></span><span><strong>新建项目</strong><small>从一个新想法开始</small></span><ChevronRight size={22} /></button>
        {pendingLocal?.repo && pendingLocal.status ? <form className="home-publish" onSubmit={(event) => void publishFromHome(event)}><RepoLogo repo={pendingLocal.repo} /><div className="home-publish-content"><strong>{pendingLocal.repo.name} 有 {pendingLocal.status.files.length} 个文件发生变化</strong><label htmlFor="live-home-update-message">这次改了什么？</label><div className="home-publish-controls"><input id="live-home-update-message" value={homeUpdateMessage} onChange={(event) => setHomeUpdateMessage(event.target.value)} placeholder="例如：修复窗口缩放问题" maxLength={120} /><button className="button button-primary" type="submit" disabled={busy || !homeUpdateMessage.trim()}><Send size={17} />发布更新</button></div></div><button className="icon-button home-publish-detail" type="button" aria-label="查看修改" onClick={() => { setSelected(pendingLocal.repo ?? null); setView('local'); }}><ChevronRight size={20} /></button></form> : <div className="home-all-saved"><CheckCircle2 size={20} />{checkingLocal ? '正在检查本地修改…' : '你的项目已连接到 GitHub。'}<button onClick={() => { setSelected(null); setView('local'); }}>查看本地修改 <ArrowRight size={16} /></button></div>}
        <div className="home-dashboard"><section className="home-panel home-projects-panel"><div className="home-panel-heading"><h2>我的项目</h2><button className="text-link" onClick={() => setView('projects')}>查看全部 <ChevronRight size={17} /></button></div><div className="home-project-list">{repos.slice(0, 3).map(homeRepoRow)}{repos.length === 0 && !busy && <p className="live-empty">还没有项目。你可以先创建一个。</p>}</div></section><section className="home-panel home-recent-panel"><div className="home-panel-heading"><h2>最近更新</h2><button className="text-link" onClick={() => setView('projects')}>查看全部 <ChevronRight size={17} /></button></div><div className="home-recent-list">{repos.slice(0, 4).map((repo) => <button className="home-recent-row" key={repo.id} onClick={() => void openProject(repo)}><RepoLogo repo={repo} small /><span><strong>{repo.name}</strong><small>{relativeDate(repo.updated_at, language)}</small><em>{repo.description || '查看项目最新内容'}</em></span></button>)}</div></section></div>
        <div className="home-shortcuts"><button onClick={() => { setSelected(null); setView('local'); }}><CloudDownload size={17} />从 GitHub 下载项目 <ArrowRight size={15} /></button><button onClick={() => { setSelected(null); setView('local'); }}><FolderOpen size={17} />添加现有文件夹 <ArrowRight size={15} /></button></div>
      </>}

      {view === 'profile' && <UserProfile key={profileUser.login} login={profileUser.login} initialUser={profileUser} onBack={() => setView(profileReturnView)} onOpenRepository={(fullName) => void openProfileRepository(fullName)} />}

      {view === 'discover' && <TrendingDiscover query={search} setQuery={setSearch} scope={discoverScope} onScopeChange={setDiscoverScope} period={discoverPeriod} onPeriodChange={(period) => { setDiscoverPeriod(period); setDiscoverPage(1); }} page={discoverPage} onPageChange={changeDiscoverPage} displayMode={searchDisplayMode} onDisplayMode={setSearchDisplayMode} history={searchHistory} onSelectHistory={selectSearchHistory} onClearHistory={clearSearchHistory} searchResults={publicRepos} searchBusy={publicSearchBusy} searchError={publicSearchError} onOpen={openPublicProject} onOpenProfile={openSearchedUser} onSearch={(value) => recordSearch(value, 'public')} onUserSearched={recordUserSearch} />}

      {view === 'projects' && <>
        <div className="page-header"><div><div className="eyebrow">你的作品</div><h1>我的项目</h1><p>所有灵感和进展，都在这里。</p></div><button className="button button-primary" onClick={() => setView('new-project')}><Plus size={18} />新建项目</button></div>
        <div className="toolbar"><div className="segmented" role="group" aria-label="搜索范围"><button className={searchScope === 'local' ? 'selected' : ''} aria-pressed={searchScope === 'local'} onClick={() => setSearchScope('local')}>这台电脑 <span>{localLinks.length}</span></button><button className={searchScope === 'mine' ? 'selected' : ''} aria-pressed={searchScope === 'mine'} onClick={() => setSearchScope('mine')}>我的云端项目 <span>{repos.length}</span></button><button className={searchScope === 'public' ? 'selected' : ''} aria-pressed={searchScope === 'public'} onClick={() => setSearchScope('public')}>所有公开项目</button></div><label className="search-box"><Search size={17} /><input aria-label="筛选项目" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') recordSearch(search, searchScope); }} onBlur={() => { if (searchScope !== 'public') recordSearch(search, searchScope); }} placeholder={searchScope === 'public' ? '搜索公开项目' : '搜索项目'} /></label></div>
        {!search.trim() && searchHistory.length > 0 && <section className="search-history panel"><div className="panel-heading"><h2>搜索历史</h2><button className="text-link" onClick={clearSearchHistory}>清除全部</button></div><div className="search-history-list">{searchHistory.map((entry) => <button key={`${entry.scope}:${entry.query}`} onClick={() => selectSearchHistory(entry)}><Clock3 size={15} /><span>{entry.query}</span><small>{entry.scope === 'users' ? '用户' : entry.scope === 'public' ? '公开项目' : entry.scope === 'local' ? '这台电脑' : '我的云端项目'}</small></button>)}</div></section>}
        {searchScope === 'mine' && savedPublicMatches.length > 0 && <section className="panel saved-public-section"><div className="panel-heading"><h2>收藏的公开项目</h2><span className="muted">只读快捷入口</span></div>{savedPublicMatches.map((repo) => <div className="cloud-row" key={repo.id}><RepoLogo repo={repo} small /><div><button className="plain-heading" onClick={() => openPublicProject(repo)}>{repo.full_name}</button><small>{repo.description || '还没有一句介绍'}</small></div><span className="public-readonly-label">只读</span><button className="button button-quiet" onClick={() => openPublicProject(repo)}>浏览</button></div>)}</section>}
        {searchScope === 'local' ? <div className="project-grid">{localLinks.filter((link) => link.name.toLowerCase().includes(search.toLowerCase())).map((link) => { const repo = repos.find((item) => item.id === link.repositoryId); return <article className="project-card" key={link.id}><div className="card-head">{repo ? <RepoLogo repo={repo} /> : <span className="project-logo logo-sky"><Folder size={23} /></span>}</div><button className="plain-heading" onClick={() => { if (repo) void openProject(repo); else { setSelected(null); setView('local'); } }}>{link.name}</button><p className="card-description">{repo?.description || link.localPath}</p><span className="status status-saved"><span className="status-dot" />已保存</span><div className="card-footer"><span><Clock3 size={14} />{relativeDate(link.lastOpenedAt, language)}</span></div><div className="card-actions"><button className="button button-quiet" onClick={() => { setSelected(repo ?? null); setView('local'); }}>打开项目</button>{repo && <button className="button button-primary" onClick={() => void openProject(repo)}>查看详情</button>}</div></article>; })}{localLinks.length === 0 && <div className="empty-state"><span className="empty-icon"><FolderOpen size={28} /></span><h3>这台电脑还没有项目</h3><p>可以从 GitHub 下载，或添加已有文件夹。</p><button className="button button-primary" onClick={() => { setSelected(null); setView('local'); }}>添加项目</button></div>}</div> : <div className="cloud-list">{(searchScope === 'public' ? publicRepos : filtered).map((repo) => { const external = searchScope === 'public' && repo.owner.login !== user.login; const browse = (): void => { if (external) openPublicProject(repo); else void openProject(repo); }; return <div className="cloud-row" key={repo.id}><RepoLogo repo={repo} small /><div><button className="plain-heading" onClick={browse}>{searchScope === 'public' ? repo.full_name : repo.name}</button><small>{repo.description || '还没有一句介绍'} · {relativeDate(repo.updated_at, language)}更新</small></div><span className="cloud-private">{external ? '只读' : repo.private ? <><LockKeyhole size={14} />只有我</> : '所有人'}</span><button className="button button-quiet" onClick={browse}>{external ? '只读浏览' : '查看'}</button>{!external && <button className="button button-primary" onClick={() => { setSelected(repo); setView('local'); }}>下载 <ArrowDownToLine size={16} /></button>}</div>; })}{searchScope === 'public' ? (publicSearchBusy ? <p className="live-empty">正在搜索公开项目…</p> : publicSearchError ? <p className="live-empty live-search-error" role="alert">{publicSearchError}</p> : search.trim().length < 2 ? <p className="live-empty">输入至少 2 个字符，搜索 GitHub 上的公开项目。</p> : publicRepos.length === 0 ? <p className="live-empty">没有找到公开项目。</p> : null) : filtered.length === 0 && !busy && savedPublicMatches.length === 0 && <p className="live-empty">没有找到项目。</p>}</div>}
        <div className="home-shortcuts"><button onClick={() => { setSelected(null); setView('local'); }}><CloudDownload size={17} />从 GitHub 下载项目 <ArrowRight size={15} /></button><button onClick={() => { setSelected(null); setView('local'); }}><FolderOpen size={17} />添加现有文件夹 <ArrowRight size={15} /></button></div>
      </>}

      {view === 'new-project' && <LocalWorkspace mode="create" repos={repos} selectedRepo={null} onBack={() => setView('projects')} onCreated={async () => { await loadRepos(); await refreshLocalLinks(); }} onDownloadProject={(repo) => downloads.start({ kind: 'project', repo, fileName: repo.name })} downloadBusy={downloads.busy} />}

      {view === 'local' && <LocalWorkspace mode="list" repos={repos} selectedRepo={selected} initialSyncReview={homeSyncReview} onSyncReviewOpened={() => setHomeSyncReview(null)} onBack={() => setView(selected ? 'project' : 'projects')} onCreated={async () => { await loadRepos(); await refreshLocalLinks(); }} onDownloadProject={(repo) => downloads.start({ kind: 'project', repo, fileName: repo.name })} downloadBusy={downloads.busy} />}

      {view === 'public-project' && publicSelected && <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation, target: translationTarget, repository: { name: publicSelected.name, owner: publicSelected.owner.login, fullName: publicSelected.full_name }, names: translationNames }}><PublicProjectBrowser repo={publicSelected} language={language} onBack={() => setView(publicReturnView)} onOpenLink={(url) => void openReadmeLink(url, publicSelected)} onDownload={(request) => void downloads.start(request)} downloadBusy={downloads.busy} startInDownloads={Boolean(publicInitialDownload)} initialFocusTag={publicInitialDownload?.tag} /></TranslationPreferencesContext.Provider>}

      {view === 'downloads' && selected && <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}><ReleaseDownloads repo={selected} focusTag={downloadFocusTag} onDownload={(request) => void downloads.start(request)} downloadBusy={downloads.busy} onBack={() => setView('project')} /></TranslationPreferencesContext.Provider>}

      {view === 'new-release' && selected && <ReleaseEditor key={selected.id} project={{ name: selected.name,
        health: localLinks.some((link) => link.repositoryId === selected.id && (localStatuses[link.id]?.files.length ?? 0) > 0) ? 'changes' : 'saved',
        releases: releaseHistory }} language={language} busy={releaseBusy} progress={releaseProgress} imageSources={releaseImages}
        onRegisterInlineImage={(id, source) => setReleaseImages((current) => ({ ...current, [id]: typeof source === 'string' ? source : URL.createObjectURL(source) }))}
        onChooseFiles={(inline) => window.easyHub!.chooseReleaseFiles(inline)} onPublish={(input) => void publishNewRelease(input)}
        onBack={() => { if (releaseBusy) void window.easyHub?.cancelRelease(); else setView('project'); }} onOpenUpdate={() => setView('local')}
        onOpenLink={(url) => void window.easyHub?.openExternalLink(url)} />}


      {view === 'project' && selected && <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}>
        <button className="back-link" onClick={() => setView('projects')}><ArrowLeft size={17} />所有项目</button>
        <section className="detail-hero"><div className="detail-main"><RepoLogo repo={selected} /><div><div className="detail-name-row"><h1>{selected.name}</h1><span className="visibility-label">{selected.private ? <><LockKeyhole size={13} />只有我</> : <><Globe2 size={13} />所有人</>}</span></div>{!selected.private && selected.description ? <TranslatableContent text={selected.description} format="text" render={(value) => <p>{value}</p>} /> : <p>{selected.description || '还没有项目介绍'}</p>}<span className="status status-saved"><span className="status-dot" />{selected.archived ? '已存档 · 只读' : '已保存到 GitHub'}</span></div></div><div className="detail-actions"><button className="button button-primary" disabled={selected.archived} onClick={() => setView('local')}><FolderOpen size={17} />本地项目与发布源码</button>{!selected.archived && (selected.permissions?.push || ownerOf(selected).toLowerCase() === user.login.toLowerCase()) && <button className="button button-quiet" disabled={busy} onClick={() => void openNewRelease()}><Tag size={17} />发布新版本</button>}<button className="button button-quiet" onClick={() => { setDownloadFocusTag(undefined); setView('downloads'); }}><ArrowDownToLine size={17} />下载项目</button></div></section>
        <div className="detail-grid"><div className="detail-primary"><section className="panel"><div className="panel-heading"><h2>项目介绍</h2><button className="text-link" disabled={selected.archived} onClick={() => void beginEditIntroduction()}><Pencil size={15} />编辑介绍</button></div>{readme ? !selected.private ? <TranslatableContent text={readme} format="markdown" paragraphMode render={(value) => <ReadmeMarkdown markdown={value} repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }} onOpenLink={(href) => void openReadmeLink(href, selected)} />} /> : <ReadmeMarkdown markdown={readme} repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }} onOpenLink={(href) => void openReadmeLink(href, selected)} /> : <p className="muted">这个项目还没有介绍。</p>}</section><section className="panel"><div className="panel-heading"><h2>历史版本</h2><button className="text-link" onClick={() => setView('history')}>查看全部 <ArrowRight size={16} /></button></div><div className="timeline-list">{commits.slice(0, 3).map((item) => <button className="timeline-item" key={item.sha} onClick={() => void openVersion(item)}><span className="timeline-dot" /><span><strong>{item.commit.message.split('\n')[0]}</strong><small>{item.commit.author?.date ? relativeDate(item.commit.author.date, language) : ''}</small></span><ChevronRight size={17} /></button>)}{commits.length === 0 && <p className="muted">还没有历史版本。</p>}</div></section></div><div className="detail-side"><section className="panel side-panel"><div className="panel-heading"><h2>问题</h2><span className="count-bubble">{visibleIssues.length}</span></div><p>看看大家的反馈，一起让项目变得更好。</p><button className="button button-quiet full-width" onClick={() => setView('issues')}>查看问题 <ArrowRight size={16} /></button></section><section className="panel side-panel"><div className="panel-heading"><h2>项目状态</h2></div><div className="status-detail"><span className="big-status-dot saved" /><div><strong>已保存到 GitHub</strong><small>上次更新：{relativeDate(selected.updated_at, language)}</small></div></div><button className="text-link" onClick={() => setView('local')}>查看本地修改 <ArrowRight size={16} /></button></section></div></div>
        {(selected.owner.login.toLowerCase() === user.login.toLowerCase() || selected.permissions?.admin) && <LiveProjectDangerZone repo={selected} language={language} onUpdate={(updated) => { setSelected(updated); setRepos((items) => items.map((item) => item.id === updated.id ? updated : item)); }} onTransferred={() => { setView('projects'); void loadRepos(); }} onNotice={setNotice} />}
      </TranslationPreferencesContext.Provider>}

      {view === 'issues' && <>
        <div className="page-header"><div><div className="eyebrow">一起完善作品</div><h1>问题</h1><p>查看反馈、回复想法，解决遇到的困难。</p></div><button className="button button-primary" disabled={repos.length === 0} onClick={() => { if (!selected) setSelected(repos[0] ?? null); setShowIssueForm(true); }}><Plus size={18} />提出问题</button></div>
        <div className="toolbar"><div className="segmented"><button className={issueFilter === 'open' ? 'selected' : ''} onClick={() => setIssueFilter('open')}>待处理 <span>{selected ? issues.filter((item) => item.state === 'open').length : totalPendingIssues}</span></button><button className={issueFilter === 'closed' ? 'selected' : ''} onClick={() => setIssueFilter('closed')}>已解决</button></div>{selected && <button className="filter-project" onClick={() => setSelected(null)}>{selected.name}<X size={15} /></button>}</div>
        {selected ? <div className="issue-list">{issues.filter((item) => item.state === issueFilter).map((item) => <button className="issue-row" key={item.id} onClick={() => void openIssue(item)}><span className={`issue-indicator ${item.state === 'closed' ? 'closed' : ''}`}><CircleHelp size={19} /></span><span className="issue-row-main"><IssueListTitle issue={item} repo={selected} automatic={automaticTranslation} target={translationTarget} names={translationNames} /><small>{selected.name} · {item.user?.login || 'GitHub 用户'} · {relativeDate(item.created_at, language)}</small></span><span className="issue-comments"><MessageCircle size={16} />{item.comments}</span><ChevronRight size={18} className="chevron" /></button>)}{!busy && issues.filter((item) => item.state === issueFilter).length === 0 && <div className="empty-state"><span className="empty-icon"><MessageCircle size={28} /></span><h3>{issueFilter === 'open' ? '没有待处理的问题' : '还没有已解决的问题'}</h3><p>这里会显示项目收到的反馈。</p></div>}</div> : <div className="issue-project-list">{orderedIssueRepos.map((repo) => { const expanded = expandedRepo === repo.id; const items = (issueGroups[repo.id] || []).filter((item) => item.state === issueFilter); return <section className="issue-project-group live-issue-group" key={repo.id}><button className="issue-project-header" aria-expanded={expanded} onClick={() => void toggleIssueGroup(repo)}><RepoLogo repo={repo} small /><span className="issue-project-heading"><strong>{repo.name}</strong><small>{repo.description || '还没有项目介绍'}</small></span><span className={`issue-project-count ${issueFilter === 'open' && pendingIssueCount(repo) > 0 ? 'live-pending-count' : ''}`}>{issueFilter === 'open' ? `${pendingIssueCount(repo)} 个待处理的问题` : expanded ? `${items.length} 个已解决的问题` : '查看已解决的问题'}</span><ChevronDown className={`issue-project-chevron ${expanded ? 'expanded' : ''}`} size={19} /></button><div className="issue-project-items live-group-items" hidden={!expanded}>{expanded && (items.length ? items.map((item) => <button className="issue-row" key={item.id} onClick={() => void openIssue(item, repo)}><span className={`issue-indicator ${item.state === 'closed' ? 'closed' : ''}`}><CircleHelp size={19} /></span><span className="issue-row-main"><IssueListTitle issue={item} repo={repo} automatic={automaticTranslation} target={translationTarget} names={translationNames} /><small>{item.user?.login || 'GitHub 用户'} · {relativeDate(item.created_at, language)}</small></span><span className="issue-comments"><MessageCircle size={16} />{item.comments}</span><ChevronRight size={18} className="chevron" /></button>) : issueGroups[repo.id] && <p className="live-empty">{issueFilter === 'open' ? '没有待处理的问题' : '还没有已解决的问题'}</p>)}</div></section>; })}</div>}
      </>}

      {view === 'issue' && issue && selected && <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}>
        <button className="back-link" onClick={() => setView('issues')}><ArrowLeft size={17} />返回问题</button>
        <div className="issue-detail"><div className="issue-title"><span className={`issue-state ${issue.state === 'closed' ? 'closed' : ''}`}>{issue.state === 'open' ? '待处理' : '已解决'}</span>{selected.private ? <h1>{issue.title}</h1> : <TranslatableContent text={issue.title} format="text" protectedNames={issueAuthorNames} render={(value) => <h1>{value}</h1>} />}<p>{selected.name} · {issue.user?.login || 'GitHub 用户'} 提出于 {date(issue.created_at)}</p></div>
        <div className="conversation"><div className="message"><div className="avatar author-avatar">{(issue.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box"><div><strong>{issue.user?.login || 'GitHub 用户'}</strong><small>{relativeDate(issue.created_at, language)}</small></div>{!selected.private && issue.body ? <TranslatableContent text={issue.body} format="markdown" paragraphMode protectedNames={issueAuthorNames} render={(value) => <div className="intro-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{value}</ReactMarkdown></div>} /> : <div className="intro-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{issue.body || '没有详细描述。'}</ReactMarkdown></div>}</div></div>{comments.map((item) => <div className="message" key={item.id}><div className="avatar">{(item.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box"><div><strong>{item.user?.login || 'GitHub 用户'}</strong><small>{relativeDate(item.created_at, language)}</small></div>{selected.private ? <div className="intro-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{item.body}</ReactMarkdown></div> : <TranslatableContent text={item.body} format="markdown" paragraphMode protectedNames={issueAuthorNames} render={(value) => <div className="intro-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{value}</ReactMarkdown></div>} />}</div></div>)}</div>
        <form className="reply-card" onSubmit={(event) => void sendReply(event)}><label htmlFor="live-reply">写一条回复</label><textarea id="live-reply" rows={4} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="说说你的想法或处理进度…" /><div><button type="button" className="button button-quiet" disabled={busy} onClick={() => void changeIssueState()}>{issue.state === 'open' ? '标记为已解决' : '重新打开'}</button><button className="button button-primary" disabled={busy || !reply.trim()} type="submit">发送回复 <ArrowRight size={16} /></button></div></form></div>
      </TranslationPreferencesContext.Provider>}

      {view === 'history' && selected && <>
        <button className="back-link" onClick={() => setView('project')}><ArrowLeft size={17} />返回项目</button><div className="page-header"><div><div className="eyebrow">{selected.name}</div><h1>历史版本</h1><p>每一次更新，都有迹可循。</p></div></div>
        <div className="history-list">{commits.map((item) => <button className="history-row" key={item.sha} onClick={() => void openVersion(item)}><span className="history-icon"><Clock3 size={19} /></span><span className="history-main"><strong>{item.commit.message.split('\n')[0]}</strong><small>{item.commit.author?.date ? date(item.commit.author.date) : ''} · {item.author?.login || item.commit.author?.name || '未知作者'}</small></span><span className="button button-quiet small-button">查看 <ArrowRight size={15} /></span></button>)}{commits.length === 0 && !busy && <p className="live-empty">还没有历史版本。</p>}</div>
      </>}

      {view === 'version' && selected && commit && <>
        <button className="back-link" onClick={() => setView('history')}><ArrowLeft size={17} />历史版本</button><div className="narrow-page"><div className="eyebrow">{selected.name} · 历史版本</div><h1>{commit.commit.message.split('\n')[0]}</h1><p className="page-subtitle">{commit.author?.login || commit.commit.author?.name || '未知作者'} 发布于 {commit.commit.author?.date ? date(commit.commit.author.date) : ''}</p>
        <div className="version-stats"><div><strong>{commit.files?.length ?? '—'}</strong><span>修改文件</span></div><div><strong className="positive">+{commit.stats?.additions ?? '—'}</strong><span>新增行数</span></div><div><strong className="negative">−{commit.stats?.deletions ?? '—'}</strong><span>删除行数</span></div></div><section className="panel"><div className="panel-heading"><h2>修改文件</h2></div>{commit.files?.length ? <div className="file-list">{commit.files.map((file) => <div className="file-row" key={file.filename}><span className="file-kind"><Folder size={16} /></span><span>{file.filename}</span></div>)}</div> : <p className="muted">这个版本没有文件明细。</p>}</section><button className="button button-primary version-download" disabled={busy} onClick={() => void download(commit.sha)}><ArrowDownToLine size={18} />下载这个版本</button></div>
      </>}

      {view === 'settings' && <>
        <div className="page-header"><div><div className="eyebrow">个性化体验</div><h1>设置</h1><p>调整 EasyHub 的外观并管理 GitHub 连接。</p></div></div>
        <div className="settings-stack"><section className="panel settings-panel"><div className="settings-icon blue"><Square size={22} /></div><div className="settings-panel-content"><h2>窗口控件</h2><p>选择窗口顶部按钮的外观。更改会立即生效，并保存在这台电脑上。</p><div className="window-style-options" role="group" aria-label="窗口控件样式"><button className={`window-style-option ${windowStyle === 'windows' ? 'selected' : ''}`} aria-pressed={windowStyle === 'windows'} onClick={() => setWindowStyle('windows')}><span className="window-style-preview windows-preview" aria-hidden="true"><span /><span /><span /></span><span><strong>Windows 风格</strong><small>默认 · 右上角按钮</small></span>{windowStyle === 'windows' && <Check size={18} className="window-style-check" />}</button><button className={`window-style-option ${windowStyle === 'reference' ? 'selected' : ''}`} aria-pressed={windowStyle === 'reference'} onClick={() => setWindowStyle('reference')}><span className="window-style-preview reference-preview" aria-hidden="true"><span /><span /><span /></span><span><strong>圆点风格</strong><small>参考图 · 左上角圆点</small></span>{windowStyle === 'reference' && <Check size={18} className="window-style-check" />}</button></div></div></section>
        <section className="panel settings-panel"><div className="settings-icon blue"><Languages size={22} /></div><div className="translation-settings"><div><h2>内容翻译</h2><p>使用顶部的翻译开关查看译文，再次关闭即可查看原文。公开文本由第三方服务翻译，译文保存在这台电脑上。</p></div><label>目标语言 <select aria-label="翻译目标语言" value={translationTarget} onChange={(event) => setTranslationTarget(event.target.value as TranslationTargetLanguage)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><label className="translation-names-label" htmlFor="translation-names">不翻译的名称</label><p className="translation-names-help">当前项目、作者和链接中的 GitHub 项目名称会自动保留。其他产品名或专有名称可在这里补充，每行一个。</p><textarea id="translation-names" aria-label="不翻译的名称" rows={4} maxLength={8000} value={translationNamesText} onChange={(event) => setTranslationNamesText(event.target.value)} placeholder="每行输入一个需要保留的名称" /><small className="muted">已保存 {translationNames.length} 个名称，仅保存在这台电脑上。</small></div></section>
        <section className="panel settings-panel"><div className="settings-icon"><Globe2 size={22} /></div><div><h2>账户与连接</h2><p>已连接 GitHub：{user.login}。你的项目仍保存在 GitHub。</p><button className="button button-quiet" onClick={onLogout}>退出登录</button></div></section>
        <section className="panel settings-panel"><div className="settings-icon blue"><RotateCw size={22} /></div><div><h2>数据与同步</h2><p>从 GitHub 获取最新项目和问题信息。</p><button className="button button-quiet" disabled={busy} onClick={() => void refreshCurrent()}>刷新项目</button></div></section>
        <section className="panel settings-panel"><div className="settings-icon amber"><Info size={22} /></div><div><h2>关于 EasyHub</h2><p>Windows 桌面版 · 直接连接 GitHub</p><span className="settings-version">版本 1.0.2</span><div className="license-details"><strong>GNU GPLv3</strong><span>本应用采用 GNU General Public License 第 3 版。</span><button className="text-link" onClick={() => void window.easyHub?.openLicense()}>查看许可协议 <ArrowRight size={15} /></button></div></div></section></div>
      </>}
    </main>{canScrollDown && !showIssueForm && <button className="scroll-down-cue" aria-label="向下滚动" onClick={() => scrollArea.current?.scrollBy({ top: Math.max(300, scrollArea.current.clientHeight * 0.75), behavior: 'smooth' })}><ChevronRight size={27} strokeWidth={2.6} style={{ transform: 'rotate(90deg)' }} /></button>}</div>

    {introEditing && selected && <IntroductionEditor initialMarkdown={introExpected} repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }} live saving={introSaving} saveError={introError} onSave={(content) => void saveIntroduction(content)} onCancel={() => setIntroEditing(false)} onOpenLink={(href) => void openReadmeLink(href, selected)} />}

    {showIssueForm && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowIssueForm(false); }}><form className="modal issue-modal" role="dialog" aria-modal="true" aria-labelledby="live-new-issue-title" onSubmit={(event) => void createIssue(event)}><button type="button" className="icon-button modal-close" aria-label="关闭" onClick={() => setShowIssueForm(false)}><X size={19} /></button><div className="modal-symbol"><MessageCircle size={24} /></div><h2 id="live-new-issue-title">提出问题</h2><p>描述遇到的情况，或分享一个改进想法。</p><label className="field"><span>相关项目</span><select value={selected.id} onChange={(event) => setSelected(repos.find((repo) => repo.id === Number(event.target.value)) ?? selected)}>{repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label><label className="field"><span>问题标题</span><input value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} placeholder="一句话概括问题" required maxLength={256} /></label><label className="field"><span>详细描述</span><textarea rows={5} value={issueBody} onChange={(event) => setIssueBody(event.target.value)} placeholder="发生了什么？你希望怎样改进？" /></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setShowIssueForm(false)}>取消</button><button type="submit" className="button button-primary" disabled={busy || !issueTitle.trim()}>创建问题</button></div></form></div>}
  </div>;
}
