export type SearchScope = 'projects' | 'users';
export interface SearchEntry { query: string; scope: SearchScope }

export function parseSearchHistory(raw: string | null): SearchEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SearchEntry => typeof entry === 'object' && entry !== null
      && typeof entry.query === 'string' && entry.query.length > 0 && entry.query.length <= 200
      && (entry.scope === 'projects' || entry.scope === 'users')).slice(0, 10);
  } catch { return []; }
}

export function rememberSearch(history: SearchEntry[], query: string, scope: SearchScope): SearchEntry[] {
  const normalized = query.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (normalized.length < 2) return history;
  return [{ query: normalized, scope }, ...history.filter((entry) => entry.scope !== scope || entry.query.toLowerCase() !== normalized.toLowerCase())].slice(0, 10);
}
