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
// A repository can be linked to several local folders. Show one task for it, taking a copy that can be
// read over one that cannot, so an unreadable duplicate never hides or repeats the real work.
const localPriority: Record<HomeTaskKind, number> = {
  review: 0,
  publish: 1,
  sync: 2,
  unavailable: 3,
  issues: 4,
  pulls: 5,
};

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
  const localTasks = new Map<number, HomeTask>();
  for (const link of localLinks) {
    const repo = repos.find((item) => item.id === link.repositoryId);
    if (!repo) continue;
    const status = localStatuses[link.id],
      remote = remotePreviews[link.id];
    let task: HomeTask | undefined;
    if (status?.needsReview || remote?.state === 'review') task = { kind: 'review', repo, link };
    else if (localErrors[link.id] || remote?.state === 'blocked') task = { kind: 'unavailable', repo, link };
    else if (status?.files.length) task = { kind: 'publish', repo, link, count: status.files.length };
    else if (status && remote?.state === 'ready') task = { kind: 'sync', repo, link };
    const kept = localTasks.get(repo.id);
    if (task && (!kept || localPriority[task.kind] < localPriority[kept.kind])) localTasks.set(repo.id, task);
  }
  tasks.push(...localTasks.values());
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
