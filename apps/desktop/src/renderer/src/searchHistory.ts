export type SearchScope = 'local' | 'mine' | 'forks' | 'public' | 'users';
export interface SearchEntry { query: string; scope: SearchScope }

const MAX_HISTORY = 10;

export function historyKey(login: string): string { return `easyhub:search-history:${login}`; }

export function readSearchHistory(storage: Pick<Storage, 'getItem'>, login: string): SearchEntry[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(historyKey(login)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SearchEntry => typeof item === 'object' && item !== null
      && typeof item.query === 'string' && item.query.length > 0 && item.query.length <= 200
      && ['local', 'mine', 'forks', 'public', 'users'].includes(item.scope)).slice(0, MAX_HISTORY);
  } catch { return []; }
}

export function rememberSearch(history: SearchEntry[], query: string, scope: SearchScope): SearchEntry[] {
  const normalized = query.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!normalized) return history;
  return [{ query: normalized, scope }, ...history.filter((item) => item.query.toLowerCase() !== normalized.toLowerCase() || item.scope !== scope)].slice(0, MAX_HISTORY);
}
