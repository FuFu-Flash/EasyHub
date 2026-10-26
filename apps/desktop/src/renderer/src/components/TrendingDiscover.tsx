import { type Translator, useTranslation } from '../localization';
import { useEasyHub, useWorkspaceStorage } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { SegmentedControl } from './SegmentedControl';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock3, LayoutGrid, List, Search, Star, TrendingUp } from 'lucide-react';
import type { GitHubRepo, GitHubSearchUser, TrendingPage, TrendingPeriod } from '@easyhub/github';
import type { SearchEntry } from '../searchHistory';
import { UserSearchResults } from './UserSearchResults';
import { parseProjectAddress } from '../projectAddress';
import { SearchPagination } from './SearchPagination';
import { SearchEmptyState } from './SearchEmptyState';
import { SearchHistory } from './SearchHistory';

interface Snapshot {
  at: number;
  stars: number;
}
type Snapshots = Record<string, Snapshot[]>;
const storageKey = 'easyhub:trending-star-observations:v1';
type Cache = Map<string, { at: number; result: TrendingPage }>;

const periods: TrendingPeriod[] = ['today', 'week', 'month'];
function readSnapshots(storage: Pick<Storage, 'getItem'>): Snapshots {
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Snapshots) : {};
  } catch {
    return {};
  }
}
function trend(repo: GitHubRepo, snapshots: Snapshots, days: number, t: Translator): string {
  const history = snapshots[String(repo.id)] ?? [];
  const first = history.find(
    (item) => item.at >= Date.now() - days * 86400000 && item.stars < (repo.stargazers_count ?? 0),
  );
  if (first)
    return t('trendingDiscover.starsObserved', { p0: Math.max(0, (repo.stargazers_count ?? 0) - first.stars) });
  return history.some((item) => item.at < Date.now() - 3600000)
    ? t('trendingDiscover.noNewStarsObserved')
    : t('trendingDiscover.trackingGrowth');
}

export type DiscoverScope = 'projects' | 'users';
export type SearchDisplayMode = 'compact' | 'detailed';
export function TrendingDiscover({
  query,
  setQuery,
  scope,
  onScopeChange,
  period,
  onPeriodChange,
  page,
  onPageChange,
  displayMode,
  onDisplayMode,
  history,
  onSelectHistory,
  onClearHistory,
  searchResults,
  searchBusy,
  searchError,
  searchPage,
  searchTotalCount,
  searchHasNextPage,
  onSearchPageChange,
  onOpen,
  onOpenProfile,
  onSearch,
  onUserSearched,
}: {
  query: string;
  setQuery: (value: string) => void;
  scope: DiscoverScope;
  onScopeChange: (scope: DiscoverScope) => void;
  period: TrendingPeriod;
  onPeriodChange: (period: TrendingPeriod) => void;
  page: number;
  onPageChange: (page: number) => void;
  displayMode: SearchDisplayMode;
  onDisplayMode: (mode: SearchDisplayMode) => void;
  history: SearchEntry[];
  onSelectHistory: (entry: SearchEntry) => void;
  onClearHistory: () => void;
  searchResults: GitHubRepo[];
  searchBusy: boolean;
  searchError: string;
  searchPage: number;
  searchTotalCount: number | null;
  searchHasNextPage: boolean;
  onSearchPageChange: (page: number) => void;
  onOpen: (repo: GitHubRepo) => void;
  onOpenProfile: (user: GitHubSearchUser) => void;
  onSearch: (value: string) => void;
  onUserSearched: (value: string) => void;
}) {
  const t = useTranslation();
  const labels: Record<TrendingPeriod, string> = {
    today: t('trendingDiscover.popularToday'),
    week: t('trendingDiscover.popularThisWeek'),
    month: t('trendingDiscover.popularThisMonth'),
  };
  const easyHub = useEasyHub();
  const storage = useWorkspaceStorage();
  const cache = useRef<Cache>(new Map()).current;
  const key = `${period}:${page}`;
  const [result, setResult] = useState<{ key: string; value: TrendingPage }>(() => ({
    key,
    value: cache.get(key)?.result ?? { items: [], page, hasNextPage: false },
  }));
  const [snapshots, setSnapshots] = useState<Snapshots>(() => readSnapshots(storage));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    if (scope === 'users') {
      setBusy(false);
      return () => {
        active = false;
      };
    }
    const cached = cache.get(key);
    if (!refresh && cached && Date.now() - cached.at < 600000) {
      setResult({ key, value: cached.result });
      setBusy(false);
      setError('');
      return () => {
        active = false;
      };
    }
    setBusy(true);
    setError('');
    setResult({ key, value: { items: [], page, hasNextPage: false } });
    void (
      easyHub
        ? easyHub.github<TrendingPage>('trending', period, page)
        : Promise.reject(new Error(t('trendingDiscover.theAppConnectionIsUnavailablePleaseRestartEasyhub')))
    )
      .then((response) => {
        if (!active) return;
        setResult({ key, value: response });
        cache.set(key, { at: Date.now(), result: response });
        const next = readSnapshots(storage);
        const now = Date.now();
        for (const repo of response.items) {
          const key = String(repo.id);
          const previous = Array.isArray(next[key])
            ? next[key].filter((item) => item.at >= now - 31 * 86400000 && Number.isFinite(item.stars))
            : [];
          next[key] = [...previous, { at: now, stars: repo.stargazers_count ?? 0 }].slice(-31);
        }
        storage.setItem(storageKey, JSON.stringify(next));
        setSnapshots(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, t('trendingDiscover.trendingProjectsCannotBeLoadedRightNow')));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [key, page, period, refresh, scope]);
  const current = result.key === key ? result.value : cache.get(key)?.result;
  const visible = query.trim().length >= 2 ? searchResults : (current?.items ?? []);
  const projectAddress = parseProjectAddress(query);
  const isSearch = query.trim().length >= 2 && !projectAddress;
  const hasQuery = Boolean(query.trim());
  return (
    <div className="discover-page">
      <div className="page-header">
        <div>
          <h1>{t('trendingDiscover.discoverSearch')}</h1>
        </div>
      </div>
      <SegmentedControl className="discover-scopes" role="group" aria-label={t('trendingDiscover.searchType')}>
        <button
          className={scope === 'projects' ? 'selected' : ''}
          aria-pressed={scope === 'projects'}
          onClick={() => onScopeChange('projects')}
        >
          {t('trendingDiscover.projects')}
        </button>
        <button
          className={scope === 'users' ? 'selected' : ''}
          aria-pressed={scope === 'users'}
          onClick={() => onScopeChange('users')}
        >
          {t('trendingDiscover.users')}
        </button>
      </SegmentedControl>

      {!hasQuery && <SearchHistory entries={history} onSelect={onSelectHistory} onClear={onClearHistory} />}
      {scope === 'projects' && !hasQuery && (
        <>
          <div className="trending-heading">
            <div>
              <h2>{t('trendingDiscover.easyhubPopular')}</h2>
            </div>
            <button className="text-link" onClick={() => setRefresh((value) => value + 1)}>
              {t('trendingDiscover.refresh')}
            </button>
          </div>
          <SegmentedControl className="trending-periods" role="group" aria-label={t('trendingDiscover.popularPeriod')}>
            {periods.map((item) => (
              <button
                key={item}
                aria-pressed={period === item}
                className={period === item ? 'selected' : ''}
                onClick={() => onPeriodChange(item)}
              >
                {labels[item]}
              </button>
            ))}
          </SegmentedControl>
        </>
      )}
      {isSearch && (
        <div className="discover-results-toolbar">
          <h2 className="discover-results-title">
            {scope === 'users'
              ? t('trendingDiscover.userSearchResults')
              : t('trendingDiscover.publicProjectSearchResults')}
          </h2>
          <div className="search-display-switch" role="group" aria-label={t('trendingDiscover.resultDisplayMode')}>
            <button
              className={displayMode === 'compact' ? 'selected' : ''}
              aria-pressed={displayMode === 'compact'}
              onClick={() => onDisplayMode('compact')}
            >
              <List size={16} />
              {t('trendingDiscover.compact')}
            </button>
            <button
              className={displayMode === 'detailed' ? 'selected' : ''}
              aria-pressed={displayMode === 'detailed'}
              onClick={() => onDisplayMode('detailed')}
            >
              <LayoutGrid size={16} />
              {t('trendingDiscover.detailed')}
            </button>
          </div>
        </div>
      )}
      {projectAddress ? (
        <button className="project-address-suggestion" onClick={() => onSearch(query)}>
          <Search size={18} />
          <span>
            {t('trendingDiscover.openProject')}{' '}
            <strong>
              {projectAddress.owner}/{projectAddress.name}
            </strong>
          </span>
          <ArrowRight size={18} />
        </button>
      ) : scope === 'users' ? (
        isSearch ? (
          <UserSearchResults
            query={query}
            onClearSearch={() => setQuery('')}
            page={searchPage}
            onPageChange={onSearchPageChange}
            displayMode={displayMode}
            onOpenProfile={onOpenProfile}
            onOpenRepository={onOpen}
            onSearched={onUserSearched}
          />
        ) : (
          <p className="live-empty">{t('trendingDiscover.enterAtLeast2CharactersToSearchGithubUsers')}</p>
        )
      ) : hasQuery && !isSearch ? (
        <p className="live-empty">{t('trendingDiscover.enterAtLeast2CharactersToSearchPublicProjects')}</p>
      ) : (isSearch ? searchBusy : busy) ? (
        <p className="live-empty">
          <Clock3 size={16} /> {t('trendingDiscover.loadingProjectsFromGithub')}
        </p>
      ) : (isSearch ? searchError : error) ? (
        <p className="live-error" role="alert">
          <ErrorMessage error={isSearch ? searchError : error} />
        </p>
      ) : (
        <div className={`trending-list ${isSearch ? `search-result-grid ${displayMode}` : ''}`}>
          {visible.map((repo, index) => (
            <button
              className={`trending-card ${isSearch && displayMode === 'compact' ? 'compact' : ''}`}
              key={repo.id}
              onClick={() => onOpen(repo)}
            >
              <span className="trending-rank">
                {isSearch ? <Search size={17} /> : `#${(page - 1) * 30 + index + 1}`}
              </span>
              <span className="trending-author-avatar">
                {repo.owner.avatar_url ? (
                  <img src={repo.owner.avatar_url} alt={t('trendingDiscover.sAvatar', { p0: repo.owner.login })} />
                ) : (
                  repo.owner.login.slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="trending-content">
                <strong>{repo.name}</strong>
                <small>{repo.owner.login}</small>
                {(!isSearch || displayMode === 'detailed') && (
                  <span>{repo.description || t('trendingDiscover.noProjectDescriptionYet')}</span>
                )}
                <span className="trending-meta">
                  {(!isSearch || displayMode === 'detailed') && (
                    <em>{repo.language || t('trendingDiscover.languageNotSpecified')}</em>
                  )}
                  <em>
                    <Star size={14} />
                    {(repo.stargazers_count ?? 0).toLocaleString()}
                  </em>
                  {(!isSearch || displayMode === 'detailed') && (
                    <em>
                      <TrendingUp size={14} />
                      {isSearch
                        ? t('trendingDiscover.publicProjects')
                        : trend(repo, snapshots, period === 'today' ? 1 : period === 'week' ? 7 : 30, t)}
                    </em>
                  )}
                </span>
              </span>
              <ArrowRight size={19} />
            </button>
          ))}
          {visible.length === 0 && isSearch ? (
            <SearchEmptyState onClear={() => setQuery('')} />
          ) : (
            <p className="live-empty">{t('trendingDiscover.noPopularProjectsMatchThisPeriodYet')}</p>
          )}
        </div>
      )}
      {scope === 'projects' && isSearch && (
        <SearchPagination
          page={searchPage}
          totalCount={searchTotalCount}
          hasNextPage={searchHasNextPage}
          busy={searchBusy}
          onPageChange={onSearchPageChange}
        />
      )}
      {scope === 'projects' && !hasQuery && (page > 1 || current?.hasNextPage) && (
        <nav className="trending-pagination" aria-label={t('trendingDiscover.trendingProjectPages')}>
          <button className="button button-quiet" disabled={page === 1 || busy} onClick={() => onPageChange(page - 1)}>
            {t('trendingDiscover.previousPage')}
          </button>
          <span>{t('trendingDiscover.page', { p0: page })}</span>
          <button
            className="button button-quiet"
            disabled={!current?.hasNextPage || busy}
            onClick={() => onPageChange(page + 1)}
          >
            {t('trendingDiscover.nextPage')}
          </button>
        </nav>
      )}
    </div>
  );
}
