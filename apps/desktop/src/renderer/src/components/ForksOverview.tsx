import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { ArrowRight, GitFork, RotateCw } from 'lucide-react';

export function ForksOverview({ repos, search, onOpen, onBrowseOriginal }: {
  repos: GitHubRepo[]; search: string; onOpen: (repo: GitHubRepo) => void; onBrowseOriginal: (owner: string, name: string) => void;
}) {
  const [details, setDetails] = useState<Record<number, GitHubRepo>>({});
  const [loading, setLoading] = useState(false);
  const ids = repos.map((repo) => repo.id).join(',');
  useEffect(() => {
    let active = true;
    if (repos.length === 0) return;
    setLoading(true);
    void Promise.all(repos.map(async (repo) => {
      try { return await window.easyHub!.github<GitHubRepo>('repository', repo.owner.login, repo.name); }
      catch { return repo; }
    })).then((items) => {
      if (active) setDetails(Object.fromEntries(items.map((repo) => [repo.id, repo])));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ids]);

  const filtered = repos.filter((repo) => {
    const detail = details[repo.id] ?? repo;
    return `${repo.name} ${repo.description ?? ''} ${detail.parent?.full_name ?? ''}`.toLowerCase().includes(search.toLowerCase());
  });
  return <section className="forks-overview" data-testid="forks-overview">
    <p className="muted">这些是从其他人的项目创建、由你管理的副本。原项目和你的修改会分别保留。</p>
    {loading && <p className="live-loading"><RotateCw size={16} className="live-spin" />正在核对原项目关系…</p>}
    <div className="cloud-list">{filtered.map((repo) => {
      const detail = details[repo.id] ?? repo;
      const parent = detail.parent;
      return <div className="cloud-row fork-cloud-row" key={repo.id}>
        <span className="project-logo project-logo-small logo-sky"><GitFork size={19} /></span>
        <div><button className="plain-heading" onClick={() => onOpen(detail)}>{repo.full_name}</button><small>{parent ? <>来自 <button className="fork-parent-link" onClick={() => onBrowseOriginal(parent.owner.login, parent.name)}>{parent.full_name}</button> · {parent.default_branch} → {repo.default_branch}</> : '正在获取原项目关系'}</small></div>
        <button className="button button-primary" onClick={() => onOpen(detail)}>打开副本 <ArrowRight size={16} /></button>
      </div>;
    })}</div>
    {repos.length === 0 && <div className="empty-state"><span className="empty-icon"><GitFork size={28} /></span><h3>还没有仓库副本</h3><p>在他人的公开项目中选择“提交代码改进”，即可创建。</p></div>}
    {repos.length > 0 && filtered.length === 0 && !loading && <p className="live-empty">没有找到仓库副本。</p>}
  </section>;
}
