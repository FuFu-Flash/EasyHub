import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useState } from 'react';
import { ArrowRight, Clock3, Folder, Star } from 'lucide-react';
import type { GitHubRepo, GitHubSearchPage, GitHubSearchUser } from '@easyhub/github';
import { SearchPagination } from './SearchPagination';
import { SearchEmptyState } from './SearchEmptyState';

const topCache = new Map<string, { at: number; repos: GitHubRepo[] }>();
type DisplayMode = 'compact' | 'detailed';

export function UserSearchResults({
  query,
  onClearSearch,
  page,
  onPageChange,
  displayMode,
  onOpenProfile,
  onOpenRepository,
  onSearched,
}: {
  query: string;
  onClearSearch?: () => void;
  page: number;
  onPageChange: (page: number) => void;
  displayMode: DisplayMode;
  onOpenProfile: (user: GitHubSearchUser) => void;
  onOpenRepository: (repo: GitHubRepo) => void;
  onSearched: (query: string) => void;
}) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [users, setUsers] = useState<GitHubSearchUser[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [topRepos, setTopRepos] = useState<Record<string, GitHubRepo[] | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (query.trim().length < 2) {
      setUsers([]);
      setBusy(false);
      setError('');
      return;
    }
    let active = true;
    setUsers([]);
    setTopRepos({});
    setBusy(true);
    setError('');
    setTotalCount(null);
    setHasNextPage(false);
    const timer = window.setTimeout(() => {
      void (
        easyHub
          ? easyHub.github<GitHubSearchPage<GitHubSearchUser>>('searchUsersPage', query.trim(), page)
          : Promise.reject(new Error(t('userSearchResults.theAppConnectionIsUnavailablePleaseRestartEasyhub')))
      )
        .then((results) => {
          if (active) {
            setUsers(results.items);
            setTotalCount(results.totalCount);
            setHasNextPage(results.hasNextPage);
            onSearched(query);
          }
        })
        .catch((cause: unknown) => {
          if (active) setError(errorText(cause, t('userSearchResults.userSearchIsTemporarilyUnavailable')));
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 450);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, page, onSearched]);

  useEffect(() => {
    if (displayMode !== 'detailed' || users.length === 0 || !easyHub) return;
    let active = true;
    const service = easyHub;
    void (async () => {
      const uncached: GitHubSearchUser[] = [];
      for (const user of users) {
        const cached = topCache.get(user.login);
        if (cached && Date.now() - cached.at < 600000)
          setTopRepos((current) => ({ ...current, [user.login]: cached.repos }));
        else uncached.push(user);
      }
      for (let index = 0; index < uncached.length && active; index += 2) {
        await Promise.all(
          uncached.slice(index, index + 2).map(async (user) => {
            try {
              const repos = await service.github<GitHubRepo[]>('topStarredRepos', user.login);
              if (active) {
                topCache.set(user.login, { at: Date.now(), repos });
                setTopRepos((current) => ({ ...current, [user.login]: repos }));
              }
            } catch {
              if (active) setTopRepos((current) => ({ ...current, [user.login]: [] }));
            }
          }),
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [displayMode, users]);

  return (
    <>
      {busy ? (
        <p className="live-empty">
          <Clock3 size={16} /> {t('userSearchResults.searchingUsers')}
        </p>
      ) : error ? (
        <p className="live-error" role="alert">
          <ErrorMessage error={error} />
        </p>
      ) : !users.length ? (
        <SearchEmptyState onClear={onClearSearch ?? (() => undefined)} />
      ) : (
        <div className={`user-search-list ${displayMode}`}>
          {users.map((user) => (
            <article className={`user-search-card ${displayMode === 'compact' ? 'compact' : ''}`} key={user.id}>
              <button
                className="user-search-identity"
                onClick={() => onOpenProfile(user)}
                aria-label={t('userSearchResults.viewSProfile', { p0: user.login })}
              >
                <span className="user-search-avatar">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt={t('userSearchResults.sAvatar', { p0: user.login })} />
                  ) : (
                    user.login.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span>
                  <strong>{user.login}</strong>
                  <small>{t('userSearchResults.githubUser')}</small>
                </span>
              </button>
              <button className="button button-quiet user-search-profile" onClick={() => onOpenProfile(user)}>
                {t('userSearchResults.viewProfile')} <ArrowRight size={15} />
              </button>
              {displayMode === 'detailed' && (
                <div className="user-search-projects">
                  <strong>{t('userSearchResults.top3PublicProjectsByStars')}</strong>
                  {topRepos[user.login] === undefined ? (
                    <span className="user-search-project-loading">
                      <Clock3 size={14} />
                      {t('userSearchResults.loadingProjects')}
                    </span>
                  ) : topRepos[user.login]?.length ? (
                    topRepos[user.login]?.map((repo) => (
                      <button key={repo.id} className="user-search-project" onClick={() => onOpenRepository(repo)}>
                        <Folder size={15} />
                        <span>{repo.name}</span>
                        <Star size={14} />
                        <small>{(repo.stargazers_count ?? 0).toLocaleString()}</small>
                        <ArrowRight size={14} />
                      </button>
                    ))
                  ) : (
                    <span className="user-search-project-loading">
                      {t('userSearchResults.noPublicProjectsToShowOrProjectsAreTemporarily')}
                    </span>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <SearchPagination
        page={page}
        totalCount={totalCount}
        hasNextPage={hasNextPage}
        busy={busy}
        onPageChange={onPageChange}
      />
    </>
  );
}
