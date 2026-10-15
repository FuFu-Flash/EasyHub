import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { errorText } from '../errors';
import { ErrorMessage } from './ErrorMessage';
import { sumActivity } from '../activityCounts';
import { SegmentedControl } from './SegmentedControl';
import { useEffect, useRef, useState } from 'react';
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
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [filter, setFilter] = useState<Filter>('open');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const inFlight = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showOthers, setShowOthers] = useState(false);
  const keyFor = (repo: GitHubRepo, state: Filter): string => `${repo.id}:${state}`;
  const countFor = (repo: GitHubRepo): number => (filter === 'open' ? counts[repo.id]?.pullRequests : counts[repo.id]?.closedPullRequests) ?? -1;
  const ordered = [...repos].sort((a, b) => countFor(b) - countFor(a) || a.name.localeCompare(b.name));
  const total = sumActivity(repos, counts, 'pullRequests');
  const emptyRepos = ordered.filter((repo) => countFor(repo) === 0);
  const visibleRepos = ordered.filter((repo) => showOthers || countFor(repo) !== 0);
  const isOpen = (repo: GitHubRepo, state: Filter): boolean => expanded[keyFor(repo, state)] ?? (state === 'open' && (counts[repo.id]?.pullRequests ?? 0) > 0);

  useEffect(() => {
    for (const repo of visibleRepos) {
      const key = keyFor(repo, filter);
      if (isOpen(repo, filter) && !pages[key] && !errors[key] && !inFlight.current.has(key)) void load(repo, filter, 1);
    }
  }, [repos, counts, expanded, filter, pages, errors, showOthers]);

  async function load(repo: GitHubRepo, state: Filter, page: number): Promise<void> {
    const key = keyFor(repo, state);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setLoading(current => ({ ...current, [key]: true }));
    setErrors((current) => ({ ...current, [key]: '' }));
    try {
      const result = await easyHub!.github<GitHubPullRequest[]>('pullRequestsPage', repo.owner.login, repo.name, state, page);
      setPages((current) => {
        const old = current[key]?.items ?? [];
        return { ...current, [key]: { items: page === 1 ? result : [...old, ...result.filter((item) => !old.some((known) => known.id === item.id))], nextPage: result.length === 100 ? page + 1 : null } };
      });
    } catch (cause) {
      setErrors((current) => ({ ...current, [key]: errorText(cause) }));
    } finally { inFlight.current.delete(key); setLoading(current => ({ ...current, [key]: false })); }
  }

  function toggle(repo: GitHubRepo): void {
    const key = keyFor(repo, filter), opening = !isOpen(repo, filter);
    setExpanded(current => ({ ...current, [key]: opening }));
    if (opening && !pages[key]) void load(repo, filter, 1);
  }

  function chooseFilter(next: Filter): void {
    setFilter(next);
  }

  return <>
    <div className="toolbar"><SegmentedControl><button className={filter === 'open' ? 'selected' : ''} onClick={() => chooseFilter('open')}>{t("pullReviewGroups.awaitingReview")} <span>{total ?? '…'}</span></button><button className={filter === 'closed' ? 'selected' : ''} onClick={() => chooseFilter('closed')}>{t("pullReviewGroups.handled")}</button></SegmentedControl></div>
    {visibleRepos.length === 0 && <div className="empty-state"><span className="empty-icon"><GitPullRequest size={28} /></span><h3>{filter === 'open' ? t("pullReviewGroups.noChangesAwaitingReview") : t("pullReviewGroups.noHandledPullRequestsYet")}</h3></div>}
    <div className="issue-project-list">{visibleRepos.map((repo) => {
      const key = keyFor(repo, filter);
      const page = pages[key];
      const count = counts[repo.id];
      const isExpanded = isOpen(repo, filter);
      return <section className="issue-project-group live-issue-group" key={repo.id}>
        <button className="issue-project-header" aria-expanded={isExpanded} onClick={() => toggle(repo)}>
          {logo(repo)}<span className="issue-project-heading"><strong>{repo.name}</strong><small>{repo.description || t("pullReviewGroups.noProjectDescriptionYet")}</small></span>
          <span className={`issue-project-count ${filter === 'open' && count?.pullRequests ? 'live-pending-count' : ''}`}>{filter === 'open' ? count ? t("pullReviewGroups.pullRequestsAwaitingReview", { p0: count.pullRequests }) : t("pullReviewGroups.loadingCount") : count ? t("pullReviewGroups.handledPullRequests", { p0: count.closedPullRequests }) : t("pullReviewGroups.viewHandledPullRequests")}</span>
          <ChevronDown className={`issue-project-chevron ${isExpanded ? 'expanded' : ''}`} size={19} />
        </button>
        <div className="issue-project-items live-group-items" hidden={!isExpanded}>{isExpanded && <>
          {errors[key] && <p className="live-error" role="alert"><ErrorMessage error={errors[key]} /><button className="text-link" onClick={() => void load(repo, filter, 1)}>{t('liveWorkspace.retry')}</button></p>}
          {page?.items.map((request) => <button className="issue-row" key={request.id} onClick={() => onOpen(repo, request)}><span className="issue-indicator"><GitPullRequest size={19} /></span><span className="issue-row-main"><strong data-content-original>{request.title}</strong><small>{request.user?.login || t("pullReviewGroups.githubUser")} · {request.state === 'open' ? request.draft ? t("pullReviewGroups.draft") : t("pullReviewGroups.awaitingReview") : request.merged_at ? t("pullReviewGroups.merged") : t("pullReviewGroups.closed")}</small></span><span className="issue-comments"><MessageCircle size={16} />{request.comments ?? 0}</span></button>)}
          {loading[key] && <p className="live-loading"><RotateCw size={16} className="live-spin" />{t("pullReviewGroups.loadingPullRequests")}</p>}
          {page && page.items.length === 0 && !loading[key] && <p className="live-empty">{filter === 'open' ? t("pullReviewGroups.noChangesAwaitingReview") : t("pullReviewGroups.noHandledPullRequestsYet")}</p>}
          {page?.nextPage && <button className="button button-quiet pull-more" disabled={loading[key]} onClick={() => void load(repo, filter, page.nextPage!)}>{t("pullReviewGroups.loadMorePullRequests")}</button>}
        </>}</div>
      </section>;
    })}</div>
    {emptyRepos.length > 0 && <button className="text-link other-projects-toggle" aria-expanded={showOthers} onClick={() => setShowOthers((value) => !value)}>{showOthers ? t("pullReviewGroups.hideOtherProjects") : t("pullReviewGroups.showOtherProjects")} <span>{emptyRepos.length}</span><ChevronDown size={16} /></button>}
  </>;
}
