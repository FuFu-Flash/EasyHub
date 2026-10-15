import { useTranslation } from '@/features/localization/react';
import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';

import { Page, Action, DirectionLabel, ErrorText, Loading, RepositoryRow, palette } from '@/components/elements';
import { loadAllRepos } from '@/features/github/data';
import { loadPublicBookmarks } from '@/features/github/publicBookmarksStore';
import type { PublicBookmark } from '@/features/github/publicBookmarks';
import { usePullRefresh } from '@/features/github/usePullRefresh';

export default function Projects() {
  const { client, ready, user } = useSession();
  const t = useTranslation();
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
      .catch(() => { if (active()) setError(t("home.couldNotLoadProjectsCheckYourConnectionAndTryAgain")); });
    const savedProjects = user ? loadPublicBookmarks(user.login).then((saved) => { if (active()) setBookmarks(saved); }).catch(() => undefined) : Promise.resolve();
    await Promise.all([projects, savedProjects]);
    if (active()) setBusy(false);
  }, [client, user, t]);
  useFocusEffect(useCallback(() => { void load(); return () => request.current?.abort(); }, [load]));
  const { refresh, refreshing } = usePullRefresh([load]);
  if (!ready) return <Loading />;
  if (!client) return <Page><Text style={{ fontSize: 26, fontWeight: '800' }}>{t("home.myProjects")}</Text><Text style={{ color: palette.muted, marginVertical: 20 }}>{t("projects.signInToViewYourGitHubProjects")}</Text><Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} /></Page>;
  const filtered = items.filter((item) => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const originals = filtered.filter((item) => !item.fork);
  const forks = filtered.filter((item) => item.fork);
  return <Page refresh={refresh} refreshing={refreshing}><Text style={{ fontSize: 28, fontWeight: '800', color: palette.ink }}>{t("home.myProjects")}</Text><Text style={{ color: palette.muted, marginTop: 7 }}>{t("projects.keepUpWithYourProjectsOnMobile")}</Text>
    <View style={{ marginTop: 16 }}><Action title={t("projects.starredOnGitHub")} secondary onPress={() => router.push('/starred')} /></View>
    <TextInput value={search} onChangeText={setSearch} placeholder={t("projects.searchMyProjects")} style={{ marginTop: 24, marginBottom: 12, padding: 14, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: palette.border }} />
    {busy && !refreshing && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {originals.map((repo) => <RepositoryRow key={repo.id} repo={repo} />)}
    {forks.length > 0 && <View style={{ marginTop: 16 }}><Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginBottom: 8 }}>{t("projects.repositoryForks")} · {forks.length}</Text><Text style={{ color: palette.muted, lineHeight: 21, marginBottom: 13 }}>{t("projects.viewYourForksAndSubmitChangesAlreadyOnGitHubToTheir")}</Text>{forks.map((repo) => <View key={repo.id}><RepositoryRow repo={repo} />{repo.parent && <Pressable onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.parent!.owner.login, repo: repo.parent!.name, mode: 'public' } })} accessibilityRole="button" style={{ marginBottom: 15, marginTop: -3, minHeight: 48, minWidth: 48, justifyContent: 'center' }}><DirectionLabel title={`${t("ForkContributionPanel.originalProject")}: ${repo.parent.full_name}`} name="chevron" color={palette.blue} /></Pressable>}</View>)}</View>}
    {!busy && !error && !filtered.length && <Text style={{ marginTop: 24, color: palette.muted }}>{t("projects.noProjectsFound")}</Text>}
    {bookmarks.length > 0 && <View style={{ marginTop: 24 }}><Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginBottom: 10 }}>{t("projects.savedPublicProjects")}</Text>
      {bookmarks.filter((item) => `${item.owner}/${item.repo}`.toLowerCase().includes(search.toLowerCase())).map((item) => <Pressable key={`${item.owner}/${item.repo}`} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: item.owner, repo: item.repo, mode: 'public' } })} accessibilityRole="button" style={{ padding: 15, minHeight: 48, marginBottom: 9, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: '#fff' }}><Text style={{ color: palette.ink, fontSize: 16, fontWeight: '700' }}>{item.owner}/{item.repo}</Text><View style={{ marginTop: 5 }}><DirectionLabel title={t("projects.readOnlyBrowsing")} name="chevron" color={palette.muted} /></View></Pressable>)}
    </View>}
  </Page>;
}
