import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { ArrowLeft, ArrowRight, FolderOpen, RotateCw, Star } from 'lucide-react';

export function StarredProjects({ onBack, onOpen }: { onBack: () => void; onOpen: (repo: GitHubRepo) => void }) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(nextPage: number, active = () => true): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const items = await easyHub!.github<GitHubRepo[]>('starredRepos', nextPage);
      if (!active()) return;
      setRepos((current) =>
        nextPage === 1
          ? items
          : [...current, ...items.filter((item) => !current.some((known) => known.id === item.id))],
      );
      setPage(nextPage);
      setHasMore(items.length === 100);
    } catch (cause) {
      if (active()) setError(errorText(cause, t('starredProjects.couldNotLoadStarredProjects')));
    } finally {
      if (active()) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void load(1, () => active);
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="starred-projects-page">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={17} />
        {t('starredProjects.back')}
      </button>
      <div className="page-header">
        <div>
          <h1>{t('starredProjects.starredProjects')}</h1>
          <p>{t('starredProjects.yourGithubStarredProjectsAreHereAndAvailableOn')}</p>
        </div>
        <span className="starred-page-mark">
          <Star size={23} fill="currentColor" />
        </span>
      </div>
      {error && (
        <div className="starred-projects-error" role="alert">
          <ErrorMessage error={error} />
          <button className="button button-quiet" onClick={() => void load(repos.length ? page + 1 : 1)}>
            {t('starredProjects.retry')}
          </button>
        </div>
      )}
      {repos.length > 0 && (
        <div className="starred-projects-grid">
          {repos.map((repo) => (
            <button className="starred-project-card" key={repo.id} onClick={() => onOpen(repo)}>
              <span className="starred-project-avatar">
                {repo.owner.avatar_url ? (
                  <img src={repo.owner.avatar_url} alt="" />
                ) : (
                  repo.owner.login.slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="starred-project-copy">
                <strong>{repo.name}</strong>
                <small>{repo.owner.login}</small>
                <span>{repo.description || t('starredProjects.noProjectDescriptionYet')}</span>
                <span className="starred-project-meta">
                  <span>{repo.language || t('starredProjects.languageNotSpecified')}</span>
                  <span>
                    <Star size={14} />
                    {(repo.stargazers_count ?? 0).toLocaleString()}
                  </span>
                </span>
              </span>
              <ArrowRight className="starred-project-arrow" size={18} />
            </button>
          ))}
        </div>
      )}
      {!loading && !error && repos.length === 0 && (
        <div className="starred-projects-empty">
          <span>
            <FolderOpen size={27} />
          </span>
          <h2>{t('starredProjects.noStarredProjectsYet')}</h2>
          <p>{t('starredProjects.starAPublicProjectToFindItHere')}</p>
        </div>
      )}
      {loading && (
        <p className="starred-projects-loading">
          <RotateCw size={17} className="live-spin" />
          {t('starredProjects.loadingStarredProjects')}
        </p>
      )}
      {hasMore && !loading && (
        <button className="button button-quiet starred-projects-more" onClick={() => void load(page + 1)}>
          {t('starredProjects.loadMoreProjects')}
        </button>
      )}
    </div>
  );
}
