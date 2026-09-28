import type { GitHubClient, GitHubRepo } from '@easyhub/github';

export async function loadAllRepos(client: GitHubClient): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await client.repos(page);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}
