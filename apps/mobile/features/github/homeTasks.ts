import type { GitHubActivityCount, GitHubRepo } from '@easyhub/github';

export interface HomeTaskGroup {
  repo: GitHubRepo;
  issues: number;
  pulls: number;
}

export const HOME_TASK_PREVIEW = 3;

/** One entry per project with open issues or pull requests to review, busiest first; counts match the notifications and the Issues tab. */
export function homeTaskGroups(repos: readonly GitHubRepo[], activityCounts: Record<number, GitHubActivityCount>): HomeTaskGroup[] {
  const groups: HomeTaskGroup[] = [];
  for (const repo of repos) {
    const counts = activityCounts[repo.id];
    const issues = counts?.issues ?? 0, pulls = counts?.pullRequests ?? 0;
    if (issues > 0 || pulls > 0) groups.push({ repo, issues, pulls });
  }
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => (b.group.issues + b.group.pulls) - (a.group.issues + a.group.pulls) || a.index - b.index)
    .map(({ group }) => group);
}
