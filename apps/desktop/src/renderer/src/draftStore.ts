const STORAGE_KEY = 'easyhub:user-drafts:v1';
const MAX_ITEMS = 50;
const MAX_VALUE = 131072;
const MAX_TOTAL = 1048576;
interface Draft { key: string; value: string; updated: number }

export function createDraftKey(account: string, repository: string | number, kind: string, id: string | number = 'new'): string {
  return JSON.stringify([account.toLowerCase(), String(repository).toLowerCase(), kind, String(id)]);
}

function entries(): Draft[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_TOTAL * 2) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is Draft => typeof item === 'object' && item !== null && typeof item.key === 'string' && item.key.length <= 1000 && typeof item.value === 'string' && item.value.length <= MAX_VALUE && Number.isFinite(item.updated)).slice(0, MAX_ITEMS);
  } catch { return []; }
}

export function readDraft(key: string): string { return entries().find((item) => item.key === key)?.value ?? ''; }
export function writeDraft(key: string, value: string): boolean {
  if (key.length > 1000 || value.length > MAX_VALUE) return false;
  const drafts = entries().filter((item) => item.key !== key).sort((a, b) => b.updated - a.updated);
  if (value) drafts.unshift({ key, value, updated: Date.now() });
  drafts.splice(MAX_ITEMS);
  while (JSON.stringify(drafts).length > MAX_TOTAL && drafts.length > 1) drafts.pop();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts)); return true; } catch { return false; }
}
export function removeDraft(key: string): void { writeDraft(key, ''); }
