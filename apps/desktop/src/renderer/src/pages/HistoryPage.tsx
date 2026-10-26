import { useTranslation } from '../localization';
import type { GitHubCommit } from '@easyhub/github';
import { ArrowLeft, ArrowRight, Clock3 } from 'lucide-react';
import { PagedContinuation } from '../components/PagedContinuation';
import { formatDateTime } from '../format';
import { useReadingWindow } from '../workspace/pageData';
import { readPageWindow } from '../workspace/pageWindow';

import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageActions } from '../workspace/pageActions';
import { usePageData, useRepository } from '../workspace/pageData';
import { ownerOf, PageStatus } from './shared';

export function HistoryPage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { language, api, navigation } = w;
  const { params } = usePageRoute();
  const { openVersionFor } = usePageActions();
  const date = (value: string) => formatDateTime(value, language);

  const selected = useRepository(),
    window = useReadingWindow();
  const result = usePageData<{ items: GitHubCommit[]; nextPage: number | null }>(
    'history-window:' + params.repo,
    async () => {
      if (!selected) return { items: [], nextPage: null };
      return await readPageWindow(
        async () => {
          const items = await api<GitHubCommit[]>('commits', ownerOf(selected), selected.name);
          return { items, nextPage: items.length >= 100 ? 2 : null };
        },
        (page) =>
          api<{ items: GitHubCommit[]; nextPage: number | null }>(
            'commitsPage',
            ownerOf(selected),
            selected.name,
            page,
          ),
        window.pages.current,
        (item) => item.sha,
      );
    },
    { items: [], nextPage: null },
  );
  const commits = result.data.items,
    busy = result.loading;
  const append = (items: GitHubCommit[], nextPage?: number | null) => {
    window.pages.current++;
    result.setData((old) => ({
      items: [...old.items, ...items.filter((item) => !old.items.some((known) => known.sha === item.sha))],
      nextPage: nextPage ?? null,
    }));
  };
  const openVersion = (item: GitHubCommit) => {
    if (selected) openVersionFor(selected, item);
  };
  if (!selected) return <PageStatus loading error="" />;

  return (
    <>
      <PageStatus loading={busy && !commits.length} error={result.error} retry={result.reload} cancel={result.cancel} />
      <button className="back-link" onClick={() => navigation.back('project')}>
        <ArrowLeft size={17} />
        {t('historyPage.backToProject')}
      </button>
      <div className="page-header">
        <div>
          <div className="eyebrow">{selected.name}</div>
          <h1>{t('historyPage.changeHistory')}</h1>
        </div>
      </div>
      <div className="history-list">
        {commits.map((item) => (
          <button className="history-row" key={item.sha} onClick={() => void openVersion(item)}>
            <span className="history-icon">
              <Clock3 size={19} />
            </span>
            <span className="history-main">
              <strong>{item.commit.message.split('\n')[0]}</strong>
              <small>
                {item.commit.author?.date ? date(item.commit.author.date) : ''} ·{' '}
                {item.author?.login || item.commit.author?.name || t('historyPage.unknownAuthor')}
              </small>
            </span>
            <span className="button button-quiet small-button">
              {t('historyPage.view')} <ArrowRight size={15} />
            </span>
          </button>
        ))}
        {commits.length === 0 && !busy && <p className="live-empty">{t('historyPage.noChangeHistoryYet')}</p>}
      </div>
      {!busy && (
        <PagedContinuation<GitHubCommit>
          key={selected.id}
          action="commitsPage"
          args={[ownerOf(selected), selected.name]}
          firstCount={commits.length}
          language={language}
          initialNextPage={result.data.nextPage}
          onItems={append}
        />
      )}
    </>
  );
}
