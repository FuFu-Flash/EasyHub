import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { GitHubError, type GitHubCommit, type GitHubIssue, type GitHubRelease, type GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
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
import { ReadmeView } from '@/components/ReadmeView';
import { PullRequestsPanel } from '@/components/PullRequestsPanel';
import { DiscussionSearch } from '@/components/DiscussionSearch';
import { ForkContributionPanel } from '@/components/ForkContributionPanel';
import { ProjectSettingsPanel } from '@/components/ProjectSettingsPanel';
import { StarProjectButton } from '@/components/StarProjectButton';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

type Section = 'intro' | 'issues' | 'history' | 'releases' | 'pulls' | 'contribute' | 'settings';
type ProjectParameters = { owner: string; repo: string; section?: Section; mode?: string; focusTag?: string; issueState?: 'open' | 'closed' };
const commitKey = (item: GitHubCommit) => item.sha;
const releaseKey = (item: GitHubRelease) => item.id;
function IssueTitle({ issue, project }: { issue: GitHubIssue; project: GitHubRepo | null }) {
  const value = useTranslatedContent(issue.title, [project?.owner.login || '', project?.name || '', issue.user?.login || ''], project?.private === false).value;
  return <Text style={{ color: palette.ink, fontWeight: '700', fontSize: 16 }}>{value}</Text>;
}
function releaseSummary(markdown: string | null | undefined): string {
  return (markdown || '').replace(/!?(\[([^\]]+)\])\([^)]+\)/gu, '$2')
    .replace(/^[\s>*#-]+/gmu, '').replace(/[*_`]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 220);
}
export default function ProjectDetail() {
  const params = useLocalSearchParams<ProjectParameters>();
  return <ProjectDetails key={`${params.owner}/${params.repo}/${params.mode || ''}/${params.section || ''}/${params.issueState || ''}`} {...params} />;
}
function ProjectDetails({ owner, repo, section: initialSection, mode, focusTag, issueState }: ProjectParameters) {
  const { client, ready, user, downloadAndShare } = useSession();
  const { t } = usePreferences();
  const [section, setSection] = useState<Section>(initialSection || 'intro');
  const [project, setProject] = useState<GitHubRepo | null>(null);
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
  const [error, setError] = useState('');
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
    return client.commitsPage(owner, repo, page, signal);
  }, [client, owner, repo]);
  const fetchReleases = useCallback(async (page: number, signal: AbortSignal) => {
    if (!client) throw new Error('GitHub unavailable');
    const result = await client.releasesPage(owner, repo, page, signal);
    if (page === 1 && focusTag && !result.items.some((item) => item.tag_name === focusTag)) {
      try { return { ...result, items: [await client.releaseByTag(owner, repo, focusTag, signal), ...result.items] }; }
      catch (cause) { if (signal.aborted) throw cause; }
    }
    return result;
  }, [client, owner, repo, focusTag]);
  const historyList = usePagedList(fetchHistory, commitKey, Boolean(client));
  const releaseList = usePagedList(fetchReleases, releaseKey, Boolean(client));
  const history = historyList.items;
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
    }).catch(() => { if (active()) setError(t('项目暂时无法加载，请稍后重试。', 'Could not load this project. Please try again later.')); }).finally(() => {
      if (active()) setLoading(false);
      if (readTask.current === task) readTask.current = null;
    });
    readTask.current = task;
    return task;
  }, [client, owner, repo, issueFilter, t]);
  const { refresh, refreshing } = usePullRefresh([
    refreshProject,
    ...(section === 'history' ? [historyList.reload] : []),
    ...(section === 'releases' ? [releaseList.reload] : []),
    ...(section === 'issues' ? [async () => { await searchRefresh.current?.refresh(); }] : []),
    ...(section === 'pulls' ? [async () => { await pullsRefresh.current?.refresh(); }] : []),
    ...(section === 'contribute' ? [async () => { const task = refreshProject(); const revision = readGeneration.current; await task; if (revision === readGeneration.current && !readRequest.current?.signal.aborted) await forkRefresh.current?.refresh(); }] : []),
    ...(section === 'settings' ? [async () => { const task = refreshProject(); const revision = readGeneration.current; await task; if (revision === readGeneration.current && !readRequest.current?.signal.aborted) await settingsRefresh.current?.refresh(); }] : []),
    ...(mode === 'public' ? [async () => { await starRefresh.current?.refresh(); }] : []),
  ]);
  const loadMoreIssues = async () => {
    const controller = readRequest.current;
    if (!client || loading || loadingMoreIssues || nextIssuePage === null || !controller || controller.signal.aborted) return;
    const generation = readGeneration.current;
    setLoadingMoreIssues(true);
    try {
      const page = await client.issuePage(owner, repo, issueFilter, nextIssuePage, controller.signal);
      if (generation !== readGeneration.current || controller.signal.aborted) return;
      setIssues((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()]);
      setNextIssuePage(page.nextPage);
      setMoreIssues(page.nextPage !== null);
    } catch { if (generation === readGeneration.current && !controller.signal.aborted) Alert.alert(t('加载失败', 'Could not load more'), t('请稍后重试。', 'Please try again later.')); }
    finally { if (generation === readGeneration.current && !controller.signal.aborted) setLoadingMoreIssues(false); }
  };
  useFocusEffect(useCallback(() => {
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
    } catch { Alert.alert(t('收藏失败', 'Could not save bookmark'), t('请稍后重试。', 'Please try again later.')); }
  };
  const openReadmeLink = (url: string): boolean => {
    const release = readmeReleaseLink(url);
    if (!release) return false;
    if (release.owner.toLowerCase() === owner?.toLowerCase() && release.repo.toLowerCase() === repo?.toLowerCase()) {
      const selected = releases.find((item) => item.tag_name === release.tag);
      if (selected) router.push({ pathname: '/project/[owner]/[repo]/release/[id]', params: { owner, repo, id: String(selected.id) } });
      else if (client) void client.releaseByTag(owner, repo, release.tag).then((item) => router.push({ pathname: '/project/[owner]/[repo]/release/[id]', params: { owner, repo, id: String(item.id) } })).catch(() => setSection('releases'));
      else setSection('releases');
      return true;
    }
    router.push({ pathname: '/project/[owner]/[repo]', params: { owner: release.owner, repo: release.repo, mode: 'public', section: 'releases', ...(release.tag ? { focusTag: release.tag } : {}) } });
    return true;
  };
  const goIssue = (number: number) => router.push({ pathname: '/project/[owner]/[repo]/issue/[number]', params: { owner, repo, number: String(number), mode } });
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('请先登录', 'Please sign in')} subtitle={t('登录后查看这个项目。', 'Sign in to view this project.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page key={section} refresh={refresh} refreshing={refreshing}>
    <BackLink title={t('返回', 'Back')} marginBottom={20} />
    <Heading title={project?.name || repo || t('项目', 'Project')} subtitle={translatedDescription || project?.description || t('这个项目还没有介绍。', 'No description yet.')} />
    {project && <Text style={{ color: mode === 'public' ? palette.muted : palette.green, marginBottom: 17 }}>{mode === 'public' ? `${project.private ? t('仅获授权的私有项目', 'Authorized private project') : t('公开项目', 'Public project')} · ${project.owner.login} · ${t('只读浏览', 'Read-only')}` : `● ${t('已保存到 GitHub', 'Saved to GitHub')} · ${project.private ? t('私有项目', 'Private project') : t('所有人可见', 'Public')}`}</Text>}
    {mode === 'public' && project && <View style={{ gap: 9, marginBottom: 16 }}>{!project.private && <Action title={bookmarked ? t('★ 已收藏 · 点击取消', '★ Saved · Tap to remove') : t('☆ 收藏项目', '☆ Save project')} secondary onPress={() => void toggleBookmark()} />}<StarProjectButton ref={starRefresh} owner={owner} repo={repo} /></View>}
    {section === 'intro' && project && <View style={{ marginBottom: 16 }}><Action title={t('下载发行版或源码', 'Download releases or source')} secondary onPress={() => setSection('releases')} /></View>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 19 }} contentContainerStyle={{ alignItems: 'center', gap: 8, paddingRight: 22 }}>
      {([['intro', t('项目介绍', 'About')], ['issues', `${t('问题', 'Issues')}${openIssueCount === null ? '' : ` ${openIssueCount}`}`], ['pulls', `${t('代码提交审查', 'Code reviews')}${pullCount === null ? '' : ` ${pullCount}`}`], ['history', t('历史版本', 'History')], ['releases', t('查看发行版', 'View releases')], ['contribute', t('副本与提交改进', 'Fork and contribute')], ...(mode !== 'public' && project?.permissions?.admin ? [['settings', t('项目设置', 'Project settings')]] : [])] as [Section, string][]).map(([id, label]) => <Pressable key={id} onPress={() => setSection(id)} style={{ backgroundColor: section === id ? '#e6f0ff' : '#fff', borderColor: section === id ? '#b8d4ff' : palette.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: section === id ? palette.blue : palette.muted, fontWeight: '700' }}>{label}</Text></Pressable>)}
    </ScrollView>
    {loading && !project && section !== 'history' && section !== 'releases' && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {!loading && !error && readErrors[section as keyof typeof readErrors] && <ErrorText message={t('这部分内容暂时无法加载，请重试。', 'This section could not be loaded. Please retry.')} onRetry={refresh} />}
    {(project || !loading) && section === 'intro' && (!readErrors.intro || !!readme) && <Card>{readmeHtml && (translatedReadme.value === readme || translatedHtml.source === translatedReadme.value) ? <ReadmeView html={translatedReadme.value === readme ? readmeHtml : translatedHtml.html} onOpenLink={openReadmeLink} /> : readme ? <Markdown style={{ body: { color: palette.ink, fontSize: 15, lineHeight: 24 }, heading1: { fontSize: 25, fontWeight: '800', color: palette.ink }, heading2: { fontSize: 21, fontWeight: '800', color: palette.ink }, link: { color: palette.blue }, image: { maxWidth: 300 } }} onLinkPress={(url) => { if (!openReadmeLink(url)) return true; return false; }}>{translatedReadme.value}</Markdown> : <Text style={{ color: palette.muted }}>{t('这个项目还没有介绍。', 'No introduction yet.')}</Text>}{translatedReadme.busy && <Text style={{ color: palette.muted }}>{t('正在分段翻译…', 'Translating sections…')}</Text>}</Card>}
    {section === 'contribute' && project && <ForkContributionPanel ref={forkRefresh} repo={project} publicMode={mode === 'public'} onOpenFork={(fork) => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: fork.owner.login, repo: fork.name } })} onBrowseOriginal={(originalOwner, originalName) => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: originalOwner, repo: originalName, mode: 'public' } })} onOpenRequest={(requestOwner, requestRepo, number) => router.push({ pathname: '/project/[owner]/[repo]/pull/[number]', params: { owner: requestOwner, repo: requestRepo, number: String(number), mode: 'public' } })} />}
    {section === 'settings' && project && <ProjectSettingsPanel ref={settingsRefresh} repo={project} publicMode={mode === 'public'} onUpdate={setProject} onRemoved={() => router.replace('/(tabs)/projects')} />}
    {section === 'issues' && <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}><Action title={t('待处理', 'Open')} secondary={issueFilter !== 'open'} onPress={() => setIssueFilter('open')} /><Action title={t('已解决', 'Closed')} secondary={issueFilter !== 'closed'} onPress={() => setIssueFilter('closed')} /></View>
      <Action title={t('＋ 提出问题', '＋ New issue')} onPress={() => router.push({ pathname: '/project/[owner]/[repo]/new-issue', params: { owner, repo } })} /><View style={{ height: 15 }} />
      <DiscussionSearch ref={searchRefresh} owner={owner} repo={repo} kind="issue" state={issueFilter} mode={mode} isPublic={project?.private === false}>
      {(project || !loading) && <>
      {issues.length ? issues.map((issue) => <Pressable key={issue.id} onPress={() => goIssue(issue.number)}><Card><IssueTitle issue={issue} project={project} /><Text style={{ color: palette.muted, marginTop: 8 }}>{issue.state === 'open' ? t('待处理', 'Open') : t('已解决', 'Resolved')} · {issue.user?.login || t('GitHub 用户', 'GitHub user')} · {issue.comments} {t('条回复', 'replies')}</Text></Card></Pressable>) : !readErrors.issues && <Card><Text style={{ color: palette.muted }}>{t('还没有问题。', 'No issues yet.')}</Text></Card>}
      {moreIssues && <Action title={loadingMoreIssues ? t('正在加载…', 'Loading…') : t('加载更多问题', 'Load more issues')} secondary disabled={loadingMoreIssues} onPress={() => { void loadMoreIssues(); }} />}
      </>}
      </DiscussionSearch>
    </>}
    {section === 'pulls' && project && <PullRequestsPanel ref={pullsRefresh} owner={owner} repo={repo} mode={mode} isPublic={project?.private === false} />}
    {section === 'history' && <>
      {history.map((commit) => <Card key={commit.sha}><Text style={{ color: palette.ink, fontWeight: '700' }}>{commit.commit.message.split('\n')[0]}</Text><Text style={{ color: palette.muted, marginTop: 6 }}>{commit.commit.author?.name || t('未知作者', 'Unknown author')} · {commit.commit.author?.date ? new Date(commit.commit.author.date).toLocaleDateString() : ''}</Text><View style={{ marginTop: 12 }}><Action title={t('查看与下载', 'View and download')} secondary onPress={() => router.push({ pathname: '/project/[owner]/[repo]/version/[sha]', params: { owner, repo, sha: commit.sha } })} /></View></Card>)}
      {historyList.busy && <Loading />}
      {historyList.failedPage !== null && <ErrorText message={t('历史版本暂时无法加载，已加载的版本保留。', 'Could not load history. Previously loaded versions are kept.')} onRetry={() => { void historyList.more(); }} />}
      {historyList.loaded && !historyList.busy && historyList.failedPage === null && !history.length && <Card><Text style={{ color: palette.muted }}>{t('暂无历史版本。', 'No history yet.')}</Text></Card>}
      {!historyList.busy && historyList.failedPage === null && historyList.nextPage !== null && <Action title={t('加载更多历史版本', 'Load more history')} secondary onPress={() => { void historyList.more(); }} />}
    </>}
    {section === 'releases' && <>
      {project && <Card>
        <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t('当前项目源码', 'Current project source')}</Text>
        <Text style={{ color: palette.muted, marginTop: 5, marginBottom: 14 }}>{t('下载当前默认版本的完整源码。', 'Download the complete source from the default branch.')} · {project.default_branch}</Text>
        <Action title={transfer.busy ? archiveTransferTitle(progress, t) : t('下载当前源码 ZIP', 'Download current source ZIP')} disabled={transfer.busy || !project.default_branch} onPress={() => { void transfer.download(currentProjectArchive(project)); }} />
        {transfer.busy && <View style={{ marginTop: 10 }}>
          {progress && <Text style={{ color: palette.muted, marginBottom: 10 }}>{formatBytes(progress.loaded)}{progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}{progress.bytesPerSecond > 0 ? ` · ${formatBytes(progress.bytesPerSecond)}/s` : ''}{progress.etaSeconds !== null && progress.etaSeconds > 0 ? ` · ${t('预计剩余', 'Time left')} ${formatRemainingTime(progress.etaSeconds)}` : ''}</Text>}
          <Action title={t('取消下载', 'Cancel download')} secondary onPress={transfer.cancel} />
        </View>}
        {transfer.status === 'complete' && <Text style={{ color: palette.muted, marginTop: 10 }}>{t('下载完成，可以保存或分享。', 'Download complete. You can save or share it.')}</Text>}
        {transfer.status === 'cancelled' && <Text style={{ color: palette.muted, marginTop: 10 }}>{t('下载已取消，可以重新下载。', 'Download cancelled. You can download it again.')}</Text>}
        {transfer.status === 'failed' && <ErrorText message={t('下载失败，请检查网络后重新下载。', 'Download failed. Check your connection and download again.')} />}
        {(transfer.status === 'cancelled' || transfer.status === 'failed') && transfer.target && <View style={{ marginTop: 10 }}><Action title={t('重新下载', 'Download again')} secondary onPress={() => { if (transfer.target) void transfer.download(transfer.target); }} /></View>}
      </Card>}
      {[...releases].sort((a, b) => Number(b.tag_name === focusTag) - Number(a.tag_name === focusTag)).map((release) => <Card key={release.id}><Text style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{release.name || release.tag_name}</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{release.tag_name} · {release.published_at ? new Date(release.published_at).toLocaleDateString() : t('草稿', 'Draft')}</Text><Text style={{ color: palette.ink, marginTop: 12, lineHeight: 22 }}>{releaseSummary(release.body) || t('暂无介绍', 'No description')}</Text><View style={{ marginTop: 12 }}><Action title={t('查看可下载文件', 'View downloads')} secondary onPress={() => router.push({ pathname: '/project/[owner]/[repo]/release/[id]', params: { owner, repo, id: String(release.id) } })} /></View></Card>)}
      {releaseList.busy && <Loading />}
      {releaseList.failedPage !== null && <ErrorText message={t('发行版暂时无法加载，已加载的版本保留。', 'Could not load releases. Previously loaded versions are kept.')} onRetry={() => { void releaseList.more(); }} />}
      {releaseList.loaded && !releaseList.busy && releaseList.failedPage === null && !releases.length && <Card><Text style={{ color: palette.muted }}>{t('还没有发布新版本。', 'No releases yet.')}</Text></Card>}
      {!releaseList.busy && releaseList.failedPage === null && releaseList.nextPage !== null && <Action title={t('加载更多发行版', 'Load more releases')} secondary onPress={() => { void releaseList.more(); }} />}
      <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17, marginBottom: 7 }}>{t('项目文件', 'Project files')}</Text><Text style={{ color: palette.muted, lineHeight: 21, marginBottom: 13 }}>{t('也可以从历史版本中选择一个时间点，下载当时的项目文件。', 'Choose a point in history to download the project files from that time.')}</Text><Action title={t('选择历史版本', 'Choose a version')} secondary onPress={() => setSection('history')} /></Card>
    </>}
  </Page>;
}
