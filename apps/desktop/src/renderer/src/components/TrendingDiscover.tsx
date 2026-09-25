import { useEffect, useState } from 'react';
import { ArrowRight, Clock3, LayoutGrid, List, Search, Star, TrendingUp } from 'lucide-react';
import type { GitHubRepo, GitHubSearchUser, TrendingPeriod } from '@easyhub/github';
import type { SearchEntry } from '../searchHistory';
import { UserSearchResults } from './UserSearchResults';

interface Snapshot { at: number; stars: number }
type Snapshots = Record<string, Snapshot[]>;
const storageKey = 'easyhub:trending-star-observations:v1';
const cache = new Map<TrendingPeriod, { at: number; items: GitHubRepo[] }>();
const labels: Record<TrendingPeriod, string> = { today: '今日热门', week: '本周热门', month: '本月热门' };
const periods: TrendingPeriod[] = ['today', 'week', 'month'];
function readSnapshots(): Snapshots {
  try { const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Snapshots : {}; } catch { return {}; }
}
function trend(repo: GitHubRepo, snapshots: Snapshots, days: number): string {
  const history = snapshots[String(repo.id)] ?? [];
  const first = history.find((item) => item.at >= Date.now() - days * 86400000 && item.stars < (repo.stargazers_count ?? 0));
  if (first) return `观察期 +${Math.max(0, (repo.stargazers_count ?? 0) - first.stars)} Star`;
  return history.some((item) => item.at < Date.now() - 3600000) ? '观察期无新增 Star' : '增长观察中';
}

export type DiscoverScope = 'projects' | 'users';
export type SearchDisplayMode = 'compact' | 'detailed';
export function TrendingDiscover({ query, setQuery, scope, onScopeChange, displayMode, onDisplayMode, history, onSelectHistory, onClearHistory, searchResults, searchBusy, searchError, onOpen, onOpenProfile, onSearch, onUserSearched }: { query: string; setQuery: (value: string) => void; scope: DiscoverScope; onScopeChange: (scope: DiscoverScope) => void; displayMode: SearchDisplayMode; onDisplayMode: (mode: SearchDisplayMode) => void; history: SearchEntry[]; onSelectHistory: (entry: SearchEntry) => void; onClearHistory: () => void; searchResults: GitHubRepo[]; searchBusy: boolean; searchError: string; onOpen: (repo: GitHubRepo) => void; onOpenProfile: (user: GitHubSearchUser) => void; onSearch: (value: string) => void; onUserSearched: (value: string) => void }) {
  const [period, setPeriod] = useState<TrendingPeriod>('today');
  const [items, setItems] = useState<GitHubRepo[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshots>(readSnapshots);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    if (scope === 'users') { setBusy(false); return () => { active = false; }; }
    const cached = cache.get(period);
    if (!refresh && cached && Date.now() - cached.at < 600000) { setItems(cached.items); setBusy(false); setError(''); return () => { active = false; }; }
    setBusy(true); setError(''); setItems([]);
    void (window.easyHub ? window.easyHub.github<GitHubRepo[]>('trending', period) : Promise.reject(new Error('应用连接不可用，请重新启动 EasyHub。'))).then((repos) => {
      if (!active) return;
      setItems(repos);
      cache.set(period, { at: Date.now(), items: repos });
      const next = readSnapshots();
      const now = Date.now();
      for (const repo of repos) {
        const key = String(repo.id);
        const previous = Array.isArray(next[key]) ? next[key].filter((item) => item.at >= now - 31 * 86400000 && Number.isFinite(item.stars)) : [];
        next[key] = [...previous, { at: now, stars: repo.stargazers_count ?? 0 }].slice(-31);
      }
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setSnapshots(next);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '热门项目暂时无法加载。'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [period, refresh, scope]);
  const visible = query.trim().length >= 2 ? searchResults : items;
  const isSearch = query.trim().length >= 2;
  const hasQuery = Boolean(query.trim());
  return <div className="discover-page"><div className="page-header"><div><div className="eyebrow">发现更多作品</div><h1>发现 / 搜索</h1><p>搜索公开项目与 GitHub 用户，也可以看看大家最近在创作什么。</p></div></div>
    <div className="segmented discover-scopes" role="group" aria-label="搜索类型"><button className={scope === 'projects' ? 'selected' : ''} aria-pressed={scope === 'projects'} onClick={() => onScopeChange('projects')}>项目搜索</button><button className={scope === 'users' ? 'selected' : ''} aria-pressed={scope === 'users'} onClick={() => onScopeChange('users')}>用户搜索</button></div>
    <label className="discover-search"><Search size={21} /><input aria-label={scope === 'users' ? '搜索用户' : '搜索公开项目'} placeholder={scope === 'users' ? '搜索 GitHub 用户…' : '搜索所有公开项目…'} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && scope === 'projects') onSearch(query); }} /></label>
    {!hasQuery && history.length > 0 && <section className="search-history panel discover-history"><div className="panel-heading"><h2>搜索历史</h2><button className="text-link" onClick={onClearHistory}>清除全部</button></div><div className="search-history-list">{history.map((entry) => <button key={`${entry.scope}:${entry.query}`} onClick={() => onSelectHistory(entry)}><Clock3 size={15} /><span>{entry.query}</span><small>{entry.scope === 'users' ? '用户' : entry.scope === 'public' ? '公开项目' : entry.scope === 'local' ? '这台电脑' : '我的云端项目'}</small></button>)}</div></section>}
    {scope === 'projects' && !hasQuery && <><div className="trending-heading"><div><h2>EasyHub 热门</h2><p>EasyHub 根据 Star 数、近期活动和更新时间排列公开项目。不是 GitHub 官方 Trending。</p></div><button className="text-link" onClick={() => setRefresh((value) => value + 1)}>刷新</button></div><div className="segmented trending-periods" role="group" aria-label="热门时间范围">{periods.map((item) => <button key={item} aria-pressed={period === item} className={period === item ? 'selected' : ''} onClick={() => setPeriod(item)}>{labels[item]}</button>)}</div></>}
    {isSearch && <h2 className="discover-results-title">{scope === 'users' ? '用户搜索结果' : '公开项目搜索结果'}</h2>}
    {scope === 'users' ? isSearch ? <UserSearchResults query={query} displayMode={displayMode} onOpenProfile={onOpenProfile} onOpenRepository={onOpen} onSearched={onUserSearched} /> : <p className="live-empty">输入至少 2 个字符，搜索 GitHub 用户。</p> : hasQuery && !isSearch ? <p className="live-empty">输入至少 2 个字符，搜索公开项目。</p> : (isSearch ? searchBusy : busy) ? <p className="live-empty"><Clock3 size={16} /> 正在从 GitHub 获取项目…</p> : (isSearch ? searchError : error) ? <p className="live-error" role="alert">{isSearch ? searchError : error}</p> : <div className={`trending-list ${isSearch ? `search-result-grid ${displayMode}` : ''}`}>{visible.map((repo, index) => <button className={`trending-card ${isSearch && displayMode === 'compact' ? 'compact' : ''}`} key={repo.id} onClick={() => onOpen(repo)}><span className="trending-rank">{isSearch ? <Search size={17} /> : `#${index + 1}`}</span><span className="trending-author-avatar">{repo.owner.avatar_url ? <img src={repo.owner.avatar_url} alt={`${repo.owner.login} 的头像`} /> : repo.owner.login.slice(0, 1).toUpperCase()}</span><span className="trending-content"><strong>{repo.name}</strong><small>{repo.owner.login}</small>{(!isSearch || displayMode === 'detailed') && <span>{repo.description || '还没有项目简介。'}</span>}<span className="trending-meta">{(!isSearch || displayMode === 'detailed') && <em>{repo.language || '未标注语言'}</em>}<em><Star size={14} />{(repo.stargazers_count ?? 0).toLocaleString()}</em>{(!isSearch || displayMode === 'detailed') && <em><TrendingUp size={14} />{isSearch ? '公开项目' : trend(repo, snapshots, period === 'today' ? 1 : period === 'week' ? 7 : 30)}</em>}</span></span><ArrowRight size={19} /></button>)}{visible.length === 0 && <p className="live-empty">{isSearch ? '没有找到公开项目。' : '暂时没有符合条件的热门项目。'}</p>}</div>}
    {isSearch && <div className="search-display-switch" role="group" aria-label="结果显示方式"><button className={displayMode === 'compact' ? 'selected' : ''} aria-pressed={displayMode === 'compact'} onClick={() => onDisplayMode('compact')}><List size={16} />精简</button><button className={displayMode === 'detailed' ? 'selected' : ''} aria-pressed={displayMode === 'detailed'} onClick={() => onDisplayMode('detailed')}><LayoutGrid size={16} />详细</button></div>}
    {scope === 'projects' && !hasQuery && <p className="trending-disclaimer">增长趋势只统计 EasyHub 在这台电脑上观察到的 Star 变化；首次收录会显示“增长观察中”。</p>}
  </div>;
}
