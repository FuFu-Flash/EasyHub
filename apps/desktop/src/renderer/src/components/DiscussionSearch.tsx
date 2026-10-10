import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GitHubIssue, GitHubRepo, GitHubSearchPage } from '@easyhub/github';
import { Search, X } from 'lucide-react';

export interface DiscussionSearchState {
  expanded: boolean;
  text: string;
  query: string;
  repoId: number | null;
}
const emptySearch: DiscussionSearchState = { expanded: false, text: '', query: '', repoId: null };

// The caller outlives the detail view. Searches stay in that caller's memory,
// scoped to its account/project/type, and never enter shared or persistent caches.
export function useDiscussionSearchState(account: string, scope: string): [DiscussionSearchState, (patch: Partial<DiscussionSearchState>) => void] {
  const accountKey = account.toLowerCase();
  const [session, setSession] = useState<{ account: string; searches: Record<string, DiscussionSearchState> }>({ account: accountKey, searches: {} });
  useEffect(() => { setSession((previous) => previous.account === accountKey ? previous : { account: accountKey, searches: {} }); }, [accountKey]);
  const change = useCallback((patch: Partial<DiscussionSearchState>) => {
    setSession((previous) => {
      const searches = previous.account === accountKey ? previous.searches : {};
      return { account: accountKey, searches: { ...searches, [scope]: { ...(searches[scope] ?? emptySearch), ...patch } } };
    });
  }, [accountKey, scope]);
  return [session.account === accountKey ? session.searches[scope] ?? emptySearch : emptySearch, change];
}

export function DiscussionSearch({ repositories, kind, state, language, filters, search, onSearchChange, onOpen }: {
  repositories: GitHubRepo[]; kind: 'issue' | 'pr'; state: 'open' | 'closed' | 'all'; language: string;
  filters?: ReactNode;
  search: DiscussionSearchState; onSearchChange: (patch: Partial<DiscussionSearchState>) => void;
  onOpen: (item: GitHubIssue, repo: GitHubRepo) => void;
}) {
  const english = language === 'en';
  const { expanded, text, query, repoId } = search;
  const formId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<GitHubIssue[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const selected = repositories.find((repo) => repo.id === repoId) ?? repositories[0];
  useEffect(() => { if (expanded) searchInput.current?.focus(); }, [expanded]);
  function collapse(): void {
    generation.current++;
    onSearchChange({ expanded: false, text: '', query: '' }); setItems([]); setError(''); setBusy(false); setHasMore(false);
    requestAnimationFrame(() => searchButton.current?.focus());
  }
  useEffect(() => {
    const request = ++generation.current;
    setItems([]); setHasMore(false); setPage(1); setError(''); setBusy(false);
    if (!query || !selected) return;
    setBusy(true);
    void window.easyHub!.github<GitHubSearchPage<GitHubIssue>>('searchDiscussions', selected.owner.login, selected.name, { query, kind, state, page: 1 }).then((result) => {
      if (request === generation.current) { setItems(result.items); setHasMore(result.hasNextPage); }
    }).catch(() => { if (request === generation.current) setError(english ? 'Search failed. Please retry.' : '搜索失败，请重试。'); }).finally(() => { if (request === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [query, selected?.id, selected?.owner.login, selected?.name, kind, state, english]);
  async function more(retry = false): Promise<void> {
    if (busy || !selected) return;
    const request = generation.current;
    const next = retry && items.length === 0 ? 1 : page + 1;
    setBusy(true); setError('');
    try {
      const result = await window.easyHub!.github<GitHubSearchPage<GitHubIssue>>('searchDiscussions', selected.owner.login, selected.name, { query, kind, state, page: next });
      if (request === generation.current) { setItems((old) => [...old, ...result.items.filter((item) => !old.some((known) => known.id === item.id))]); setHasMore(result.hasNextPage); setPage(next); }
    } catch { if (request === generation.current) setError(english ? 'Search failed. Please retry.' : '搜索失败，请重试。'); }
    finally { if (request === generation.current) setBusy(false); }
  }
  return <div className={`discussion-search${expanded ? ' is-expanded' : ''}`}>
    <div className="discussion-search-tools">
    {filters}
    {!expanded && <button ref={searchButton} type="button" className="icon-button discussion-search-toggle" aria-label={english ? 'Search discussions' : '搜索讨论'} title={english ? 'Search by title or number' : '按标题或编号搜索'} aria-expanded={false} aria-controls={formId} onClick={() => onSearchChange({ expanded: true })}><Search size={18} /></button>}
    {expanded && <form id={formId} className="discussion-search-form" role="search" aria-label={english ? 'Search discussions' : '搜索讨论'} onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); collapse(); } }} onSubmit={(event) => { event.preventDefault(); onSearchChange({ query: text.trim() }); }}>
      {repositories.length > 1 && <select aria-label={english ? 'Search project' : '搜索项目'} value={selected?.id ?? ''} onChange={(event) => onSearchChange({ repoId: Number(event.target.value) })}>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}</select>}
      <label className="discussion-search-field"><Search size={17} aria-hidden="true" /><input ref={searchInput} aria-label={english ? 'Search by title or number' : '按标题或编号搜索'} placeholder={english ? 'Search title or #number' : '搜索标题或 #编号'} maxLength={200} value={text} onChange={(event) => onSearchChange({ text: event.target.value, ...(!event.target.value.trim() ? { query: '' } : {}) })} /></label>
      <button type="submit" className="button button-quiet" disabled={busy || !text.trim() || !selected}>{english ? 'Search' : '搜索'}</button>
      <button type="button" className="icon-button discussion-search-close" aria-label={english ? 'Close search' : '收起搜索'} title={english ? 'Close search' : '收起搜索'} onClick={collapse}><X size={17} /></button>
    </form>}
    </div>
    {query && <div className="issue-list">{items.map((item) => <button className="public-list-row" key={item.id} onClick={() => selected && onOpen(item, selected)}><span><strong>{item.title}</strong><small>#{item.number} · {item.user?.login} · {item.state === 'open' ? english ? 'Open' : '待处理' : english ? 'Closed' : '已关闭'}</small></span></button>)}{busy && <p role="status">{english ? 'Searching…' : '正在搜索…'}</p>}{error && <p className="live-error" role="alert">{error}</p>}{!busy && !error && !items.length && <p className="muted">{english ? 'No matching results.' : '没有找到符合条件的结果。'}</p>}{(hasMore || error) && <button className="button button-quiet" disabled={busy} onClick={() => void more(Boolean(error))}>{error ? english ? 'Retry' : '重试' : english ? 'Load more' : '加载更多'}</button>}</div>}
  </div>;
}
