import type { GitHubActivityCount, GitHubRepo } from '@easyhub/github';

export type HomeTaskKind = 'issues' | 'pulls';

export interface HomeTask {
  kind: HomeTaskKind;
  repo: GitHubRepo;
  count: number;
}

const order: Record<HomeTaskKind, number> = { issues: 0, pulls: 1 };

/** Lists what needs the user's attention, using the same per-project counts as the notifications and the Issues tab. */
export function homeTasks(repos: readonly GitHubRepo[], activityCounts: Record<number, GitHubActivityCount>): HomeTask[] {
  const tasks: HomeTask[] = [];
  for (const repo of repos) {
    const counts = activityCounts[repo.id];
    if (counts?.issues > 0) tasks.push({ kind: 'issues', repo, count: counts.issues });
    if (counts?.pullRequests > 0) tasks.push({ kind: 'pulls', repo, count: counts.pullRequests });
  }
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => order[a.task.kind] - order[b.task.kind] || b.task.count - a.task.count || a.index - b.index)
    .map(({ task }) => task);
}
