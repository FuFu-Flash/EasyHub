import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Page, Action, DirectionLabel, ErrorText, Loading, RepositoryRow, palette } from '@/components/elements';
import { loadAllRepos } from '@/features/github/data';
import { loadPublicBookmarks } from '@/features/github/publicBookmarksStore';
import type { PublicBookmark } from '@/features/github/publicBookmarks';
import { usePullRefresh } from '@/features/github/usePullRefresh';

export default function Projects() {
  const { client, ready, user } = useSession();
  const { t } = usePreferences();
  const [items, setItems] = useState<GitHubRepo[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bookmarks, setBookmarks] = useState<PublicBookmark[]>([]);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!client) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const active = () => request.current === controller && !controller.signal.aborted;
    setBusy(true);
    const projects = loadAllRepos(client, controller.signal)
      .then((repos) => { if (active()) { setItems(repos); setError(''); } })
      .catch(() => { if (active()) setError(t('项目加载失败，请检查网络后重试。', 'Could not load projects. Check your connection and try again.')); });
    const savedProjects = user ? loadPublicBookmarks(user.login).then((saved) => { if (active()) setBookmarks(saved); }).catch(() => undefined) : Promise.resolve();
    await Promise.all([projects, savedProjects]);
    if (active()) setBusy(false);
  }, [client, user, t]);
  useFocusEffect(useCallback(() => { void load(); return () => request.current?.abort(); }, [load]));
  const { refresh, refreshing } = usePullRefresh([load]);
  if (!ready) return <Loading />;
  if (!client) return <Page><Text style={{ fontSize: 26, fontWeight: '800' }}>{t('我的项目', 'My projects')}</Text><Text style={{ color: palette.muted, marginVertical: 20 }}>{t('登录后查看你的 GitHub 项目。', 'Sign in to view your GitHub projects.')}</Text><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  const filtered = items.filter((item) => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const originals = filtered.filter((item) => !item.fork);
  const forks = filtered.filter((item) => item.fork);
  return <Page refresh={refresh} refreshing={refreshing}><Text style={{ fontSize: 28, fontWeight: '800', color: palette.ink }}>{t('我的项目', 'My projects')}</Text><Text style={{ color: palette.muted, marginTop: 7 }}>{t('在手机上继续关注你的创作。', 'Keep up with your projects on mobile.')}</Text>
    <View style={{ marginTop: 16 }}><Action title={t('GitHub 已加星项目', 'Starred on GitHub')} secondary onPress={() => router.push('/starred')} /></View>
    <TextInput value={search} onChangeText={setSearch} placeholder={t('搜索我的项目', 'Search my projects')} style={{ marginTop: 24, marginBottom: 12, padding: 14, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: palette.border }} />
    {busy && !refreshing && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {originals.map((repo) => <RepositoryRow key={repo.id} repo={repo} />)}
    {forks.length > 0 && <View style={{ marginTop: 16 }}><Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginBottom: 8 }}>{t('仓库副本', 'Repository forks')} · {forks.length}</Text><Text style={{ color: palette.muted, lineHeight: 21, marginBottom: 13 }}>{t('查看仓库副本，并将 GitHub 上已有的改动提交给原项目。', 'View your forks and submit changes already on GitHub to their original projects.')}</Text>{forks.map((repo) => <View key={repo.id}><RepositoryRow repo={repo} />{repo.parent && <Pressable onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.parent!.owner.login, repo: repo.parent!.name, mode: 'public' } })} accessibilityRole="button" style={{ marginBottom: 15, marginTop: -3, minHeight: 48, minWidth: 48, justifyContent: 'center' }}><DirectionLabel title={`${t('原项目', 'Original project')}: ${repo.parent.full_name}`} name="chevron" color={palette.blue} /></Pressable>}</View>)}</View>}
    {!busy && !error && !filtered.length && <Text style={{ marginTop: 24, color: palette.muted }}>{t('没有找到项目。', 'No projects found.')}</Text>}
    {bookmarks.length > 0 && <View style={{ marginTop: 24 }}><Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginBottom: 10 }}>{t('收藏的公开项目', 'Saved public projects')}</Text>
      {bookmarks.filter((item) => `${item.owner}/${item.repo}`.toLowerCase().includes(search.toLowerCase())).map((item) => <Pressable key={`${item.owner}/${item.repo}`} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: item.owner, repo: item.repo, mode: 'public' } })} accessibilityRole="button" style={{ padding: 15, minHeight: 48, marginBottom: 9, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: '#fff' }}><Text style={{ color: palette.ink, fontSize: 16, fontWeight: '700' }}>{item.owner}/{item.repo}</Text><View style={{ marginTop: 5 }}><DirectionLabel title={t('只读浏览', 'Read-only browsing')} name="chevron" color={palette.muted} /></View></Pressable>)}
    </View>}
  </Page>;
}
