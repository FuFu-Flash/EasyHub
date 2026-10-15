import type { GitHubRepo, GitHubSearchPage, TrendingPeriod } from '@easyhub/github';
import { useCallback } from 'react';
import { TrendingDiscover, type DiscoverScope, type SearchDisplayMode } from '../components/TrendingDiscover';
import { parseProjectAddress } from '../projectAddress';
import { type SearchEntry } from '../searchHistory';

import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageActions } from '../workspace/pageActions';
import { usePageData } from '../workspace/pageData';

export function DiscoverPage() {
  const w = useWorkspace();
  const { searchDisplayMode, searchHistory, clearSearchHistory, api, recordSearch, navigation } = w;
  const { params } = usePageRoute();
  const { openPublicProject, openProjectAddress, submitProjectSearch, openSearchedUser } = usePageActions();
  const setSearchDisplayMode = (value: SearchDisplayMode) => w.set('searchDisplayMode', value);
  const selectSearchHistory = (entry: SearchEntry) => {
    if (parseProjectAddress(entry.query)) void openProjectAddress(entry.query);
    else if (entry.scope === 'users' || entry.scope === 'public')
      submitProjectSearch(entry.query, entry.scope === 'users' ? 'users' : 'projects');
    else navigation.updateParams({ scope: entry.scope, query: entry.query });
  };

  const submittedSearch = params.query ?? '',
    discoverScope = params.scope === 'users' ? 'users' : 'projects';
  const discoverPeriod = (params.period ?? 'today') as TrendingPeriod,
    discoverPage = params.page ?? 1,
    publicSearchPage = params.searchPage ?? 1;
  const result = usePageData<GitHubSearchPage<GitHubRepo>>(
    'search:' + submittedSearch + ':' + publicSearchPage + ':' + discoverScope,
    async () =>
      submittedSearch.trim().length >= 2 && !parseProjectAddress(submittedSearch) && discoverScope === 'projects'
        ? api('searchPublicReposPage', submittedSearch.trim(), publicSearchPage)
        : { items: [], totalCount: 0, hasNextPage: false, page: 1, incompleteResults: false },
    { items: [], totalCount: 0, hasNextPage: false, page: 1, incompleteResults: false },
  );
  const publicRepos = result.data.items,
    publicSearchBusy = result.loading,
    publicSearchError = result.error,
    publicSearchTotalCount = result.data.totalCount,
    publicSearchHasNextPage = result.data.hasNextPage;
  const setSearch = (query: string) => navigation.updateParams({ query, searchPage: 1 });
  const setSubmittedSearch = setSearch;
  const setDiscoverScope = (scope: DiscoverScope) => navigation.updateParams({ scope, searchPage: 1 });
  const setDiscoverPeriod = (period: TrendingPeriod) => navigation.updateParams({ period, page: 1 }, true);
  const setDiscoverPage = (page: number) => navigation.updateParams({ page }, true);
  const changeDiscoverPage = setDiscoverPage,
    changeSearchPage = (searchPage: number) => navigation.updateParams({ searchPage }, true);
  const recordUserSearch = useCallback((query: string) => recordSearch(query, 'users'), [recordSearch]);

  return (
    <TrendingDiscover
      query={submittedSearch}
      setQuery={(value) => {
        setSearch(value);
        setSubmittedSearch(value);
      }}
      scope={discoverScope}
      onScopeChange={setDiscoverScope}
      period={discoverPeriod}
      onPeriodChange={(period) => {
        setDiscoverPeriod(period);
        setDiscoverPage(1);
      }}
      page={discoverPage}
      onPageChange={changeDiscoverPage}
      displayMode={searchDisplayMode}
      onDisplayMode={setSearchDisplayMode}
      history={searchHistory}
      onSelectHistory={selectSearchHistory}
      onClearHistory={clearSearchHistory}
      searchResults={publicRepos}
      searchBusy={publicSearchBusy}
      searchError={publicSearchError}
      searchPage={publicSearchPage}
      searchTotalCount={publicSearchTotalCount}
      searchHasNextPage={publicSearchHasNextPage}
      onSearchPageChange={changeSearchPage}
      onOpen={openPublicProject}
      onOpenProfile={openSearchedUser}
      onSearch={submitProjectSearch}
      onUserSearched={recordUserSearch}
    />
  );
}
