export interface PublicBookmark { owner: string; repo: string }

const validName = /^[A-Za-z0-9_.-]{1,100}$/;

export function parsePublicBookmarks(raw: string): PublicBookmark[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((item): item is PublicBookmark => {
      if (typeof item !== 'object' || item === null || typeof item.owner !== 'string' || typeof item.repo !== 'string'
        || !validName.test(item.owner) || !validName.test(item.repo)
        || item.owner === '.' || item.owner === '..' || item.repo === '.' || item.repo === '..') return false;
      const key = `${item.owner}/${item.repo}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 50);
  } catch { return []; }
}

export function togglePublicBookmark(items: PublicBookmark[], target: PublicBookmark): PublicBookmark[] {
  const key = `${target.owner}/${target.repo}`.toLowerCase();
  const existing = items.some((item) => `${item.owner}/${item.repo}`.toLowerCase() === key);
  return existing ? items.filter((item) => `${item.owner}/${item.repo}`.toLowerCase() !== key)
    : [target, ...items].slice(0, 50);
}
