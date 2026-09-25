import type { GitHubRepo } from '@easyhub/github';

export function publicBookmarksKey(login: string): string { return `easyhub:public-bookmarks:${login}`; }

export function readPublicBookmarks(storage: Pick<Storage, 'getItem'>, login: string): GitHubRepo[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(publicBookmarksKey(login)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is GitHubRepo => typeof item === 'object' && item !== null
      && Number.isSafeInteger(item.id) && typeof item.name === 'string' && typeof item.full_name === 'string'
      && typeof item.default_branch === 'string' && typeof item.owner?.login === 'string'
      && item.private === false).slice(0, 50);
  } catch { return []; }
}
