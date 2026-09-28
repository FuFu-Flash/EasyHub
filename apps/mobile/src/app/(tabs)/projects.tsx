import { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Page, Action, ErrorText, Loading, RepositoryRow, palette } from '@/components/elements';
import { loadAllRepos } from '@/features/github/data';
import { loadPublicBookmarks } from '@/features/github/publicBookmarksStore';
import type { PublicBookmark } from '@/features/github/publicBookmarks';

export default function Projects() {
  const { client, ready, user } = useSession();
  const { t } = usePreferences();
  const [items, setItems] = useState<GitHubRepo[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bookmarks, setBookmarks] = useState<PublicBookmark[]>([]);
  const refresh = useCallback(() => {
    if (!client) return;
    let active = true; setBusy(true);
    loadAllRepos(client).then((repos) => { if (active) { setItems(repos); setError(''); } })
      .catch(() => { if (active) setError(t('项目加载失败，请检查网络后重试。', 'Could not load projects. Check your connection and try again.')); })
      .finally(() => { if (active) setBusy(false); });
    if (user) void loadPublicBookmarks(user.login).then((saved) => { if (active) setBookmarks(saved); }).catch(() => undefined);
    return () => { active = false; };
  }, [client, user, t]);
  useFocusEffect(refresh);
  if (!ready) return <Loading />;
  if (!client) return <Page><Text style={{ fontSize: 26, fontWeight: '800' }}>{t('我的项目', 'My projects')}</Text><Text style={{ color: palette.muted, marginVertical: 20 }}>{t('登录后查看你的 GitHub 项目。', 'Sign in to view your GitHub projects.')}</Text><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  const filtered = items.filter((item) => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <Page refresh={refresh}><Text style={{ fontSize: 28, fontWeight: '800', color: palette.ink }}>{t('我的项目', 'My projects')}</Text><Text style={{ color: palette.muted, marginTop: 7 }}>{t('在手机上继续关注你的创作。', 'Keep up with your projects on mobile.')}</Text>
    <TextInput value={search} onChangeText={setSearch} placeholder={t('搜索我的项目', 'Search my projects')} style={{ marginTop: 24, marginBottom: 12, padding: 14, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: palette.border }} />
    {busy && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {filtered.map((repo) => <RepositoryRow key={repo.id} repo={repo} />)}
    {!busy && !error && !filtered.length && <Text style={{ marginTop: 24, color: palette.muted }}>{t('没有找到项目。', 'No projects found.')}</Text>}
    {bookmarks.length > 0 && <View style={{ marginTop: 24 }}><Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginBottom: 10 }}>{t('收藏的公开项目', 'Saved public projects')}</Text>
      {bookmarks.filter((item) => `${item.owner}/${item.repo}`.toLowerCase().includes(search.toLowerCase())).map((item) => <Pressable key={`${item.owner}/${item.repo}`} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: item.owner, repo: item.repo, mode: 'public' } })} style={{ padding: 15, marginBottom: 9, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: '#fff' }}><Text style={{ color: palette.ink, fontSize: 16, fontWeight: '700' }}>{item.owner}/{item.repo}</Text><Text style={{ color: palette.muted, marginTop: 5 }}>{t('只读浏览', 'Read-only browsing')} ›</Text></Pressable>)}
    </View>}
  </Page>;
}
