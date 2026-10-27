import type { GitHubActivityCount, GitHubRepo } from '@easyhub/github';
import type { LocalProjectLink, LocalProjectStatus, SyncPreview } from '@easyhub/types';

export type HomeTaskKind = 'publish' | 'review' | 'unavailable' | 'issues' | 'pulls' | 'sync';

export interface HomeTask {
  kind: HomeTaskKind;
  repo: GitHubRepo;
  link?: LocalProjectLink;
  count?: number;
}

// Work the user can act on now comes first; incoming content waits until last.
const order: Record<HomeTaskKind, number> = { publish: 0, review: 1, unavailable: 2, issues: 3, pulls: 4, sync: 5 };

/** Lists what needs the user's attention, using the same counts as the sidebar and project status. */
export function homeTasks({
  repos,
  reviewRepos,
  localLinks,
  localStatuses,
  remotePreviews,
  localErrors,
  activityCounts,
}: {
  repos: readonly GitHubRepo[];
  reviewRepos: readonly GitHubRepo[];
  localLinks: readonly LocalProjectLink[];
  localStatuses: Record<string, LocalProjectStatus>;
  remotePreviews: Record<string, SyncPreview>;
  localErrors: Record<string, boolean>;
  activityCounts: Record<number, GitHubActivityCount>;
}): HomeTask[] {
  const tasks: HomeTask[] = [];
  for (const link of localLinks) {
    const repo = repos.find((item) => item.id === link.repositoryId);
    if (!repo) continue;
    const status = localStatuses[link.id],
      remote = remotePreviews[link.id];
    if (status?.needsReview || remote?.state === 'review') tasks.push({ kind: 'review', repo, link });
    else if (localErrors[link.id] || remote?.state === 'blocked') tasks.push({ kind: 'unavailable', repo, link });
    else if (status?.files.length) tasks.push({ kind: 'publish', repo, link, count: status.files.length });
    else if (status && remote?.state === 'ready') tasks.push({ kind: 'sync', repo, link });
  }
  for (const repo of repos) {
    const count = activityCounts[repo.id]?.issues ?? 0;
    if (count > 0) tasks.push({ kind: 'issues', repo, count });
  }
  for (const repo of reviewRepos) {
    const count = activityCounts[repo.id]?.pullRequests ?? 0;
    if (count > 0) tasks.push({ kind: 'pulls', repo, count });
  }
  return tasks
    .map((task, index) => ({ task, index }))
    .sort(
      (a, b) =>
        order[a.task.kind] - order[b.task.kind] || (b.task.count ?? 0) - (a.task.count ?? 0) || a.index - b.index,
    )
    .map(({ task }) => task);
}
