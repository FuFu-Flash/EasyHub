export interface ActivityNoticeIdentity { id: string; revision: string }
export type SeenActivityNotices = Record<string, string>;

export function parseSeenActivityNotices(raw: string): SeenActivityNotices {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, revision]) => id.length > 0 && typeof revision === 'string' && revision.length > 0).slice(-500));
  } catch { return {}; }
}

export function unreadActivityNoticeCount(items: ActivityNoticeIdentity[], seen: SeenActivityNotices): number {
  return items.filter((item) => seen[item.id] !== item.revision).length;
}

export function markActivityNoticesSeen(current: SeenActivityNotices, items: ActivityNoticeIdentity[]): SeenActivityNotices {
  const entries = new Map(Object.entries(current));
  for (const item of items) { entries.delete(item.id); entries.set(item.id, item.revision); }
  return Object.fromEntries([...entries].slice(-Math.max(500, items.length)));
}
