import { ArrowRight, GitPullRequest, Plus, RotateCw } from 'lucide-react';
import type { GitHubIssue, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { DiscussionSearch, type DiscussionSearchState } from './DiscussionSearch';
import { ErrorMessage } from './ErrorMessage';
import { SegmentedControl } from './SegmentedControl';
import { TranslatableContent } from './TranslatableContent';

export type PullListState = 'open' | 'closed' | 'all';

/** Pull request list of one project with state filters, search and paging. */
export function PullRequestList({
  repo,
  language,
  showCreateButton,
  error,
  listState,
  onListStateChange,
  search,
  onSearchChange,
  items,
  busy,
  hasMore,
  onCreate,
  onOpen,
  onOpenSearchResult,
  onLoadMore,
}: {
  repo: GitHubRepo;
  language: Language;
  showCreateButton: boolean;
  error: string;
  listState: PullListState;
  onListStateChange: (state: PullListState) => void;
  search: DiscussionSearchState;
  onSearchChange: (patch: Partial<DiscussionSearchState>) => void;
  items: GitHubPullRequest[];
  busy: boolean;
  hasMore: boolean;
  onCreate: () => void;
  onOpen: (item: GitHubPullRequest) => void;
  onOpenSearchResult: (item: GitHubIssue) => void;
  onLoadMore: () => void;
}) {
  const t = useTranslation(language);
  return (
    <>
      <h2 className="visually-hidden">{t('pullRequestsPanel.pullRequestReviews')}</h2>
      {showCreateButton && (
        <div className="panel-heading panel-heading-end">
          <button className="button button-primary" onClick={onCreate}>
            <Plus size={16} />
            {t('pullRequestsPanel.createPullRequest')}
          </button>
        </div>
      )}
      {error && (
        <p className="live-error" role="alert">
          <ErrorMessage error={error} language={language} />
        </p>
      )}
      <DiscussionSearch
        filters={
          <SegmentedControl className="public-issue-filter">
            {(['all', 'open', 'closed'] as const).map((state) => (
              <button
                key={state}
                className={listState === state ? 'selected' : ''}
                onClick={() => onListStateChange(state)}
              >
                {state === 'all'
                  ? t('pullRequestsPanel.all')
                  : state === 'open'
                    ? t('pullRequestsPanel.open')
                    : t('pullRequestsPanel.closed')}
              </button>
            ))}
          </SegmentedControl>
        }
        repositories={[repo]}
        kind="pr"
        state={listState}
        language={language}
        search={search}
        onSearchChange={onSearchChange}
        onOpen={onOpenSearchResult}
      />
      <div hidden={Boolean(search.query)}>
        {items.map((item) => (
          <button className="public-list-row" key={item.id} onClick={() => onOpen(item)}>
            <GitPullRequest size={19} />
            <span>
              {repo.private ? (
                <strong>{item.title}</strong>
              ) : (
                <TranslatableContent text={item.title} format="text" render={(value) => <strong>{value}</strong>} />
              )}
              <small>
                {item.merged_at
                  ? t('pullRequestsPanel.merged')
                  : item.state === 'open'
                    ? item.draft
                      ? t('pullRequestsPanel.draft')
                      : t('pullRequestsPanel.open')
                    : t('pullRequestsPanel.closed')}{' '}
                · {item.user?.login || t('pullRequestsPanel.githubUser')}
              </small>
            </span>
            <ArrowRight size={17} />
          </button>
        ))}
        {!busy && !error && items.length === 0 && (
          <p className="muted">{t('pullRequestsPanel.thisProjectHasNoPullRequestsYet')}</p>
        )}
        {busy && (
          <p className="live-loading">
            <RotateCw size={16} className="live-spin" />
            {t('pullRequestsPanel.loadingPullRequests')}
          </p>
        )}
        {hasMore && (
          <button className="button button-quiet pull-more" disabled={busy} onClick={onLoadMore}>
            {t('pullRequestsPanel.loadMore')}
          </button>
        )}
      </div>
    </>
  );
}
