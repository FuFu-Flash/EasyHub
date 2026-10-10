import { useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { markActivityNoticesSeen, parseSeenActivityNotices, unreadActivityNoticeCount, type ActivityNoticeIdentity, type SeenActivityNotices } from './activityNotices';

export function useActivityNotices(items: ActivityNoticeIdentity[], open: boolean, account: string) {
  const [state, setState] = useState<{ account: string; ready: boolean; seen: SeenActivityNotices }>({ account: '', ready: false, seen: {} });
  const itemsKey = JSON.stringify(items);
  useEffect(() => {
    let active = true;
    const file = new File(Paths.document, `easyhub-notices-${account.replace(/[^-\w]/gu, '_')}.json`);
    const restore = file.exists ? file.text() : Promise.resolve('{}');
    void restore.then((raw) => { if (active) setState({ account, ready: true, seen: parseSeenActivityNotices(raw) }); })
      .catch(() => { if (active) setState({ account, ready: true, seen: {} }); });
    return () => { active = false; };
  }, [account]);
  const ready = state.account === account && state.ready;
  const unread = ready ? unreadActivityNoticeCount(items, state.seen) : 0;
  useEffect(() => {
    if (!ready || !open || !unread) return;
    const next = markActivityNoticesSeen(state.seen, JSON.parse(itemsKey) as ActivityNoticeIdentity[]);
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setState({ account, ready: true, seen: next });
      try {
        const file = new File(Paths.document, `easyhub-notices-${account.replace(/[^-\w]/gu, '_')}.json`);
        if (!file.exists) file.create();
        file.write(JSON.stringify(next));
      } catch { /* Read state remains available in this session. */ }
    });
    return () => { active = false; };
  }, [account, itemsKey, open, ready, state.seen, unread]);
  return { unread };
}
