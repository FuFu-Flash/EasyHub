import type { GitHubActivityCount, GitHubIssue, GitHubRepo } from '@easyhub/github';

export interface OpenIssueGroup { repo: GitHubRepo; issues: GitHubIssue[]; count: number }
export interface OpenIssueResult { groups: OpenIssueGroup[]; counts: Record<number, GitHubActivityCount>; failed: number }
type IssueReader = {
  issues(owner: string, repo: string, state: 'open', signal?: AbortSignal): Promise<GitHubIssue[]>;
  activityCounts(repos: { id: number; owner: string; name: string }[], signal?: AbortSignal): Promise<Record<number, GitHubActivityCount>>;
};

const cache = new WeakMap<IssueReader, { at: number; result: OpenIssueResult }>();

export function invalidateOpenIssues(client: IssueReader): void { cache.delete(client); }

export async function loadOpenIssues(
  client: IssueReader, repos: GitHubRepo[], options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<OpenIssueResult> {
  const saved = cache.get(client);
  if (!options.force && saved && Date.now() - saved.at < 60_000) return saved.result;
  const counts = await client.activityCounts(repos.map((repo) => ({ id: repo.id, owner: repo.owner.login, name: repo.name })), options.signal);
  const groups: OpenIssueGroup[] = [];
  let failed = 0;
  let index = 0;
  const withIssues = repos.filter((repo) => (counts[repo.id]?.issues ?? 0) > 0);
  await Promise.all(Array.from({ length: Math.min(4, withIssues.length) }, async () => {
    while (index < withIssues.length && !options.signal?.aborted) {
      const repo = withIssues[index++];
      try {
        const issues = await client.issues(repo.owner.login, repo.name, 'open', options.signal);
        groups.push({ repo, issues, count: counts[repo.id]!.issues });
      } catch { if (!options.signal?.aborted) failed++; }
    }
  }));
  if (options.signal?.aborted) throw new Error('Cancelled');
  groups.sort((a, b) => b.count - a.count || a.repo.name.localeCompare(b.repo.name));
  const result = { groups, counts, failed };
  if (failed === 0) cache.set(client, { at: Date.now(), result });
  return result;
}
