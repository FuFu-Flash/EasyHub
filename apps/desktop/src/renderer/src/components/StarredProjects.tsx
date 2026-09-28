import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { ArrowLeft, ArrowRight, FolderOpen, RotateCw, Star } from 'lucide-react';

export function StarredProjects({ onBack, onOpen }: {
  onBack: () => void;
  onOpen: (repo: GitHubRepo) => void;
}) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(nextPage: number, active = () => true): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const items = await window.easyHub!.github<GitHubRepo[]>('starredRepos', nextPage);
      if (!active()) return;
      setRepos((current) => nextPage === 1 ? items : [...current, ...items.filter((item) => !current.some((known) => known.id === item.id))]);
      setPage(nextPage);
      setHasMore(items.length === 100);
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : '暂时无法加载收藏的项目。');
    } finally { if (active()) setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void load(1, () => active);
    return () => { active = false; };
  }, []);

  return <div className="starred-projects-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回</button>
    <div className="page-header"><div><div className="eyebrow">你的收藏</div><h1>我收藏的项目</h1><p>在 GitHub 收藏的项目都在这里，换一台电脑登录也能看到。</p></div><span className="starred-page-mark"><Star size={23} fill="currentColor" /></span></div>
    {error && <div className="starred-projects-error" role="alert">{error}<button className="button button-quiet" onClick={() => void load(repos.length ? page + 1 : 1)}>重试</button></div>}
    {repos.length > 0 && <div className="starred-projects-grid">{repos.map((repo) => <button className="starred-project-card" key={repo.id} onClick={() => onOpen(repo)}>
      <span className="starred-project-avatar">{repo.owner.avatar_url ? <img src={repo.owner.avatar_url} alt="" /> : repo.owner.login.slice(0, 1).toUpperCase()}</span>
      <span className="starred-project-copy"><strong>{repo.name}</strong><small>{repo.owner.login}</small><span>{repo.description || '还没有项目简介。'}</span><span className="starred-project-meta"><span>{repo.language || '未标注语言'}</span><span><Star size={14} />{(repo.stargazers_count ?? 0).toLocaleString()}</span></span></span>
      <ArrowRight className="starred-project-arrow" size={18} />
    </button>)}</div>}
    {!loading && !error && repos.length === 0 && <div className="starred-projects-empty"><span><FolderOpen size={27} /></span><h2>还没有收藏的项目</h2><p>浏览公开项目时，点“收藏项目”就能在这里找到它。</p></div>}
    {loading && <p className="starred-projects-loading"><RotateCw size={17} className="live-spin" />正在获取收藏的项目…</p>}
    {hasMore && !loading && <button className="button button-quiet starred-projects-more" onClick={() => void load(page + 1)}>加载更多项目</button>}
  </div>;
}
