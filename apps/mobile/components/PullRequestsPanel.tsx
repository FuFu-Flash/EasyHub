import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { GitHubPullRequest } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, Card, ErrorText, Loading, palette } from '@/components/elements';

export function PullRequestsPanel({ owner, repo, mode }: { owner: string; repo: string; mode?: string }) {
  const { client } = useSession();
  const { t } = usePreferences();
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [items, setItems] = useState<GitHubPullRequest[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    if (!client) return;
    let active = true;
    setBusy(true);
    client.pullRequestsPage(owner, repo, state).then((result) => {
      if (active) { setItems(result); setPage(1); setMore(result.length === 100); setError(''); }
    }).catch(() => { if (active) setError(t('合并请求加载失败，请重试。', 'Could not load pull requests. Please try again.')); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, owner, repo, state, t]);
  useFocusEffect(refresh);
  const loadMore = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const next = page + 1;
      const result = await client.pullRequestsPage(owner, repo, state, next);
      setItems((current) => [...current, ...result]);
      setPage(next);
      setMore(result.length === 100);
    } catch { setError(t('更多合并请求加载失败，请重试。', 'Could not load more pull requests.')); }
    finally { setBusy(false); }
  };
  return <View>
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
      <Action title={t('待审查', 'Open')} secondary={state !== 'open'} onPress={() => setState('open')} />
      <Action title={t('已关闭', 'Closed')} secondary={state !== 'closed'} onPress={() => setState('closed')} />
    </View>
    {!!error && <ErrorText message={error} onRetry={refresh} />}
    {items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/project/[owner]/[repo]/pull/[number]', params: { owner, repo, number: String(item.number), ...(mode ? { mode } : {}) } })}>
      <Card><Text style={{ color: palette.ink, fontSize: 16, fontWeight: '800', lineHeight: 23 }}>{item.title}</Text>
        <Text style={{ color: palette.muted, marginTop: 7 }}>{item.draft ? t('草稿', 'Draft') : item.merged_at ? t('已采纳', 'Accepted') : item.state === 'open' ? t('待审查', 'Awaiting review') : t('已关闭', 'Closed')} · #{item.number} · {item.user?.login || t('GitHub 用户', 'GitHub user')}</Text>
      </Card>
    </Pressable>)}
    {busy && <Loading />}
    {!busy && !error && items.length === 0 && <Card><Text style={{ color: palette.muted }}>{state === 'open' ? t('没有待审查的改进请求', 'No changes awaiting review') : t('还没有已处理的改进请求', 'No handled change requests yet')}</Text></Card>}
    {more && !busy && <Action title={t('加载更多', 'Load more')} secondary onPress={() => { void loadMore(); }} />}
  </View>;
}
