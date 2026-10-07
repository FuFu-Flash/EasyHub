export interface ActivityNoticeIdentity { id: string; title: string }
export type SeenActivityNotices = Record<string, string>;
export type ActivityNoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;

const MAX_SEEN_NOTICES = 500;

export function activityNoticeStorageKey(account: string): string { return `easyhub:seen-project-notices:${account}`; }

export function parseSeenActivityNotices(raw: string | null): SeenActivityNotices {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, title]) => id.length > 0 && typeof title === 'string' && title.length > 0).slice(-MAX_SEEN_NOTICES));
  } catch { return {}; }
}

export function readSeenActivityNotices(storage: ActivityNoticeStorage | undefined, storageKey: string | null): SeenActivityNotices {
  if (!storage || storageKey === null) return {};
  try { return parseSeenActivityNotices(storage.getItem(storageKey)); } catch { return {}; }
}

export function unreadActivityNoticeCount(activity: readonly ActivityNoticeIdentity[], seen: SeenActivityNotices): number {
  return activity.filter((item) => seen[item.id] !== item.title).length;
}

/** Records the displayed rows, retaining recent distinct entries and the full title used to detect updates. */
export function markActivityNoticesSeen(current: SeenActivityNotices, activity: readonly ActivityNoticeIdentity[],
  storage?: ActivityNoticeStorage, storageKey: string | null = null): SeenActivityNotices {
  const entries = new Map(Object.entries(current));
  for (const item of activity) {
    entries.delete(item.id);
    entries.set(item.id, item.title);
  }
  const ordered = [...entries];
  // Keep every displayed row read in this window even when the current list exceeds the storage limit.
  const next = Object.fromEntries(ordered.slice(-Math.max(MAX_SEEN_NOTICES, activity.length)));
  if (storage && storageKey !== null) {
    try { storage.setItem(storageKey, JSON.stringify(Object.fromEntries(ordered.slice(-MAX_SEEN_NOTICES)))); }
    catch { /* Reading remains available in memory when storage is unavailable. */ }
  }
  return next;
}
