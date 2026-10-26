import { useTranslation } from '../localization';
import {
  ArrowDownToLine,
  ArrowRight,
  Clock3,
  CloudDownload,
  Folder,
  FolderOpen,
  LockKeyhole,
  Plus,
} from 'lucide-react';
import { ForksOverview } from '../components/ForksOverview';
import { LocalDiscoveryPanel } from '../components/LocalDiscoveryPanel';
import { SearchEmptyState } from '../components/SearchEmptyState';
import { SearchHistory } from '../components/SearchHistory';
import { SegmentedControl } from '../components/SegmentedControl';
import { formatRelative } from '../format';
import { parseProjectAddress } from '../projectAddress';
import { projectPresentation } from '../projectPresentation';
import { findLocalLink } from '../repositoryLinks';
import { type SearchEntry } from '../searchHistory';

import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import type { View } from '../workspace/navigation';
import { usePageActions } from '../workspace/pageActions';
import { RepoLogo } from './shared';

export function ProjectsPage() {
  const t = useTranslation();

  const w = useWorkspace();
  const {
    user,
    language,
    repos,
    localLinks,
    localStatuses,
    remotePreviews,
    localErrors,
    loading: sharedLoading,
    savedPublicRepos,
    searchHistory,
    clearSearchHistory,
    refreshLocalLinks,
    navigation,
  } = w;
  const { params } = usePageRoute();
  const { openProject, openPublicProject, openLocal, openProjectAddress, submitProjectSearch, openProfileRepository } =
    usePageActions();
  const relativeDate = formatRelative;
  const ownRepos = repos.filter((repo) => !repo.fork),
    forkRepos = repos.filter((repo) => repo.fork && repo.owner.login.toLowerCase() === user.login.toLowerCase());
  const setView = (view: View) =>
    navigation.navigate(
      view,
      ['project', 'local', 'issues', 'pulls', 'downloads', 'history', 'new-release', 'source-history'].includes(view)
        ? { repo: params.repo, localId: params.localId }
        : {},
    );
  const browseForkOriginal = (owner: string, name: string) => openProfileRepository(owner + '/' + name);
  const selectSearchHistory = (entry: SearchEntry) => {
    if (parseProjectAddress(entry.query)) void openProjectAddress(entry.query);
    else if (entry.scope === 'users' || entry.scope === 'public')
      submitProjectSearch(entry.query, entry.scope === 'users' ? 'users' : 'projects');
    else navigation.updateParams({ scope: entry.scope, query: entry.query });
  };

  const busy = sharedLoading,
    search = params.query ?? '',
    searchScope = params.scope ?? 'mine';
  const setSearch = (query: string) => navigation.updateParams({ query });
  const setSearchScope = (scope: string) => navigation.updateParams({ scope });
  const projectQuery = parseProjectAddress(search) ? '' : search;
  const filtered = ownRepos.filter((repo) =>
    `${repo.name} ${repo.description ?? ''}`.toLowerCase().includes(projectQuery.toLowerCase()),
  );
  const savedPublicMatches = savedPublicRepos.filter((repo) =>
    `${repo.full_name} ${repo.description ?? ''}`.toLowerCase().includes(projectQuery.toLowerCase()),
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('projectsPage.myProjects')}</h1>
          <p>{t('projectsPage.allYourIdeasAndProgressInOnePlace')}</p>
        </div>
        <button className="button button-primary" onClick={() => setView('new-project')}>
          <Plus size={18} />
          {t('projectsPage.newProject')}
        </button>
      </div>
      <div className="toolbar">
        <SegmentedControl role="group" aria-label={t('projectsPage.searchScope')}>
          <button
            className={searchScope === 'local' ? 'selected' : ''}
            aria-pressed={searchScope === 'local'}
            onClick={() => setSearchScope('local')}
          >
            {t('projectsPage.thisComputer')} <span>{localLinks.length}</span>
          </button>
          <button
            className={searchScope === 'mine' ? 'selected' : ''}
            aria-pressed={searchScope === 'mine'}
            onClick={() => setSearchScope('mine')}
          >
            {t('projectsPage.cloudProjects')} <span>{ownRepos.length}</span>
          </button>
          <button
            className={searchScope === 'forks' ? 'selected' : ''}
            aria-pressed={searchScope === 'forks'}
            onClick={() => setSearchScope('forks')}
          >
            {t('projectsPage.repositoryCopies')} <span>{forkRepos.length}</span>
          </button>
        </SegmentedControl>
      </div>
      {!search.trim() && (
        <SearchHistory entries={searchHistory} onSelect={selectSearchHistory} onClear={clearSearchHistory} />
      )}
      {searchScope === 'local' && <LocalDiscoveryPanel onAdded={refreshLocalLinks} />}
      {searchScope === 'mine' && savedPublicMatches.length > 0 && (
        <section className="panel saved-public-section">
          <div className="panel-heading">
            <h2>{t('projectsPage.addedPublicProjects')}</h2>
            <span className="muted">{t('projectsPage.readOnlyShortcutsOnThisComputer')}</span>
          </div>
          {savedPublicMatches.map((repo) => (
            <div className="cloud-row" key={repo.id}>
              <RepoLogo repo={repo} small />
              <div>
                <button className="plain-heading" onClick={() => openPublicProject(repo)}>
                  {repo.full_name}
                </button>
                <small>{repo.description || t('projectsPage.noDescriptionYet')}</small>
              </div>
              <span className="public-readonly-label">{t('projectsPage.readOnly')}</span>
              <button className="button button-quiet" onClick={() => openPublicProject(repo)}>
                {t('projectsPage.browse')}
              </button>
            </div>
          ))}
        </section>
      )}
      {searchScope === 'forks' ? (
        <ForksOverview
          repos={forkRepos}
          search={projectQuery}
          onClearSearch={() => setSearch('')}
          onOpen={(repo) => void openProject(repo)}
          onBrowseOriginal={(owner, name) => void browseForkOriginal(owner, name)}
        />
      ) : searchScope === 'local' ? (
        <div className="project-grid">
          {localLinks
            .filter((link) => `${link.name} ${link.localPath}`.toLowerCase().includes(projectQuery.toLowerCase()))
            .map((link) => {
              const repo = repos.find((item) => item.id === link.repositoryId);
              const state = projectPresentation(
                localStatuses[link.id],
                remotePreviews[link.id],
                localErrors[link.id],
                language,
              );
              return (
                <article className="project-card" key={link.id}>
                  <div className="card-head">
                    {repo ? (
                      <RepoLogo repo={repo} />
                    ) : (
                      <span className="project-logo logo-sky">
                        <Folder size={23} />
                      </span>
                    )}
                  </div>
                  <button className="plain-heading" onClick={() => openLocal(link, repo)}>
                    {link.name}
                  </button>
                  <p className="card-description">{repo?.description || t('projectsPage.noProjectDescriptionYet')}</p>
                  <small className="local-copy-path" title={link.localPath}>
                    {link.localPath}
                  </small>
                  <span className={`status status-${state.state}`}>
                    <span className="status-dot" />
                    {state.text}
                  </span>
                  <div className="card-footer">
                    <span>
                      <Clock3 size={14} />
                      {relativeDate(link.lastOpenedAt, language)}
                    </span>
                  </div>
                  <div className="card-actions">
                    <button className="button button-quiet" onClick={() => openLocal(link, repo)}>
                      {t('projectsPage.openProject')}
                    </button>
                    {repo && (
                      <button className="button button-primary" onClick={() => void openProject(repo, link.id)}>
                        {t('projectsPage.viewDetails')}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          {localLinks.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon">
                <FolderOpen size={28} />
              </span>
              <h3>{t('projectsPage.noProjectsOnThisComputerYet')}</h3>
              <p>{t('projectsPage.downloadFromGithubOrAddAnExistingFolder')}</p>
              <button
                className="button button-primary"
                onClick={() => {
                  setView('local');
                }}
              >
                {t('projectsPage.addProject')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="cloud-list">
          {filtered.map((repo) => {
            const external = false;
            const browse = (): void => {
              if (external) openPublicProject(repo);
              else void openProject(repo);
            };
            return (
              <div className="cloud-row" key={repo.id}>
                <RepoLogo repo={repo} small />
                <div>
                  <button className="plain-heading" onClick={browse}>
                    {repo.name}
                  </button>
                  <small>
                    {repo.description || t('projectsPage.noDescriptionYet')} · {relativeDate(repo.updated_at, language)}
                    {t('projectsPage.updated')}
                  </small>
                </div>
                <span className="cloud-private">
                  {external ? (
                    t('projectsPage.readOnly')
                  ) : repo.private ? (
                    <>
                      <LockKeyhole size={14} />
                      {t('projectsPage.onlyMe')}
                    </>
                  ) : (
                    t('projectsPage.everyone')
                  )}
                </span>
                <button className="button button-quiet" onClick={browse}>
                  {external ? t('projectsPage.browseReadOnly') : t('projectsPage.view')}
                </button>
                {!external && (
                  <button
                    className="button button-quiet"
                    onClick={() => {
                      const link = findLocalLink(repo, localLinks);
                      if (link) openLocal(link, repo);
                      else {
                        navigation.navigate('local', { repo: repo.full_name });
                      }
                    }}
                  >
                    {findLocalLink(repo, localLinks) ? (
                      <>
                        {t('projectsPage.open')} <FolderOpen size={16} />
                      </>
                    ) : (
                      <>
                        {t('projectsPage.download')} <ArrowDownToLine size={16} />
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
          {filtered.length === 0 &&
            !busy &&
            savedPublicMatches.length === 0 &&
            (search.trim() ? (
              <SearchEmptyState language={language} onClear={() => setSearch('')} />
            ) : (
              <p className="live-empty">{t('projectsPage.noProjectsYet')}</p>
            ))}
        </div>
      )}
      {searchScope === 'local' &&
        search.trim() &&
        localLinks.filter((link) => `${link.name} ${link.localPath}`.toLowerCase().includes(projectQuery.toLowerCase()))
          .length === 0 && <SearchEmptyState language={language} onClear={() => setSearch('')} />}
      <div className="home-shortcuts">
        <button
          onClick={() => {
            setSearchScope('mine');
            setView('projects');
          }}
        >
          <CloudDownload size={17} />
          {t('projectsPage.downloadFromGithub')} <ArrowRight size={15} />
        </button>
        <button
          onClick={() => {
            setView('local');
          }}
        >
          <FolderOpen size={17} />
          {t('projectsPage.addExistingFolder')} <ArrowRight size={15} />
        </button>
      </div>
    </>
  );
}
