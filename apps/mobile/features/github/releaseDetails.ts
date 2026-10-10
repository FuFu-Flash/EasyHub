import type { GitHubClient } from '@easyhub/github';

/** A detail link remains valid after its release falls outside the first list page. */
export async function loadReleaseDetails(client: Pick<GitHubClient, 'release' | 'repo'>, owner: string, repo: string, id: string, signal?: AbortSignal) {
  const releaseId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error('版本地址无效。');
  const [release, repository] = await Promise.all([
    client.release(owner, repo, releaseId, signal),
    // Unknown visibility keeps translation disabled while retaining readable release details.
    client.repo(owner, repo, signal).catch(() => null),
  ]);
  return { release, repository, isPublic: repository?.private === false };
}
