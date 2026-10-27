import { useTranslation } from '../localization';
import type { GitHubCommit, GitHubRepo } from '@easyhub/github';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { ErrorMessage } from '../components/ErrorMessage';
import { formatRelative } from '../format';

import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageActions } from '../workspace/pageActions';
import { usePageData } from '../workspace/pageData';
import { ownerOf, RepoLogo } from './shared';

export function RecentHistoryPage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { language, repos, api, navigation } = w;
  const { openVersionFor } = usePageActions();
  const relativeDate = formatRelative;

  const updates = usePageData<{ items: { repo: GitHubRepo; commit: GitHubCommit }[]; partial: boolean }>(
    'recent-updates',
    async () => {
      const results = await Promise.allSettled(
        repos
          .filter((repo) => !repo.fork)
          .slice(0, 4)
          .map(async (repo) => ({ repo, items: await api<GitHubCommit[]>('commits', ownerOf(repo), repo.name) })),
      );
      const items = results
        .flatMap((result) =>
          result.status === 'fulfilled'
            ? result.value.items.slice(0, 3).map((commit) => ({ repo: result.value.repo, commit }))
            : [],
        )
        .sort(
          (a, b) =>
            (Date.parse(b.commit.commit.author?.date ?? '') || 0) -
            (Date.parse(a.commit.commit.author?.date ?? '') || 0),
        );
      return { items, partial: results.some((result) => result.status === 'rejected') };
    },
    { items: [], partial: false },
    repos.map((repo) => repo.id + ':' + repo.updated_at).join('|'),
  );
  const recentUpdates = updates.data.items,
    recentLoading = updates.loading,
    recentError =
      updates.error || (updates.data.partial ? t('recentHistoryPage.updatesForSomeProjectsCouldNotBeLoaded') : '');

  return (
    <>
      <button className="back-link" onClick={() => navigation.back('home')}>
        <ArrowLeft size={17} />
        {t('recentHistoryPage.backToHome')}
      </button>
      <div className="page-header">
        <div>
          <h1>{t('recentHistoryPage.recentUpdates')}</h1>
        </div>
      </div>
      <div className="history-list">
        {recentUpdates.map(({ repo, commit: item }) => (
          <button
            className="history-row"
            key={`${repo.id}:${item.sha}`}
            onClick={() => void openVersionFor(repo, item)}
          >
            <RepoLogo repo={repo} small />
            <span className="history-main">
              <strong>{item.commit.message.split('\n')[0]}</strong>
              <small>
                {repo.name} · {relativeDate(item.commit.author?.date ?? repo.updated_at, language)}
              </small>
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      {recentLoading && <p className="muted">{t('recentHistoryPage.loadingRecentUpdates')}</p>}
      {recentError && (
        <p className="muted">
          <ErrorMessage error={recentError} />
        </p>
      )}
    </>
  );
}
