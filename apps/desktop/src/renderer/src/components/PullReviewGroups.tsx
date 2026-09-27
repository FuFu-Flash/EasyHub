import { useState } from 'react';
import type { ReactNode } from 'react';
import type { GitHubActivityCount, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { ChevronDown, GitPullRequest, MessageCircle, RotateCw } from 'lucide-react';

type Filter = 'open' | 'closed';
type Page = { items: GitHubPullRequest[]; nextPage: number | null };

export function PullReviewGroups({ repos, counts, onOpen, logo }: {
  repos: GitHubRepo[];
  counts: Record<number, GitHubActivityCount>;
  onOpen: (repo: GitHubRepo, request: GitHubPullRequest) => void;
  logo: (repo: GitHubRepo) => ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>('open');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const keyFor = (repo: GitHubRepo, state: Filter): string => `${repo.id}:${state}`;
  const countFor = (repo: GitHubRepo): number => (filter === 'open' ? counts[repo.id]?.pullRequests : counts[repo.id]?.closedPullRequests) ?? -1;
  const ordered = [...repos].sort((a, b) => countFor(b) - countFor(a) || a.name.localeCompare(b.name));
  const total = repos.every((repo) => counts[repo.id]) ? repos.reduce((sum, repo) => sum + (counts[repo.id]?.pullRequests ?? 0), 0) : null;

  async function load(repo: GitHubRepo, state: Filter, page: number): Promise<void> {
    const key = keyFor(repo, state);
    setLoading(key);
    setErrors((current) => ({ ...current, [key]: '' }));
    try {
      const result = await window.easyHub!.github<GitHubPullRequest[]>('pullRequestsPage', repo.owner.login, repo.name, state, page);
      setPages((current) => {
        const old = current[key]?.items ?? [];
        return { ...current, [key]: { items: page === 1 ? result : [...old, ...result.filter((item) => !old.some((known) => known.id === item.id))], nextPage: result.length === 100 ? page + 1 : null } };
      });
    } catch {
      setErrors((current) => ({ ...current, [key]: '暂时无法获取改进请求，请稍后重试。' }));
    } finally { setLoading(null); }
  }

  function toggle(repo: GitHubRepo): void {
    if (expanded === repo.id) { setExpanded(null); return; }
    setExpanded(repo.id);
    if (!pages[keyFor(repo, filter)]) void load(repo, filter, 1);
  }

  function chooseFilter(next: Filter): void {
    setFilter(next);
    const repo = repos.find((item) => item.id === expanded);
    if (repo && !pages[keyFor(repo, next)]) void load(repo, next, 1);
  }

  return <>
    <div className="toolbar"><div className="segmented"><button className={filter === 'open' ? 'selected' : ''} onClick={() => chooseFilter('open')}>待审查 <span>{total ?? '…'}</span></button><button className={filter === 'closed' ? 'selected' : ''} onClick={() => chooseFilter('closed')}>已处理</button></div></div>
    <div className="issue-project-list">{ordered.map((repo) => {
      const key = keyFor(repo, filter);
      const page = pages[key];
      const count = counts[repo.id];
      const isExpanded = expanded === repo.id;
      return <section className="issue-project-group live-issue-group" key={repo.id}>
        <button className="issue-project-header" aria-expanded={isExpanded} onClick={() => toggle(repo)}>
          {logo(repo)}<span className="issue-project-heading"><strong>{repo.name}</strong><small>{repo.description || '还没有项目介绍'}</small></span>
          <span className={`issue-project-count ${filter === 'open' && count?.pullRequests ? 'live-pending-count' : ''}`}>{filter === 'open' ? count ? `${count.pullRequests} 个待审查的改进请求` : '正在获取数量…' : count ? `${count.closedPullRequests} 个已处理的改进请求` : '查看已处理的改进请求'}</span>
          <ChevronDown className={`issue-project-chevron ${isExpanded ? 'expanded' : ''}`} size={19} />
        </button>
        <div className="issue-project-items live-group-items" hidden={!isExpanded}>{isExpanded && <>
          {errors[key] && <p className="live-error" role="alert">{errors[key]}</p>}
          {page?.items.map((request) => <button className="issue-row" key={request.id} onClick={() => onOpen(repo, request)}><span className="issue-indicator"><GitPullRequest size={19} /></span><span className="issue-row-main"><strong>{request.title}</strong><small>{request.user?.login || 'GitHub 用户'} · {request.state === 'open' ? request.draft ? '草稿' : '待审查' : request.merged_at ? '已采纳' : '已关闭'}</small></span><span className="issue-comments"><MessageCircle size={16} />{request.comments ?? 0}</span></button>)}
          {loading === key && <p className="live-loading"><RotateCw size={16} className="live-spin" />正在获取改进请求…</p>}
          {page && page.items.length === 0 && loading !== key && <p className="live-empty">{filter === 'open' ? '没有待审查的改进请求' : '还没有已处理的改进请求'}</p>}
          {page?.nextPage && <button className="button button-quiet pull-more" disabled={loading === key} onClick={() => void load(repo, filter, page.nextPage!)}>加载更多改进请求</button>}
        </>}</div>
      </section>;
    })}</div>
  </>;
}
