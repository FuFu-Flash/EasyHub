import type { GitHubActivityCount, GitHubRepo } from '@easyhub/github';
export function canReviewRepository(repo: GitHubRepo, login: string): boolean {
  return repo.owner.login.toLowerCase() === login.toLowerCase() || Boolean(repo.permissions?.push || repo.permissions?.admin);
}
export function sumActivity(repos: readonly Pick<GitHubRepo, 'id'>[], counts: Record<number, GitHubActivityCount>, kind: keyof GitHubActivityCount): number | null {
  return repos.every((repo) => counts[repo.id]) ? repos.reduce((total, repo) => total + (counts[repo.id]?.[kind] ?? 0), 0) : null;
}
export function unreadNotifications(activity: number, downloads = 0): number { return activity + downloads; }
export function countIssues(issues: readonly { state: string }[], state = 'open'): number { return issues.filter((issue) => issue.state === state).length; }
export function noticeGroup(id: string): 'issues' | 'pulls' | 'projects' { return id.startsWith('issues-') || id.startsWith('issue-') ? 'issues' : id.startsWith('pulls-') ? 'pulls' : 'projects'; }
