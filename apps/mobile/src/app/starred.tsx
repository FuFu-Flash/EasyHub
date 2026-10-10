import { useCallback } from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import type { GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';
import { usePagedList } from '@/features/github/usePagedList';
import { usePullRefresh } from '@/features/github/usePullRefresh';

const repoKey = (repo: GitHubRepo) => repo.id;

export default function Starred() {
  const { client, ready } = useSession();
  const { t } = usePreferences();
  const fetchPage = useCallback(async (page: number, signal: AbortSignal) => {
    if (!client) return { items: [], nextPage: null };
    const items = await client.starredRepos(page, signal);
    return { items, nextPage: items.length === 100 ? page + 1 : null };
  }, [client]);
  const { items: repos, busy, failedPage, nextPage, reload, more } = usePagedList(fetchPage, repoKey, Boolean(client));
  const { refresh, refreshing } = usePullRefresh([reload]);
  const error = failedPage !== null ? t('收藏列表加载失败，请重试。', 'Could not load Starred projects. Please try again.') : '';
  if (!ready) return <Loading />;
  return <Page refresh={client ? refresh : undefined} refreshing={refreshing}><BackLink title={t('返回', 'Back')} marginBottom={20} /><Heading title={t('我 Star 的项目', 'Starred projects')} subtitle={t('在 GitHub Star 的项目会在各设备间同步。', 'Your GitHub Starred projects appear on all devices.')} />
    {!client && <Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} />}
    {!!error && <ErrorText message={error} onRetry={() => { void more(); }} />}
    {repos.map((repo) => <Pressable key={repo.id} onPress={() => router.push({ pathname: '/project/[owner]/[repo]', params: { owner: repo.owner.login, repo: repo.name, mode: 'public' } })}><Card><Text style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{repo.full_name}</Text>{repo.private && <Text style={{ color: palette.muted, marginTop: 5 }}>{t('仅获授权的私有项目', 'Authorized private project')}</Text>}<Text style={{ color: palette.muted, marginTop: 7 }}>{repo.description || t('还没有项目简介。', 'No description yet.')}</Text><Text style={{ color: palette.muted, marginTop: 7 }}>★ {repo.stargazers_count ?? 0}</Text></Card></Pressable>)}
    {busy && !refreshing && <Loading />}{!!client && !busy && !error && !repos.length && <Text style={{ color: palette.muted }}>{t('还没有 Star 的项目。', 'No Starred projects yet.')}</Text>}
    {nextPage !== null && !busy && !error && <Action title={t('加载更多', 'Load more')} secondary onPress={() => { void more(); }} />}
  </Page>;
}
