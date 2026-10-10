import { useCallback, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { GitHubIssue, GitHubRepo } from '@easyhub/github';
import { discussionScopes, selectedDiscussionScope } from '@/features/github/discussionScope';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { Action, Card, ErrorText, Loading, palette } from '@/components/elements';
import type { RefreshHandle } from '@/features/github/usePullRefresh';

function ResultTitle({ item, owner, repo, isPublic }: { item: GitHubIssue; owner: string; repo: string; isPublic: boolean }) {
  const title = useTranslatedContent(item.title, [owner, repo, item.user?.login || ''], isPublic).value;
  return <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 16 }}>{title}</Text>;
}

type DiscussionSearchProps = {
  kind: 'issue' | 'pr'; state: 'open' | 'closed'; mode?: string; children: ReactNode; ref?: Ref<RefreshHandle>;
} & ({ owner: string; repo: string; isPublic?: boolean; repositories?: never } | { repositories: GitHubRepo[]; owner?: never; repo?: never; isPublic?: never });

export function DiscussionSearch({ ref, ...props }: DiscussionSearchProps) {
  const { kind, state, mode, children } = props;
  const { client } = useSession();
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GitHubIssue[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const scopes = props.repositories ? discussionScopes(props.repositories) : [];
  const selected = selectedDiscussionScope(scopes, selectedId);
  const owner = `${selected?.owner ?? props.owner ?? ''}`;
  const repo = `${selected?.repo ?? props.repo ?? ''}`;
  const isPublic = selected?.isPublic ?? props.isPublic === true;
  const request = useRef<AbortController | null>(null);
  const running = useRef(false);
  const failedPage = useRef<number | null>(null);
  const previousScope = useRef<{ client: typeof client; owner: string; repo: string; query: string; kind: typeof kind; state: typeof state } | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const previous = previousScope.current;
    const sameScope = previous?.client === client && previous.owner === owner && previous.repo === repo && previous.query === query && previous.kind === kind && previous.state === state;
    previousScope.current = { client, owner, repo, query, kind, state };
    if (!sameScope) { setItems([]); setNextPage(1); setIncomplete(false); setTotal(0); }
    failedPage.current = null; setError('');
    const canSearch = Boolean(client && query && owner && repo);
    running.current = canSearch; setBusy(canSearch);
    if (!client || !query || !owner || !repo) return;
    const active = () => !controller.signal.aborted && request.current === controller;
    try {
      const result = await client.searchDiscussions(owner, repo, query, kind, state, 1, controller.signal);
      if (!active()) return;
      setItems(result.items); setNextPage(result.hasNextPage ? result.page + 1 : null); setIncomplete(result.incompleteResults); setTotal(result.totalCount);
    } catch {
      if (active()) { failedPage.current = 1; setError(t('搜索失败，请重试。', 'Search failed. Please retry.')); }
    } finally { if (active()) { running.current = false; setBusy(false); } }
  }, [client, owner, repo, query, kind, state, t]);
  useImperativeHandle(ref, () => ({ refresh }), [refresh]);
  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { request.current?.abort(); request.current = null; running.current = false; setBusy(false); };
  }, [refresh]));

  const more = async () => {
    const controller = request.current;
    const page = failedPage.current ?? nextPage;
    if (!client || !query || !owner || !repo || running.current || page === null || !controller || controller.signal.aborted) return;
    running.current = true;
    setBusy(true); setError('');
    try {
      const result = await client.searchDiscussions(owner, repo, query, kind, state, page, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      setItems((previous) => [...new Map([...(page === 1 ? [] : previous), ...result.items].map((item) => [item.id, item])).values()]);
      setNextPage(result.hasNextPage ? result.page + 1 : null); setIncomplete(result.incompleteResults); setTotal(result.totalCount);
      failedPage.current = null;
    } catch { if (!controller.signal.aborted && request.current === controller) { failedPage.current = page; setError(t('搜索失败，请重试。', 'Search failed. Please retry.')); } }
    finally { if (!controller.signal.aborted && request.current === controller) { running.current = false; setBusy(false); } }
  };
  const submit = () => { if (text.trim() && owner && repo) { if (text.trim() === query) void refresh(); else setQuery(text.trim()); } };
  return <View>
    {!expanded ? <View style={{ marginBottom: 14 }}><Action title={t('按标题或编号搜索', 'Search by title or number')} secondary disabled={Boolean(props.repositories) && scopes.length === 0} onPress={() => setExpanded(true)} /></View> : <Card>
      {props.repositories && <>
        <Text style={{ color: palette.muted, marginBottom: 10 }}>{t('搜索项目（含已授权的私有项目）', 'Search project (including authorized private projects)')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>{scopes.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: selected?.id === item.id }} onPress={() => {
          if (selected?.id === item.id) return;
          request.current?.abort(); setItems([]); setBusy(false); setError(''); setSelectedId(item.id);
        }} style={{ maxWidth: 260, borderRadius: 10, padding: 11, borderWidth: 1, borderColor: selected?.id === item.id ? palette.blue : palette.border, backgroundColor: selected?.id === item.id ? '#e7f0ff' : palette.background }}><Text numberOfLines={2} style={{ color: selected?.id === item.id ? palette.blue : palette.ink, fontWeight: '700' }}>{item.label}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>{item.isPublic ? t('公开', 'Public') : t('私有或未确认', 'Private or unconfirmed')}</Text></Pressable>)}</ScrollView>
      </>}
      <TextInput accessibilityLabel={t('搜索标题或编号', 'Search title or number')} value={text} maxLength={200} onChangeText={(value) => { setText(value); if (!value.trim()) setQuery(''); }} onSubmitEditing={submit} returnKeyType="search" autoCapitalize="none" autoCorrect={false} placeholder={t('搜索标题或 #编号', 'Search title or #number')} style={{ color: palette.ink, backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, borderRadius: 11, padding: 13, marginBottom: 12, fontSize: 16 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}><Action title={t('搜索', 'Search')} disabled={busy || !text.trim() || !owner || !repo} onPress={submit} /><Action title={t('收起搜索', 'Close search')} secondary onPress={() => { request.current?.abort(); setExpanded(false); setText(''); setQuery(''); }} /></View>
    </Card>}
    {query ? <>
      {items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: kind === 'pr' ? '/project/[owner]/[repo]/pull/[number]' : '/project/[owner]/[repo]/issue/[number]', params: { owner, repo, number: String(item.number), ...(mode ? { mode } : {}) } })}>
        <Card><ResultTitle item={item} owner={owner} repo={repo} isPublic={isPublic} /><Text style={{ color: palette.muted, marginTop: 8 }}>#{item.number} · {item.user?.login || 'GitHub'} · {item.state === 'open' ? t('待处理', 'Open') : t('已关闭', 'Closed')}</Text></Card>
      </Pressable>)}
      {busy && <Loading />}
      {!!error && <ErrorText message={error} onRetry={() => { void more(); }} />}
      {!busy && !error && items.length === 0 && <Card><Text style={{ color: palette.muted }}>{t('没有找到符合条件的结果。', 'No matching results.')}</Text></Card>}
      {total > 1000 && <Text style={{ color: palette.muted, marginBottom: 12 }}>{t('GitHub 最多可浏览前 1000 项，请缩小搜索范围。', 'GitHub allows browsing the first 1,000 results. Try a narrower search.')}</Text>}
      {incomplete && <Text style={{ color: palette.muted, marginBottom: 12 }}>{t('GitHub 返回了部分结果，请缩小搜索范围后重试。', 'GitHub returned incomplete results. Try a narrower search.')}</Text>}
      {nextPage !== null && !busy && !!owner && !!repo && <Action title={error ? t('重试', 'Retry') : t('加载更多搜索结果', 'Load more matches')} secondary onPress={() => { void more(); }} />}
    </> : children}
  </View>;
}
