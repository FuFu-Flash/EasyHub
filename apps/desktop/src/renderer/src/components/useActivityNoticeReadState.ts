import { useEffect, useState } from 'react';
import { activityNoticeStorageKey, markActivityNoticesSeen, readSeenActivityNotices, unreadActivityNoticeCount,
  type ActivityNoticeIdentity, type ActivityNoticeStorage, type SeenActivityNotices } from './activityNoticeReadState';

function browserStorage(): ActivityNoticeStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

/** An omitted account keeps demo reads in memory only; each account owns its persisted and in-memory record. */
export function useActivityNoticeReadState(activity: readonly ActivityNoticeIdentity[], open: boolean, account?: string) {
  const storageKey = account === undefined ? null : activityNoticeStorageKey(account);
  const [seenByAccount, setSeenByAccount] = useState(() => new Map<string | null, SeenActivityNotices>([
    [storageKey, readSeenActivityNotices(storageKey === null ? undefined : browserStorage(), storageKey)],
  ]));
  let seen = seenByAccount.get(storageKey);
  if (seen === undefined) {
    const loaded = readSeenActivityNotices(browserStorage(), storageKey);
    seen = loaded;
    setSeenByAccount((current) => new Map(current).set(storageKey, loaded));
  }
  const unread = unreadActivityNoticeCount(activity, seen);
  const activityKey = JSON.stringify(activity.map(({ id, title }) => ({ id, title })));
  useEffect(() => {
    if (!open || !unread) return;
    const shown = JSON.parse(activityKey) as ActivityNoticeIdentity[];
    const next = markActivityNoticesSeen(seen, shown, storageKey === null ? undefined : browserStorage(), storageKey);
    setSeenByAccount((current) => new Map(current).set(storageKey, next));
  }, [open, unread, seen, activityKey, storageKey]);
  return { seen, unread };
}
