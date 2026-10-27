import { useTranslation } from '@/features/localization/react';
import { useCallback } from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import type { GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';

import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';
import { usePagedList } from '@/features/github/usePagedList';
import { usePullRefresh } from '@/features/github/usePullRefresh';

const repoKey = (repo: GitHubRepo) => repo.id;

export default function Starred() {
  const { client, ready } = useSession();
  const t = useTranslation();
  const fetchPage = useCallback(async (page: number, signal: AbortSignal) => {
    if (!client) return { items: [], nextPage: null };
    const items = await client.starredRepos(page, signal);
    return { items, nextPage: items.length === 100 ? page + 1 : null };
  }, [client]);
  const { items: repos, busy, failedPage, nextPage, reload, more } = usePagedList(fetchPage, repoKey, Boolean(client));
  const { refresh, refreshing } = usePullRefresh([reload]);
  const error = failedPage !== null ? t("starred.couldNotLoadStarredProjectsPleaseTryAgain") : '';
  if (!ready) return <Loading />;
  return <Page refresh={client ? refresh : undefined} refreshing={refreshing}><BackLink title={t("analysis.back")} heading={t("starred.starredProjects")} marginBottom={22} /><Heading subtitle={t("starred.yourGitHubStarredProjectsAppearOnAllDevices")} />
    {!client && <Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} />}
    {!!error && <ErrorText message={error} onRetry={() => { void more(); }} />}
    {repos.map((repo) => <Pressable key={repo.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, mode: 'public' } })}><Card><Text style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{repo.full_name}</Text>{repo.private && <Text style={{ color: palette.muted, marginTop: 5 }}>{t("project.authorizedPrivateProject")}</Text>}<Text style={{ color: palette.muted, marginTop: 7 }}>{repo.description || t("discover.noDescriptionYet")}</Text><Text style={{ color: palette.muted, marginTop: 7 }}>★ {repo.stargazers_count ?? 0}</Text></Card></Pressable>)}
    {busy && !refreshing && <Loading />}{!!client && !busy && !error && !repos.length && <Text style={{ color: palette.muted }}>{t("starred.noStarredProjectsYet")}</Text>}
    {nextPage !== null && !busy && !error && <Action title={t("PullRequestsPanel.loadMore")} secondary onPress={() => { void more(); }} />}
  </Page>;
}
