import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import type { GitHubCommit, GitHubIssue, GitHubRelease, GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { useTranslatedBrief } from '@/features/translation/useTranslatedBrief';
import { inlineReadmeImages, resolveReadmeLinks } from '@/features/github/markdown';
import { loadPublicBookmarks, savePublicBookmarks } from '@/features/github/publicBookmarksStore';
import { readmeReleaseLink } from '@/features/github/releaseLink';
import { togglePublicBookmark } from '@/features/github/publicBookmarks';
import { ReadmeView } from '@/components/ReadmeView';
import { PullRequestsPanel } from '@/components/PullRequestsPanel';
import { Action, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

type Section = 'intro' | 'issues' | 'history' | 'releases' | 'pulls';
function releaseSummary(markdown: string | null | undefined): string {
  return (markdown || '').replace(/!?(\[([^\]]+)\])\([^)]+\)/gu, '$2')
    .replace(/^[\s>*#-]+/gmu, '').replace(/[*_`]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 220);
}
export default function ProjectDetail() {
  const { owner, repo, section: initialSection, mode, focusTag } = useLocalSearchParams<{ owner: string; repo: string; section?: Section; mode?: string; focusTag?: string }>();
  const { client, ready, user } = useSession();
  const { t } = usePreferences();
  const [section, setSection] = useState<Section>(initialSection || 'intro');
  const [project, setProject] = useState<GitHubRepo | null>(null);
  const [readme, setReadme] = useState('');
  const [readmeHtml, setReadmeHtml] = useState('');
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [openIssueCount, setOpenIssueCount] = useState<number | null>(null);
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>('open');
  const [nextIssuePage, setNextIssuePage] = useState<number | null>(null);
  const [moreIssues, setMoreIssues] = useState(false);
  const [loadingMoreIssues, setLoadingMoreIssues] = useState(false);
  const [history, setHistory] = useState<GitHubCommit[]>([]);
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bookmarked, setBookmarked] = useState(false);
  const translatedDescription = useTranslatedBrief(mode === 'public' ? project?.description || '' : '', [owner, repo]);
  const refresh = useCallback(() => {
    if (!client || !owner || !repo) return;
    let active = true;
    setLoading(true);
    client.repo(owner, repo).then(async (details) => {
      const [intro, questions, count, versions, published] = await Promise.allSettled([
        client.readme(owner, repo).then(async (markdown) => {
          const resolved = resolveReadmeLinks(markdown, owner, repo, details.default_branch || 'main');
          try {
            const html = resolved ? await client.renderMarkdown(resolved, owner, repo) : '';
            return { markdown: resolved, html: await inlineReadmeImages(html, owner, repo, details.default_branch || 'main',
              (path) => client.readmeImage(owner, repo, details.default_branch || 'main', path)) };
          }
          catch { return { markdown: resolved, html: '' }; }
        }), client.issuePage(owner, repo, issueFilter, 1), client.openIssueCount(owner, repo), client.commits(owner, repo), client.releases(owner, repo),
      ]);
      if (active) {
        setProject(details);
        setReadme(intro.status === 'fulfilled' ? intro.value.markdown : '');
        setReadmeHtml(intro.status === 'fulfilled' ? intro.value.html : '');
        setIssues(questions.status === 'fulfilled' ? questions.value.items : []);
        setNextIssuePage(questions.status === 'fulfilled' ? questions.value.nextPage : null);
        setMoreIssues(questions.status === 'fulfilled' && questions.value.nextPage !== null);
        setOpenIssueCount(count.status === 'fulfilled' ? count.value : null);
        setHistory(versions.status === 'fulfilled' ? versions.value : []);
        setReleases(published.status === 'fulfilled' ? published.value : []);
        setError('');
      }
    }).catch(() => { if (active) setError(t('项目暂时无法加载，请稍后重试。', 'Could not load this project. Please try again later.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, owner, repo, issueFilter, t]);
  const loadMoreIssues = async () => {
    if (!client || loadingMoreIssues || nextIssuePage === null) return;
    setLoadingMoreIssues(true);
    try {
      const page = await client.issuePage(owner, repo, issueFilter, nextIssuePage);
      setIssues((current) => [...current, ...page.items]);
      setNextIssuePage(page.nextPage);
      setMoreIssues(page.nextPage !== null);
    } catch { Alert.alert(t('加载失败', 'Could not load more'), t('请稍后重试。', 'Please try again later.')); }
    finally { setLoadingMoreIssues(false); }
  };
  useFocusEffect(refresh);
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
      else setSection('releases');
      return true;
    }
    router.push({ pathname: '/project/[owner]/[repo]', params: { owner: release.owner, repo: release.repo, mode: 'public', section: 'releases', ...(release.tag ? { focusTag: release.tag } : {}) } });
    return true;
  };
  const goIssue = (number: number) => router.push({ pathname: '/project/[owner]/[repo]/issue/[number]', params: { owner, repo, number: String(number), mode } });
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('请先登录', 'Please sign in')} subtitle={t('登录后查看这个项目。', 'Sign in to view this project.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page key={section} refresh={refresh}>
    <Text onPress={() => router.back()} style={{ color: palette.blue, marginBottom: 20 }}>← {t('返回', 'Back')}</Text>
    <Heading title={project?.name || repo || t('项目', 'Project')} subtitle={translatedDescription || project?.description || t('这个项目还没有介绍。', 'No description yet.')} />
    {project && <Text style={{ color: mode === 'public' ? palette.muted : palette.green, marginBottom: 17 }}>{mode === 'public' ? `${t('公开项目', 'Public project')} · ${project.owner.login} · ${t('只读浏览', 'Read-only')}` : `● ${t('已保存到 GitHub', 'Saved to GitHub')} · ${project.private ? t('只有我', 'Only me') : t('所有人可见', 'Public')}`}</Text>}
    {mode === 'public' && project && <View style={{ marginBottom: 16 }}><Action title={bookmarked ? t('★ 已收藏 · 点击取消', '★ Saved · Tap to remove') : t('☆ 收藏项目', '☆ Save project')} secondary onPress={() => void toggleBookmark()} /></View>}
    {section === 'intro' && project && <View style={{ marginBottom: 16 }}><Action title={t('下载发行版或源码', 'Download releases or source')} secondary onPress={() => setSection('releases')} /></View>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 19 }} contentContainerStyle={{ alignItems: 'center', gap: 8, paddingRight: 22 }}>
      {([['intro', t('项目介绍', 'About')], ['issues', `${t('问题', 'Issues')}${openIssueCount === null ? '' : ` ${openIssueCount}`}`], ['pulls', t('代码提交审查', 'Code reviews')], ['history', t('历史版本', 'History')], ['releases', t('查看发行版', 'View releases')]] as const).map(([id, label]) => <Pressable key={id} onPress={() => setSection(id)} style={{ backgroundColor: section === id ? '#e6f0ff' : '#fff', borderColor: section === id ? '#b8d4ff' : palette.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: section === id ? palette.blue : palette.muted, fontWeight: '700' }}>{label}</Text></Pressable>)}
    </ScrollView>
    {loading && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {!loading && !error && section === 'intro' && <Card>{readmeHtml ? <ReadmeView html={readmeHtml} onOpenLink={openReadmeLink} /> : readme ? <Markdown style={{ body: { color: palette.ink, fontSize: 15, lineHeight: 24 }, heading1: { fontSize: 25, fontWeight: '800', color: palette.ink }, heading2: { fontSize: 21, fontWeight: '800', color: palette.ink }, link: { color: palette.blue }, image: { maxWidth: 300 } }} onLinkPress={(url) => { if (!openReadmeLink(url)) return true; return false; }}>{readme}</Markdown> : <Text style={{ color: palette.muted }}>{t('这个项目还没有介绍。', 'No introduction yet.')}</Text>}</Card>}
    {!loading && !error && section === 'issues' && <>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}><Action title={t('待处理', 'Open')} secondary={issueFilter !== 'open'} onPress={() => setIssueFilter('open')} /><Action title={t('已解决', 'Closed')} secondary={issueFilter !== 'closed'} onPress={() => setIssueFilter('closed')} /></View>
      <Action title={t('＋ 提出问题', '＋ New issue')} onPress={() => router.push({ pathname: '/project/[owner]/[repo]/new-issue', params: { owner, repo } })} /><View style={{ height: 15 }} />
      {issues.length ? issues.map((issue) => <Pressable key={issue.id} onPress={() => goIssue(issue.number)}><Card><Text style={{ color: palette.ink, fontWeight: '700', fontSize: 16 }}>{issue.title}</Text><Text style={{ color: palette.muted, marginTop: 8 }}>{issue.state === 'open' ? t('待处理', 'Open') : t('已解决', 'Resolved')} · {issue.user?.login || t('GitHub 用户', 'GitHub user')} · {issue.comments} {t('条回复', 'replies')}</Text></Card></Pressable>) : <Card><Text style={{ color: palette.muted }}>{t('还没有问题。', 'No issues yet.')}</Text></Card>}
      {moreIssues && <Action title={loadingMoreIssues ? t('正在加载…', 'Loading…') : t('加载更多问题', 'Load more issues')} secondary disabled={loadingMoreIssues} onPress={() => { void loadMoreIssues(); }} />}
    </>}
    {!loading && !error && section === 'pulls' && <PullRequestsPanel owner={owner} repo={repo} mode={mode} />}
    {!loading && !error && section === 'history' && <>
      {history.length ? history.map((commit) => <Card key={commit.sha}><Text style={{ color: palette.ink, fontWeight: '700' }}>{commit.commit.message.split('\n')[0]}</Text><Text style={{ color: palette.muted, marginTop: 6 }}>{commit.commit.author?.name || t('未知作者', 'Unknown author')} · {commit.commit.author?.date ? new Date(commit.commit.author.date).toLocaleDateString() : ''}</Text><View style={{ marginTop: 12 }}><Action title={t('查看与下载', 'View and download')} secondary onPress={() => router.push({ pathname: '/project/[owner]/[repo]/version/[sha]', params: { owner, repo, sha: commit.sha } })} /></View></Card>) : <Card><Text style={{ color: palette.muted }}>{t('暂无历史版本。', 'No history yet.')}</Text></Card>}
    </>}
    {!loading && !error && section === 'releases' && <>
      {releases.length ? [...releases].sort((a, b) => Number(b.tag_name === focusTag) - Number(a.tag_name === focusTag)).map((release) => <Card key={release.id}><Text style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{release.name || release.tag_name}</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{release.tag_name} · {release.published_at ? new Date(release.published_at).toLocaleDateString() : t('草稿', 'Draft')}</Text><Text style={{ color: palette.ink, marginTop: 12, lineHeight: 22 }}>{releaseSummary(release.body) || t('暂无介绍', 'No description')}</Text><View style={{ marginTop: 12 }}><Action title={t('查看可下载文件', 'View downloads')} secondary onPress={() => router.push({ pathname: '/project/[owner]/[repo]/release/[id]', params: { owner, repo, id: String(release.id) } })} /></View></Card>) : <Card><Text style={{ color: palette.muted }}>{t('还没有发布新版本。', 'No releases yet.')}</Text></Card>}
      <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17, marginBottom: 7 }}>{t('项目文件', 'Project files')}</Text><Text style={{ color: palette.muted, lineHeight: 21, marginBottom: 13 }}>{t('也可以从历史版本中选择一个时间点，下载当时的项目文件。', 'Choose a point in history to download the project files from that time.')}</Text><Action title={t('选择历史版本', 'Choose a version')} secondary onPress={() => setSection('history')} /></Card>
    </>}
  </Page>;
}
