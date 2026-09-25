import { useEffect, useState } from 'react';
import { ArrowRight, Clock3, Folder, Star } from 'lucide-react';
import type { GitHubRepo, GitHubSearchUser } from '@easyhub/github';

const topCache = new Map<string, { at: number; repos: GitHubRepo[] }>();
type DisplayMode = 'compact' | 'detailed';

export function UserSearchResults({ query, displayMode, onOpenProfile, onOpenRepository, onSearched }: { query: string; displayMode: DisplayMode; onOpenProfile: (user: GitHubSearchUser) => void; onOpenRepository: (repo: GitHubRepo) => void; onSearched: (query: string) => void }) {
  const [users, setUsers] = useState<GitHubSearchUser[]>([]);
  const [topRepos, setTopRepos] = useState<Record<string, GitHubRepo[] | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (query.trim().length < 2) { setUsers([]); setBusy(false); setError(''); return; }
    let active = true;
    setUsers([]); setTopRepos({}); setBusy(true); setError('');
    const timer = window.setTimeout(() => {
      void (window.easyHub ? window.easyHub.github<GitHubSearchUser[]>('searchUsers', query.trim()) : Promise.reject(new Error('应用连接不可用，请重新启动 EasyHub。'))).then((results) => {
        if (active) { setUsers(results); onSearched(query); }
      }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '用户搜索暂时不可用。'); }).finally(() => { if (active) setBusy(false); });
    }, 450);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, onSearched]);

  useEffect(() => {
    if (displayMode !== 'detailed' || users.length === 0 || !window.easyHub) return;
    let active = true;
    const service = window.easyHub;
    void (async () => {
      const uncached: GitHubSearchUser[] = [];
      for (const user of users) {
        const cached = topCache.get(user.login);
        if (cached && Date.now() - cached.at < 600000) setTopRepos((current) => ({ ...current, [user.login]: cached.repos }));
        else uncached.push(user);
      }
      for (let index = 0; index < uncached.length && active; index += 2) {
        await Promise.all(uncached.slice(index, index + 2).map(async (user) => {
          try {
            const repos = await service.github<GitHubRepo[]>('topStarredRepos', user.login);
            if (active) { topCache.set(user.login, { at: Date.now(), repos }); setTopRepos((current) => ({ ...current, [user.login]: repos })); }
          } catch { if (active) setTopRepos((current) => ({ ...current, [user.login]: [] })); }
        }));
      }
    })();
    return () => { active = false; };
  }, [displayMode, users]);

  if (busy) return <p className="live-empty"><Clock3 size={16} /> 正在搜索用户…</p>;
  if (error) return <p className="live-error" role="alert">{error}</p>;
  if (!users.length) return <p className="live-empty">没有找到用户。</p>;
  return <div className={`user-search-list ${displayMode}`}>{users.map((user) => <article className={`user-search-card ${displayMode === 'compact' ? 'compact' : ''}`} key={user.id}>
    <button className="user-search-identity" onClick={() => onOpenProfile(user)} aria-label={`查看 ${user.login} 的主页`}><span className="user-search-avatar">{user.avatar_url ? <img src={user.avatar_url} alt={`${user.login} 的头像`} /> : user.login.slice(0, 1).toUpperCase()}</span><span><strong>{user.login}</strong><small>GitHub 用户</small></span></button>
    <button className="button button-quiet user-search-profile" onClick={() => onOpenProfile(user)}>查看主页 <ArrowRight size={15} /></button>
    {displayMode === 'detailed' && <div className="user-search-projects"><strong>Star 最高的 3 个公开项目</strong>{topRepos[user.login] === undefined ? <span className="user-search-project-loading"><Clock3 size={14} />正在加载项目…</span> : topRepos[user.login]?.length ? topRepos[user.login]?.map((repo) => <button key={repo.id} className="user-search-project" onClick={() => onOpenRepository(repo)}><Folder size={15} /><span>{repo.name}</span><Star size={14} /><small>{(repo.stargazers_count ?? 0).toLocaleString()}</small><ArrowRight size={14} /></button>) : <span className="user-search-project-loading">没有可展示的公开项目，或暂时无法加载。</span>}</div>}
  </article>)}</div>;
}
