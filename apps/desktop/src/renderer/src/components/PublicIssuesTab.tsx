import { ArrowRight, MessageCircle, RotateCw } from 'lucide-react';
import type { GitHubIssue, GitHubRepo } from '@easyhub/github';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { DiscussionSearch, type DiscussionSearchState } from './DiscussionSearch';
import { ErrorMessage } from './ErrorMessage';
import { SegmentedControl } from './SegmentedControl';
import { TranslatableContent } from './TranslatableContent';

export type PublicIssueFilter = 'open' | 'closed';

/** Issues tab of a public project: state filter, search and the paged issue list. */
export function PublicIssuesTab({
  repo,
  language,
  issues,
  issueFilter,
  onIssueFilterChange,
  search,
  onSearchChange,
  loadingIssues,
  issueError,
  nextIssuePage,
  onOpenIssue,
  onLoadMore,
}: {
  repo: GitHubRepo;
  language: Language;
  issues: GitHubIssue[];
  issueFilter: PublicIssueFilter;
  onIssueFilterChange: (filter: PublicIssueFilter) => void;
  search: DiscussionSearchState;
  onSearchChange: (patch: Partial<DiscussionSearchState>) => void;
  loadingIssues: boolean;
  issueError: string;
  nextIssuePage: number | null;
  onOpenIssue: (issue: GitHubIssue) => void;
  onLoadMore: () => void;
}) {
  const t = useTranslation(language);
  return (
    <>
      <h2 className="visually-hidden">{t('publicProjectBrowser.issues')}</h2>
      <DiscussionSearch
        filters={
          <SegmentedControl className="public-issue-filter">
            <button
              className={issueFilter === 'open' ? 'selected' : ''}
              disabled={loadingIssues}
              onClick={() => onIssueFilterChange('open')}
            >
              {t('publicProjectBrowser.open')}
            </button>
            <button
              className={issueFilter === 'closed' ? 'selected' : ''}
              disabled={loadingIssues}
              onClick={() => onIssueFilterChange('closed')}
            >
              {t('publicProjectBrowser.resolved')}
            </button>
          </SegmentedControl>
        }
        repositories={[repo]}
        kind="issue"
        state={issueFilter}
        language={language}
        search={search}
        onSearchChange={onSearchChange}
        onOpen={onOpenIssue}
      />
      <div hidden={Boolean(search.query)}>
        {issueError && (
          <p className="live-error" role="alert">
            <ErrorMessage error={issueError} language={language} />
          </p>
        )}
        {issues.map((item) => (
          <button className="public-list-row" key={item.id} onClick={() => onOpenIssue(item)}>
            <MessageCircle size={19} />
            <span>
              <TranslatableContent
                text={item.title}
                format="text"
                protectedNames={item.user?.login ? [item.user.login] : []}
                render={(value) => <strong>{value}</strong>}
              />
              <small>
                {item.state === 'open' ? t('publicProjectBrowser.open') : t('publicProjectBrowser.resolved')} ·{' '}
                {item.user?.login || t('publicProjectBrowser.githubUser')}
              </small>
            </span>
            <ArrowRight size={17} />
          </button>
        ))}
        {loadingIssues && issues.length === 0 && (
          <p className="live-loading">
            <RotateCw size={16} className="live-spin" />
            {t('publicProjectBrowser.loadingIssues')}
          </p>
        )}
        {issues.length === 0 && !loadingIssues && !issueError && (
          <p className="muted">{t('publicProjectBrowser.thisProjectHasNoIssues')}</p>
        )}
        {(nextIssuePage || issueError) && (
          <button className="button button-quiet pull-more" disabled={loadingIssues} onClick={onLoadMore}>
            {loadingIssues
              ? t('publicProjectBrowser.loading')
              : issueError
                ? t('publicProjectBrowser.retry')
                : t('publicProjectBrowser.loadMoreIssues')}
          </button>
        )}
      </div>
    </>
  );
}
