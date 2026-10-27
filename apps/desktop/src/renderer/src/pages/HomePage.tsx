import { useTranslation } from '../localization';
import type { GitHubCommit, GitHubRepo } from '@easyhub/github';
import type { LocalProjectLink } from '@easyhub/types';
import { ArrowRight, ChevronRight, CloudDownload, FolderOpen, Plus } from 'lucide-react';
import { canReviewRepository } from '../activityCounts';
import { ErrorMessage } from '../components/ErrorMessage';
import { errorText as message } from '../errors';
import { formatRelative } from '../format';
import { type HomeTask, homeTasks } from '../homeTasks';
import { projectPresentation } from '../projectPresentation';
import { findLocalLink } from '../repositoryLinks';
import { usePageFeedback } from '../workspace/pageFeedback';

import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import type { View } from '../workspace/navigation';
import { usePageActions } from '../workspace/pageActions';
import { usePageData } from '../workspace/pageData';
import { ownerOf, RepoLogo } from './shared';

export function HomePage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { setNotice, setError } = usePageFeedback();
  const {
    user,
    language,
    repos,
    localLinks,
    localStatuses,
    remotePreviews,
    localErrors,
    activityCounts,
    checkingLocal,
    loading: sharedLoading,
    api,
    easyHub,
    loadRepos,
    refreshLocalLinks,
    navigation,
  } = w;
  const { params } = usePageRoute();
  const { openProject, openLocal, openVersionFor } = usePageActions();
  const relativeDate = formatRelative;
  const ownRepos = repos.filter((repo) => !repo.fork);
  const reviewRepos = repos.filter((repo) => canReviewRepository(repo, user.login));
  const pendingIssueCount = (repo: GitHubRepo) => activityCounts[repo.id]?.issues ?? null;
  const setView = (view: View) =>
    navigation.navigate(
      view,
      ['project', 'local', 'issues', 'pulls', 'downloads', 'history', 'new-release', 'source-history'].includes(view)
        ? { repo: params.repo, localId: params.localId }
        : {},
    );
  const onCreated = async () => {
    await loadRepos(true);
    await refreshLocalLinks();
  };

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
    recentError = updates.error || (updates.data.partial ? t('homePage.updatesForSomeProjectsCouldNotBeLoaded') : '');

  const busy = sharedLoading;
  const tasks = homeTasks({
    repos,
    reviewRepos,
    localLinks,
    localStatuses,
    remotePreviews,
    localErrors,
    activityCounts,
  });
  const checking = checkingLocal || localLinks.some((link) => !localStatuses[link.id] && !localErrors[link.id]);
  async function getLatestFromHome(link: LocalProjectLink, repo: GitHubRepo) {
    try {
      const preview = await easyHub.localCheckSync(link.id);
      if (preview.state === 'review') {
        openLocal(link, repo, false, true);
        return;
      }
      if (preview.state === 'blocked') {
        setError(preview.message ?? t('homePage.cannotSafelyGetTheLatestChangesRightNow'));
        return;
      }
      if (preview.state === 'ready') await easyHub.localSync(link.id, preview.remoteRevision, []);
      w.set('refreshRevision', (n) => n + 1);
      await onCreated();
      setNotice(t('homePage.thisProjectIsUpToDate'));
    } catch (cause) {
      setError(message(cause));
    }
  }
  function taskRow(task: HomeTask, index: number) {
    const { repo, link, count = 0 } = task;
    const [title, action] = {
      publish: [t('projectStatus.unpublished', { count }), t('homePage.reviewAndPublish')],
      review: [t('localWorkspace.contentNeedsYourChoice'), t('homePage.reviewContents')],
      unavailable: [t('projectStatus.unavailable'), t('homePage.openProject')],
      issues: [t('issuesPage.openIssues', { p0: count }), t('homePage.viewIssues')],
      pulls: [t('pullReviewGroups.pullRequestsAwaitingReview', { p0: count }), t('homePage.reviewPullRequests')],
      sync: [t('projectStatus.remote'), t('homePage.getLatest')],
    }[task.kind];
    const act = () => {
      if (task.kind === 'issues') setView('issues');
      else if (task.kind === 'pulls') setView('pulls');
      else if (task.kind === 'sync') void getLatestFromHome(link!, repo);
      else openLocal(link!, repo, task.kind === 'publish', remotePreviews[link!.id]?.state === 'review');
    };
    return (
      <li className="home-task-row" key={`${task.kind}:${repo.id}`}>
        <RepoLogo repo={repo} small />
        <span className="home-task-copy">
          <strong>{title}</strong>
          <small>
            {link
              ? t('homePage.taskMeta', { name: repo.name, time: relativeDate(repo.updated_at, language) })
              : repo.name}
          </small>
        </span>
        <button
          className={`button small-button ${index === 0 ? 'button-primary' : 'button-quiet'}`}
          disabled={task.kind === 'sync' && busy}
          aria-label={t('homePage.taskAction', { action, name: repo.name })}
          onClick={act}
        >
          {action}
        </button>
      </li>
    );
  }
  function projectRow(repo: GitHubRepo) {
    const link = findLocalLink(repo, localLinks);
    const state = link
      ? projectPresentation(localStatuses[link.id], remotePreviews[link.id], localErrors[link.id], language)
      : { state: 'saved', text: t('homePage.savedOnGithub') };
    return (
      <tr className="home-project-row" key={repo.id}>
        <th scope="row">
          <button className="home-project-name" onClick={() => void openProject(repo)}>
            <RepoLogo repo={repo} small />
            <strong>{repo.name}</strong>
          </button>
        </th>
        <td>
          <span className={`home-row-status ${state.state}`}>{state.text}</span>
        </td>
        <td className="home-project-updated">{relativeDate(repo.updated_at, language)}</td>
        <td className="home-project-issues">{pendingIssueCount(repo) ?? '…'}</td>
      </tr>
    );
  }

  return (
    <>
      <div className="home-dashboard">
        <div className="home-main">
          <h1 className="home-heading">{t('homePage.title')}</h1>
          <section className="home-section" aria-labelledby="home-tasks-heading">
            <div className="home-section-heading">
              <h2 id="home-tasks-heading">{t('homePage.needsYourAttention')}</h2>
              {tasks.length > 0 && <span className="home-section-count">{tasks.length}</span>}
            </div>
            {tasks.length > 0 && <ul className="home-task-list">{tasks.map(taskRow)}</ul>}
            {checking && <p className="home-task-note">{t('homePage.checkingLocalProjects')}</p>}
            {!tasks.length && !checking && <p className="home-task-note">{t('homePage.nothingNeedsYourAttention')}</p>}
          </section>
          <section className="home-section" aria-labelledby="home-projects-heading">
            <div className="home-section-heading">
              <h2 id="home-projects-heading">{t('homePage.myProjects')}</h2>
              <span className="home-section-actions">
                <button className="text-link" onClick={() => setView('projects')}>
                  {t('homePage.viewAllProjects', { count: ownRepos.length })} <ChevronRight size={15} />
                </button>
                <button className="button button-quiet small-button" onClick={() => setView('new-project')}>
                  <Plus size={15} />
                  {t('homePage.newProject')}
                </button>
              </span>
            </div>
            {ownRepos.length > 0 ? (
              <table className="home-project-table">
                <thead>
                  <tr>
                    <th scope="col">{t('homePage.projectName')}</th>
                    <th scope="col">{t('homePage.projectStatus')}</th>
                    <th scope="col">{t('homePage.projectUpdated')}</th>
                    <th scope="col" className="home-project-issues">
                      {t('homePage.projectIssues')}
                    </th>
                  </tr>
                </thead>
                <tbody>{ownRepos.slice(0, 5).map(projectRow)}</tbody>
              </table>
            ) : (
              !busy && <p className="home-task-note">{t('homePage.noProjectsYetYouCanCreateOne')}</p>
            )}
          </section>
        </div>
        <aside className="home-activity" aria-labelledby="home-activity-heading">
          <div className="home-section-heading">
            <h2 id="home-activity-heading">{t('homePage.recentUpdates')}</h2>
            <button className="text-link" onClick={() => setView('recent-history')}>
              {t('homePage.viewAll')} <ChevronRight size={15} />
            </button>
          </div>
          {recentUpdates.length > 0 && (
            <ol className="home-activity-list">
              {recentUpdates.slice(0, 5).map(({ repo, commit: item }) => (
                <li key={`${repo.id}:${item.sha}`}>
                  <button className="home-recent-row" onClick={() => void openVersionFor(repo, item)}>
                    <span>
                      <strong>{repo.name}</strong>
                      <em data-content-original>{item.commit.message.split('\n')[0]}</em>
                    </span>
                    <small>
                      {relativeDate(item.commit.author?.date ?? repo.pushed_at ?? repo.updated_at, language)}
                    </small>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {recentLoading && <p className="home-task-note">{t('homePage.loadingRecentUpdates')}</p>}
          {recentError && (
            <p className="home-task-note">
              <ErrorMessage error={recentError} />
            </p>
          )}
          {!recentLoading && !recentUpdates.length && !recentError && (
            <p className="home-task-note">{t('homePage.noChangeHistoryYet')}</p>
          )}
        </aside>
      </div>
      <div className="home-shortcuts">
        <button
          onClick={() => {
            setView('projects');
          }}
        >
          <CloudDownload size={17} />
          {t('homePage.downloadFromGithub')} <ArrowRight size={15} />
        </button>
        <button
          onClick={() => {
            setView('local');
          }}
        >
          <FolderOpen size={17} />
          {t('homePage.addExistingFolder')} <ArrowRight size={15} />
        </button>
      </div>
    </>
  );
}
