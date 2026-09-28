import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { GitHubActivityCount, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, Card, palette } from '@/components/elements';

export function PullReviewGroups({ repos, counts, filter }: { repos: GitHubRepo[]; counts: Record<number, GitHubActivityCount>; filter: 'open' | 'closed' }) {
  const { client } = useSession();
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pages, setPages] = useState<Record<string, { items: GitHubPullRequest[]; page: number; more: boolean }>>({});
  const [loading, setLoading] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const keyFor = (repo: GitHubRepo, state: 'open' | 'closed') => `${repo.id}:${state}`;
  const numberFor = (repo: GitHubRepo) => filter === 'open' ? counts[repo.id]?.pullRequests ?? 0 : counts[repo.id]?.closedPullRequests ?? 0;
  const ordered = [...repos].filter((repo) => numberFor(repo) > 0).sort((a, b) => numberFor(b) - numberFor(a) || a.name.localeCompare(b.name));
  const load = async (repo: GitHubRepo, state: 'open' | 'closed', page: number) => {
    if (!client) return;
    const key = keyFor(repo, state);
    setLoading(key);
    setErrors((current) => ({ ...current, [key]: '' }));
    try {
      const result = await client.pullRequestsPage(repo.owner.login, repo.name, state, page);
      setPages((current) => ({ ...current, [key]: { items: page === 1 ? result : [...(current[key]?.items ?? []), ...result], page, more: result.length === 100 } }));
    } catch { setErrors((current) => ({ ...current, [key]: t('暂时无法获取改进请求，请稍后重试。', 'Could not load change requests. Please try again.') })); }
    finally { setLoading(''); }
  };
  return <View>
    {ordered.map((repo) => {
      const key = keyFor(repo, filter);
      const page = pages[key];
      const isOpen = expanded === repo.id;
      return <Card key={repo.id}>
        <Pressable accessibilityRole="button" onPress={() => { setExpanded(isOpen ? null : repo.id); if (!isOpen && !page) void load(repo, filter, 1); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>{repo.name}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{filter === 'open' ? t('待审查的改进请求', 'Changes awaiting review') : t('已处理的改进请求', 'Handled change requests')}</Text></View>
          <View style={{ backgroundColor: '#fff0f1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}><Text style={{ color: '#bd3548', fontWeight: '800' }}>{numberFor(repo)}</Text></View><Text style={{ color: palette.muted, fontSize: 20 }}>{isOpen ? '⌃' : '⌄'}</Text>
        </Pressable>
        {isOpen && <View>
          {!!errors[key] && <Text style={{ color: '#bf3947', marginTop: 12 }}>{errors[key]}</Text>}
          {page?.items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/project/[owner]/[repo]/pull/[number]', params: { owner: repo.owner.login, repo: repo.name, number: String(item.number) } })} style={{ borderTopWidth: 1, borderTopColor: palette.border, marginTop: 12, paddingTop: 12 }}><Text style={{ color: palette.ink, fontWeight: '700' }}>{item.title}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 5 }}>{item.user?.login || t('GitHub 用户', 'GitHub user')} · {item.draft ? t('草稿', 'Draft') : item.merged_at ? t('已采纳', 'Accepted') : item.state === 'open' ? t('待审查', 'Awaiting review') : t('已关闭', 'Closed')}</Text></Pressable>)}
          {loading === key && <Text style={{ color: palette.muted, marginTop: 12 }}>{t('正在获取改进请求…', 'Loading change requests…')}</Text>}
          {page?.more && loading !== key && <View style={{ marginTop: 12 }}><Action title={t('加载更多改进请求', 'Load more change requests')} secondary onPress={() => { void load(repo, filter, page.page + 1); }} /></View>}
        </View>}
      </Card>;
    })}
    {ordered.length === 0 && <Card><Text style={{ color: palette.muted }}>{filter === 'open' ? t('没有待审查的改进请求', 'No changes awaiting review') : t('还没有已处理的改进请求', 'No handled change requests yet')}</Text></Card>}
  </View>;
}
