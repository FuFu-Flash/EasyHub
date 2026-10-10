import type { GitHubRepo } from '@easyhub/github';

export interface DiscussionScope { id: number; owner: string; repo: string; label: string; isPublic: boolean }

export function discussionScopes(repositories: GitHubRepo[]): DiscussionScope[] {
  const scopes = new Map<number, DiscussionScope>();
  for (const item of repositories) {
    const owner = item.owner?.login;
    if (!Number.isSafeInteger(item.id) || item.id < 1 || typeof owner !== 'string' || typeof item.name !== 'string' ||
      ![owner, item.name].every((part) => /^[A-Za-z0-9_.-]{1,100}$/u.test(part) && part !== '.' && part !== '..') ||
      typeof item.full_name !== 'string' || item.full_name.toLowerCase() !== `${owner}/${item.name}`.toLowerCase()) continue;
    // Unknown visibility must receive the same translation restriction as private.
    scopes.set(item.id, { id: item.id, owner, repo: item.name, label: item.full_name, isPublic: item.private === false });
  }
  return [...scopes.values()];
}

export function selectedDiscussionScope(scopes: DiscussionScope[], id: number | null): DiscussionScope | undefined {
  return scopes.find((item) => item.id === id) ?? scopes[0];
}
