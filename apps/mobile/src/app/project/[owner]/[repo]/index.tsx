import { useSessionReadFocusEffect } from '@/features/auth/useSessionReadFocusEffect';
import { useTranslation } from '@/features/localization/react';
import { releaseSummary } from '@/features/github/releaseSummary';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { GitHubError, validHistoryBranch, validHistoryPath, type GitHubBranch, type GitHubCommit, type GitHubIssue, type GitHubRelease, type GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { formatDate } from '@/features/localization/format';

import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { inlineReadmeImages, resolveReadmeLinks } from '@/features/github/markdown';
import { loadPublicBookmarks, savePublicBookmarks } from '@/features/github/publicBookmarksStore';
import { readmeReleaseLink } from '@/features/github/releaseLink';
import { togglePublicBookmark } from '@/features/github/publicBookmarks';
import { archiveTransferTitle, currentProjectArchive } from '@/features/github/archiveDownload';
import { formatBytes, formatRemainingTime } from '@/features/github/downloadProgress';
import { useArchiveDownload } from '@/features/github/useArchiveDownload';
import { usePagedList } from '@/features/github/usePagedList';
import { usePullRefresh, type RefreshHandle } from '@/features/github/usePullRefresh';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';
import { ReadmeView } from '@/components/ReadmeView';
import { PullRequestsPanel } from '@/components/PullRequestsPanel';
import { DiscussionSearch } from '@/components/DiscussionSearch';
import { ForkContributionPanel } from '@/components/ForkContributionPanel';
import { ProjectSettingsPanel } from '@/components/ProjectSettingsPanel';
import { StarProjectButton } from '@/components/StarProjectButton';
import { initialSourceHistoryViewState, SourceHistoryPanel } from '@/components/SourceHistoryPanel';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';
import { themed } from '@/features/theme/theme';

type Section = 'intro' | 'issues' | 'history' | 'releases' | 'pulls' | 'contribute' | 'settings';
type ProjectParameters = { owner: string; repo: string; section?: Section; mode?: string; focusTag?: string; issueState?: 'open' | 'closed'; historyBranch?: string; historyPath?: string };
const commitKey = (item: GitHubCommit) => item.sha;
const branchKey = (item: GitHubBranch) => item.name;
const releaseKey = (item: GitHubRelease) => item.id;
function IssueTitle({ issue, project }: { issue: GitHubIssue; project: GitHubRepo | null }) {
  const value = useTranslatedContent(issue.title, [project?.owner.login || '', project?.name || '', issue.user?.login || ''], project?.private === false).value;
  return <Text style={{ color: palette.ink, fontWeight: '700', fontSize: 16 }}>{value}</Text>;
}
export default function ProjectDetail() {
  const params = useLocalSearchParams<ProjectParameters>();
  return <ProjectDetails key={`${params.owner}/${params.repo}/${params.mode || ''}/${params.section || ''}/${params.issueState || ''}/${params.historyBranch || ''}/${params.historyPath || ''}`} {...params} />;
}
function ProjectDetails({ owner, repo, section: initialSection, mode, focusTag, issueState, historyBranch: initialHistoryBranch, historyPath: initialHistoryPath }: ProjectParameters) {
  const { client, ready, user, downloadAndShare } = useSession();
  const { language } = usePreferences();
  const t = useTranslation();
  const [section, updateSection] = useState<Section>(initialSection || 'intro');
  const [visitedPanels, setVisitedPanels] = useState(() => ({ contribute: initialSection === 'contribute', settings: initialSection === 'settings' }));
  const pageScroll = useRef<ScrollView>(null);
  const sectionTabs = useRef<ScrollView>(null);
  const tabOffsets = useRef<Partial<Record<Section, number>>>({});
  const tabWidths = useRef<Partial<Record<Section, number>>>({});
  const tabsViewport = useRef(0);
  const [tabsScroll, setTabsScroll] = useState({ x: 0, content: 0, width: 0 });
  // Keep the chosen tab centred so its neighbours stay visible on both sides.
  const revealSection = useCallback((selected: Section) => {
    const x = tabOffsets.current[selected];
    if (x === undefined) return;
    const centred = x - Math.max(12, (tabsViewport.current - (tabWidths.current[selected] ?? 0)) / 2);
    sectionTabs.current?.scrollTo({ x: Math.max(0, centred), animated: false });
  }, []);
  const setSection = useCallback((next: Section) => {
    if (next === 'contribute' || next === 'settings') setVisitedPanels((current) => current[next] ? current : { ...current, [next]: true });
    updateSection(next);
  }, []);
  useEffect(() => { pageScroll.current?.scrollTo({ y: 0, animated: false }); revealSection(section); }, [section, revealSection]);
  const [project, setProject] = useState<GitHubRepo | null>(null);
  const [historyBranch, setHistoryBranch] = useState(validHistoryBranch(initialHistoryBranch) ? initialHistoryBranch : '');
  const [historyPath, setHistoryPath] = useState(validHistoryPath(initialHistoryPath) ? initialHistoryPath : '');
  const [historyViewState, setHistoryViewState] = useState(() => initialSourceHistoryViewState(historyPath));
  const selectedHistoryBranch = historyBranch || project?.default_branch || 'main';
  const [readme, setReadme] = useState('');
  const [readmeHtml, setReadmeHtml] = useState('');
  const [translatedHtml, setTranslatedHtml] = useState({ source: '', html: '' });
  const [pullCount, setPullCount] = useState<number | null>(null);
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [openIssueCount, setOpenIssueCount] = useState<number | null>(null);
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>(issueState === 'closed' ? 'closed' : 'open');
  const [nextIssuePage, setNextIssuePage] = useState<number | null>(null);
  const [moreIssues, setMoreIssues] = useState(false);
  const [loadingMoreIssues, setLoadingMoreIssues] = useState(false);
  const [loading, setLoading] = useState(true);
  const { value: error, set: setError } = usePageFeedback('');
  const { capture: captureIssueVisit } = usePageFeedback('', section === 'issues');
  const [readErrors, setReadErrors] = useState({ intro: false, issues: false });
  const [bookmarked, setBookmarked] = useState(false);
  const transfer = useArchiveDownload(downloadAndShare);
  const cancelArchive = transfer.cancel;
  const readGeneration = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const readTask = useRef<Promise<void> | null>(null);
  const searchRefresh = useRef<RefreshHandle | null>(null);
  const pullsRefresh = useRef<RefreshHandle | null>(null);
  const forkRefresh = useRef<RefreshHandle | null>(null);
  const starRefresh = useRef<RefreshHandle | null>(null);
  const settingsRefresh = useRef<RefreshHandle | null>(null);
  const fetchHistory = useCallback((page: number, signal: AbortSignal) => {
    if (!client) throw new Error('GitHub unavailable');
    return client.sourceHistory(owner, repo, { branch: selectedHistoryBranch, ...(historyPath ? { path: historyPath } : {}), page }, signal);
  }, [client, owner, repo, selectedHistoryBranch, historyPath]);
  const fetchBranches = useCallback((page: number, signal: AbortSignal) => {
    if (!client) throw new Error('GitHub unavailable');
    return client.branchesPage(owner, repo, page, signal);
  }, [client, owner, repo]);
  const fetchReleases = useCallback(async (page: number, signal: AbortSignal) => {
    if (!client) throw new Error('GitHub unavailable');
    const result = await client.releasesPage(owner, repo, page, signal);
    if (page === 1 && focusTag && !result.items.some((item) => item.tag_name === focusTag)) {
      try {
        const tagged = await client.releaseByTag(owner, repo, focusTag, signal);
        if (tagged) return { ...result, items: [tagged, ...result.items] };
      }
      catch (cause) { if (signal.aborted) throw cause; }
    }
    return result;
  }, [client, owner, repo, focusTag]);
  const historyEnabled = Boolean(client && project && section === 'history');
  const historyList = usePagedList(fetchHistory, commitKey, historyEnabled);
  const branchesList = usePagedList(fetchBranches, branchKey, historyEnabled);
  const releaseList = usePagedList(fetchReleases, releaseKey, Boolean(client));
  const releases = releaseList.items;
  const progress = transfer.progress;
  useEffect(() => { if (section !== 'releases') cancelArchive(); }, [section, cancelArchive]);
  const translatedDescription = useTranslatedContent(project?.description || '', [owner, repo], project?.private === false).value;
  const translatedReadme = useTranslatedContent(readme, [owner, repo], project?.private === false, 'markdown');
  useEffect(() => {
    if (!client || !project || !readmeHtml || translatedReadme.busy || !translatedReadme.value || translatedReadme.value === readme) return;
    const controller = new AbortController();
    const source = translatedReadme.value;
    void client.renderMarkdown(source, owner, repo, controller.signal).then((html) => inlineReadmeImages(html, owner, repo, project.default_branch || 'main',
      (path) => client.readmeImage(owner, repo, project.default_branch || 'main', path, controller.signal)))
      .then((html) => { if (!controller.signal.aborted) setTranslatedHtml({ source, html }); }).catch(() => undefined);
    return () => controller.abort();
  }, [client, project, readmeHtml, translatedReadme.busy, translatedReadme.value, readme, owner, repo]);
  const refreshProject = useCallback(() => {
    if (!client || !owner || !repo) return Promise.resolve();
    if (readTask.current) return readTask.current;
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    const generation = ++readGeneration.current;
    const active = () => !controller.signal.aborted && generation === readGeneration.current;
    setLoading(true);
    setLoadingMoreIssues(false);
    const task = client.repo(owner, repo, controller.signal).then(async (details) => {
      if (!active()) return;
      setProject(details);
      const [intro, questions, count, activity] = await Promise.allSettled([
        client.readme(owner, repo, controller.signal).then(async (markdown) => {
          const resolved = resolveReadmeLinks(markdown, owner, repo, details.default_branch || 'main');
          try {
            const html = resolved ? await client.renderMarkdown(resolved, owner, repo, controller.signal) : '';
            return { markdown: resolved, html: await inlineReadmeImages(html, owner, repo, details.default_branch || 'main',
              (path) => client.readmeImage(owner, repo, details.default_branch || 'main', path, controller.signal)) };
          }
          catch { return { markdown: resolved, html: '' }; }
        }), client.issuePage(owner, repo, issueFilter, 1, controller.signal), client.openIssueCount(owner, repo, controller.signal),
        client.activityCounts([{ id: details.id, owner, name: repo }], controller.signal),
      ]);
      if (active()) {
        if (intro.status === 'fulfilled') { setReadme(intro.value.markdown); setReadmeHtml(intro.value.html); }
        else if (intro.reason instanceof GitHubError && intro.reason.status === 404) { setReadme(''); setReadmeHtml(''); }
        if (questions.status === 'fulfilled') { setIssues(questions.value.items); setNextIssuePage(questions.value.nextPage); setMoreIssues(questions.value.nextPage !== null); }
        if (count.status === 'fulfilled') setOpenIssueCount(count.value);
        if (activity.status === 'fulfilled') setPullCount(activity.value[details.id]?.pullRequests ?? null);
        setReadErrors({
          intro: intro.status === 'rejected' && !(intro.reason instanceof GitHubError && intro.reason.status === 404),
          issues: questions.status === 'rejected',
        });
        setError('');
      }
    }).catch(() => { if (active()) setError(t("project.couldNotLoadThisProjectPleaseTryAgainLater")); }).finally(() => {
      if (active()) setLoading(false);
      if (readTask.current === task) readTask.current = null;
    });
    readTask.current = task;
    return task;
  }, [client, owner, repo, issueFilter, t, setError]);
  const { refresh, refreshing } = usePullRefresh([
    refreshProject,
    ...(section === 'history' ? [historyList.reload, branchesList.reload] : []),
    ...(section === 'releases' ? [releaseList.reload] : []),
    ...(section === 'issues' ? [async () => { await searchRefresh.current?.refresh(); }] : []),
    ...(section === 'pulls' ? [async () => { await pullsRefresh.current?.refresh(); }] : []),
    ...(section === 'contribute' ? [async () => { const task = refreshProject(); const revision = readGeneration.current; await task; if (revision === readGeneration.current && !readRequest.current?.signal.aborted) await forkRefresh.current?.refresh(); }] : []),
    ...(section === 'settings' ? [async () => { const task = refreshProject(); const revision = readGeneration.current; await task; if (revision === readGeneration.current && !readRequest.current?.signal.aborted) await settingsRefresh.current?.refresh(); }] : []),
    ...(mode === 'public' ? [async () => { await starRefresh.current?.refresh(); }] : []),
  ]);
  const loadMoreIssues = async () => {
    const current = captureIssueVisit();
    const controller = readRequest.current;
    if (!current() || !client || loading || loadingMoreIssues || nextIssuePage === null || !controller || controller.signal.aborted) return;
    const generation = readGeneration.current;
    setLoadingMoreIssues(true);
    try {
      const page = await client.issuePage(owner, repo, issueFilter, nextIssuePage, controller.signal);
      if (!current() || generation !== readGeneration.current || controller.signal.aborted) return;
      setIssues((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()]);
      setNextIssuePage(page.nextPage);
      setMoreIssues(page.nextPage !== null);
    } catch { if (current() && generation === readGeneration.current && !controller.signal.aborted) Alert.alert(t("project.couldNotLoadMore"), t("project.pleaseTryAgainLater")); }
    finally { if (generation === readGeneration.current && !controller.signal.aborted) setLoadingMoreIssues(false); }
  };
  useSessionReadFocusEffect(useCallback(() => {
    void refreshProject();
    return () => { readGeneration.current += 1; readRequest.current?.abort(); readRequest.current = null; readTask.current = null; };
  }, [refreshProject]));
  useFocusEffect(useCallback(() => {
    if (!user || !owner || !repo || mode !== 'public') return;
    let active = true;
    void loadPublicBookmarks(user.login).then((items) => {
      if (active) setBookmarked(items.some((item) => item.owner.toLowerCase() === owner.toLowerCase() && item.repo.toLowerCase() === repo.toLowerCase()));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [user, owner, repo, mode]));
  const toggleBookmark = async () => {
    if (!user || !owner || !repo) return;
    try {
      const next = togglePublicBookmark(await loadPublicBookmarks(user.login), { owner, repo });
      savePublicBookmarks(user.login, next);
      setBookmarked(next.some((item) => item.owner.toLowerCase() === owner.toLowerCase() && item.repo.toLowerCase() === repo.toLowerCase()));
    } catch { Alert.alert(t("project.couldNotSaveBookmark"), t("project.pleaseTryAgainLater")); }
  };
  const openReadmeLink = (url: string): boolean => {
    const release = readmeReleaseLink(url);
    if (!release) return false;
    if (release.owner.toLowerCase() === owner?.toLowerCase() && release.repo.toLowerCase() === repo?.toLowerCase()) {
      const selected = releases.find((item) => item.tag_name === release.tag);
      if (selected) router.push({ pathname: '/project/[owner]/[repo]/release/[id]', params: { owner, repo, id: String(selected.id) } });
      else if (client) void client.releaseByTag(owner, repo, release.tag).then((item) => {
        if (item) router.push({ pathname: '/project/[owner]/[repo]/release/[id]', params: { owner, repo, id: String(item.id) } });
        else setSection('releases');
      }).catch(() => setSection('releases'));
      else setSection('releases');
      return true;
    }
    router.push({ pathname: '/project/[owner]/[repo]', params: { owner: release.owner, repo: release.repo, mode: 'public', section: 'releases', ...(release.tag ? { focusTag: release.tag } : {}) } });
    return true;
  };
  const goIssue = (number: number) => router.push({ pathname: '/project/[owner]/[repo]/issue/[number]', params: { owner, repo, number: String(number), mode } });
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t("project.pleaseSignIn")} subtitle={t("project.signInToViewThisProject")} /><Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} /></Page>;
  return <Page scrollRef={pageScroll} refresh={refresh} refreshing={refreshing}>
    <BackLink title={t("analysis.back")} heading={project?.name || repo || t("project.project")} marginBottom={22} />
    <Text style={{ color: palette.muted, lineHeight: 21, marginBottom: 14 }}>{translatedDescription || project?.description || t("project.noDescriptionYet")}</Text>
    {project && <Text style={{ color: mode === 'public' ? palette.muted : palette.green, marginBottom: 17 }}>{mode === 'public' ? `${project.private ? t("project.authorizedPrivateProject") : t("discover.publicProject")} · ${project.owner.login} · ${t("project.readOnly")}` : `● ${t("elements.savedToGitHub")} · ${project.private ? t("login.privateProject") : t("elements.public")}`}</Text>}
    {mode === 'public' && project && <View style={{ gap: 9, marginBottom: 16 }}>{!project.private && <Action title={bookmarked ? t("project.savedTapToRemove") : t("project.saveProject")} secondary onPress={() => void toggleBookmark()} />}<StarProjectButton ref={starRefresh} owner={owner} repo={repo} /></View>}
    {section === 'intro' && project && <View style={{ marginBottom: 16 }}><Action title={t("project.downloadReleasesOrSource")} secondary onPress={() => setSection('releases')} /></View>}
    <View style={{ marginBottom: 19 }}>
    <ScrollView ref={sectionTabs} horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={32} onScroll={(event) => { const x = event.nativeEvent.contentOffset.x; setTabsScroll((current) => ({ ...current, x })); }} onLayout={(event) => { const width = event.nativeEvent.layout.width; tabsViewport.current = width; setTabsScroll((current) => ({ ...current, width })); revealSection(section); }} onContentSizeChange={(width) => { setTabsScroll((current) => ({ ...current, content: width })); revealSection(section); }} style={{ flexGrow: 0 }} contentContainerStyle={{ alignItems: 'center', gap: 8, paddingRight: 22 }}>
      {([['intro', t("project.about")], ['issues', `${t("issues.issues")}${openIssueCount === null ? '' : ` ${openIssueCount}`}`], ['pulls', `${t("project.pullRequestReview")}${pullCount === null ? '' : ` ${pullCount}`}`], ['history', t("common.changeHistory")], ['releases', t("project.viewReleases")], ['contribute', t("project.forkAndContribute")], ...(mode !== 'public' && project?.permissions?.admin ? [['settings', t("ProjectSettingsPanel.projectSettings")]] : [])] as [Section, string][]).map(([id, label]) => <Pressable key={id} onLayout={event => { tabOffsets.current[id] = event.nativeEvent.layout.x; tabWidths.current[id] = event.nativeEvent.layout.width; if (id === section) revealSection(section); }} onPress={() => setSection(id)} style={{ backgroundColor: section === id ? themed('#e6f0ff') : themed('#fff'), borderColor: section === id ? themed('#b8d4ff') : palette.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: section === id ? palette.blue : palette.muted, fontWeight: '700' }}>{label}</Text></Pressable>)}
    </ScrollView>
    {tabsScroll.x > 4 && <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 26, justifyContent: 'center', alignItems: 'flex-start', backgroundColor: `${palette.background}e6` }}><Text style={{ color: palette.muted, fontSize: 22, fontWeight: '700' }}>‹</Text></View>}
    {tabsScroll.content - tabsScroll.width - tabsScroll.x > 4 && <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 26, justifyContent: 'center', alignItems: 'flex-end', backgroundColor: `${palette.background}e6` }}><Text style={{ color: palette.muted, fontSize: 22, fontWeight: '700' }}>›</Text></View>}
    </View>
    {loading && !project && section !== 'history' && section !== 'releases' && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {!loading && !error && readErrors[section as keyof typeof readErrors] && <ErrorText message={t("project.thisSectionCouldNotBeLoadedPleaseRetry")} onRetry={refresh} />}
    {(project || !loading) && section === 'intro' && (!readErrors.intro || !!readme) && <Card>{readmeHtml && (translatedReadme.value === readme || translatedHtml.source === translatedReadme.value) ? <ReadmeView html={translatedReadme.value === readme ? readmeHtml : translatedHtml.html} onOpenLink={openReadmeLink} /> : readme ? <Markdown style={{ body: { color: palette.ink, fontSize: 15, lineHeight: 24 }, heading1: { fontSize: 25, fontWeight: '800', color: palette.ink }, heading2: { fontSize: 21, fontWeight: '800', color: palette.ink }, link: { color: palette.blue }, image: { maxWidth: 300 } }} onLinkPress={(url) => { if (!openReadmeLink(url)) return true; return false; }}>{translatedReadme.value}</Markdown> : <Text style={{ color: palette.muted }}>{t("project.noIntroductionYet")}</Text>}{translatedReadme.busy && <Text style={{ color: palette.muted }}>{t("TranslatableMarkdown.translatingSections")}</Text>}</Card>}
    {visitedPanels.contribute && project && <View style={{ display: section === 'contribute' ? 'flex' : 'none' }} accessibilityElementsHidden={section !== 'contribute'} importantForAccessibility={section === 'contribute' ? 'auto' : 'no-hide-descendants'}>
      <ForkContributionPanel active={section === 'contribute'} ref={forkRefresh} repo={project} publicMode={mode === 'public'} onOpenFork={(fork) => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: fork.owner.login, repo: fork.name } })} onBrowseOriginal={(originalOwner, originalName) => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: originalOwner, repo: originalName, mode: 'public' } })} onOpenRequest={(requestOwner, requestRepo, number) => router.push({ pathname: '/project/[owner]/[repo]/pull/[number]', params: { owner: requestOwner, repo: requestRepo, number: String(number), mode: 'public' } })} />
    </View>}
    {visitedPanels.settings && project && <View style={{ display: section === 'settings' ? 'flex' : 'none' }} accessibilityElementsHidden={section !== 'settings'} importantForAccessibility={section === 'settings' ? 'auto' : 'no-hide-descendants'}>
      <ProjectSettingsPanel active={section === 'settings'} ref={settingsRefresh} repo={project} publicMode={mode === 'public'} onUpdate={setProject} onRemoved={() => router.replace('/(tabs)/projects')} />
    </View>}
    {section === 'issues' && <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}><Action title={t("DiscussionSearch.open")} secondary={issueFilter !== 'open'} onPress={() => setIssueFilter('open')} /><Action title={t("issues.closed")} secondary={issueFilter !== 'closed'} onPress={() => setIssueFilter('closed')} /></View>
      <Action title={t("project.newIssue")} onPress={() => router.push({ pathname: '/project/[owner]/[repo]/new-issue', params: { owner, repo } })} /><View style={{ height: 15 }} />
      <DiscussionSearch ref={searchRefresh} owner={owner} repo={repo} kind="issue" state={issueFilter} mode={mode} isPublic={project?.private === false}>
      {(project || !loading) && <>
      {issues.length ? issues.map((issue) => <Pressable key={issue.id} onPress={() => goIssue(issue.number)}><Card><IssueTitle issue={issue} project={project} /><Text style={{ color: palette.muted, marginTop: 8 }}>{issue.state === 'open' ? t("DiscussionSearch.open") : t("project.resolved")} · {issue.user?.login || t("PullRequestsPanel.githubUser")} · {issue.comments} {t("project.replies")}</Text></Card></Pressable>) : !readErrors.issues && <Card><Text style={{ color: palette.muted }}>{t("project.noIssuesYet")}</Text></Card>}
      {moreIssues && <Action title={loadingMoreIssues ? t("project.loading") : t("project.loadMoreIssues")} secondary disabled={loadingMoreIssues} onPress={() => { void loadMoreIssues(); }} />}
      </>}
      </DiscussionSearch>
    </>}
    {section === 'pulls' && project && <PullRequestsPanel ref={pullsRefresh} owner={owner} repo={repo} mode={mode} isPublic={project?.private === false} />}
    {section === 'history' && <SourceHistoryPanel branch={selectedHistoryBranch} path={historyPath} branches={branchesList} history={historyList} viewState={historyViewState} onViewStateChange={setHistoryViewState}
      onFilter={(branch, path) => { setHistoryBranch(branch); setHistoryPath(path); }}
      onOpen={sha => router.push({ pathname: '/project/[owner]/[repo]/version/[sha]', params: { owner, repo, sha, branch: selectedHistoryBranch, ...(historyPath ? { historyPath } : {}), ...(mode ? { mode } : {}) } })} />}
    {section === 'releases' && <>
      {project && <Card>
        <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t("project.currentProjectSource")}</Text>
        <Text style={{ color: palette.muted, marginTop: 5, marginBottom: 14 }}>{t("project.downloadTheCompleteSourceFromTheDefaultBranch")} · {project.default_branch}</Text>
        <Action title={transfer.busy ? archiveTransferTitle(progress, t) : t("project.downloadCurrentSourceZIP")} disabled={transfer.busy || !project.default_branch} onPress={() => { void transfer.download(currentProjectArchive(project)); }} />
        {transfer.busy && <View style={{ marginTop: 10 }}>
          {progress && <Text style={{ color: palette.muted, marginBottom: 10 }}>{formatBytes(progress.loaded)}{progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}{progress.bytesPerSecond > 0 ? ` · ${formatBytes(progress.bytesPerSecond)}/s` : ''}{progress.etaSeconds !== null && progress.etaSeconds > 0 ? ` · ${t("project.timeLeft")} ${formatRemainingTime(progress.etaSeconds)}` : ''}</Text>}
          <Action title={t("BinaryAnalysisSettings.cancelDownload")} secondary onPress={transfer.cancel} />
        </View>}
        {transfer.status === 'complete' && <Text style={{ color: palette.muted, marginTop: 10 }}>{t("project.downloadCompleteYouCanSaveOrShareIt")}</Text>}
        {transfer.status === 'cancelled' && <Text style={{ color: palette.muted, marginTop: 10 }}>{t("project.downloadCancelledYouCanDownloadItAgain")}</Text>}
        {transfer.status === 'failed' && <ErrorText message={t("project.downloadFailedCheckYourConnectionAndDownloadAgain")} />}
        {(transfer.status === 'cancelled' || transfer.status === 'failed') && transfer.target && <View style={{ marginTop: 10 }}><Action title={t("project.downloadAgain")} secondary onPress={() => { if (transfer.target) void transfer.download(transfer.target); }} /></View>}
      </Card>}
      {[...releases].sort((a, b) => Number(b.tag_name === focusTag) - Number(a.tag_name === focusTag)).map((release) => <Card key={release.id}><Text style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{release.name || release.tag_name}</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{release.tag_name} · {release.published_at ? formatDate(release.published_at, language) : t("PullRequestsPanel.draft")}</Text><Text style={{ color: palette.ink, marginTop: 12, lineHeight: 22 }}>{releaseSummary(release.body) || t("project.noDescription")}</Text><View style={{ marginTop: 12 }}><Action title={t("project.viewDownloads")} secondary onPress={() => router.push({ pathname: '/project/[owner]/[repo]/release/[id]', params: { owner, repo, id: String(release.id) } })} /></View></Card>)}
      {releaseList.busy && <Loading />}
      {releaseList.failedPage !== null && <ErrorText message={t("project.couldNotLoadReleasesPreviouslyLoadedVersionsAreKept")} onRetry={() => { void releaseList.more(); }} />}
      {releaseList.loaded && !releaseList.busy && releaseList.failedPage === null && !releases.length && <Card><Text style={{ color: palette.muted }}>{t("project.noReleasesYet")}</Text></Card>}
      {!releaseList.busy && releaseList.failedPage === null && releaseList.nextPage !== null && <Action title={t("project.loadMoreReleases")} secondary onPress={() => { void releaseList.more(); }} />}
      <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17, marginBottom: 7 }}>{t("project.projectFiles")}</Text><Text style={{ color: palette.muted, lineHeight: 21, marginBottom: 13 }}>{t("project.chooseAPointInChangeHistoryToDownloadFilesFromThat")}</Text><Action title={t("project.chooseACommit")} secondary onPress={() => setSection('history')} /></Card>
    </>}
  </Page>;
}
