import type { GitHubClient, GitHubRepo } from '@easyhub/github';
import { throwIfCancelled } from '../network/cancellation.js';

export async function loadAllRepos(client: GitHubClient, signal?: AbortSignal): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    throwIfCancelled(signal);
    const batch = await client.repos(page, signal);
    throwIfCancelled(signal);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}
