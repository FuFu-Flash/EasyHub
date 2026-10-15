import { useTranslation } from '../localization';
export function SearchPagination({
  page,
  totalCount,
  hasNextPage,
  busy,
  onPageChange,
}: {
  page: number;
  totalCount: number | null;
  hasNextPage: boolean;
  busy: boolean;
  onPageChange: (page: number) => void;
}) {
  const t = useTranslation();
  return (
    <div className="search-pagination">
      {totalCount !== null && (
        <p className="muted" role="status">
          {t('searchPagination.resultsFound', { p0: totalCount.toLocaleString() })}
          {totalCount > 1000 && <span> {t('searchPagination.thereAreManyMatchesRefineYourSearchToFind')}</span>}
        </p>
      )}
      {(page > 1 || hasNextPage) && (
        <nav className="trending-pagination" aria-label={t('searchPagination.searchResultPages')}>
          <button className="button button-quiet" disabled={page <= 1 || busy} onClick={() => onPageChange(page - 1)}>
            {t('searchPagination.previousPage')}
          </button>
          <span>{t('searchPagination.page', { p0: page })}</span>
          <button
            className="button button-quiet"
            disabled={!hasNextPage || busy}
            onClick={() => onPageChange(page + 1)}
          >
            {t('searchPagination.nextPage')}
          </button>
        </nav>
      )}
    </div>
  );
}
