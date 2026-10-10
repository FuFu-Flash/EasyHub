import { useEffect, useRef, useState } from 'react';
import type { GitHubPage } from '@easyhub/github';

/** Mounted after the first page completes; keyed by repository and discussion. */
export function PagedContinuation<T>({ action, args, firstCount, onItems, language = 'zh-CN', label }: {
  action: 'commentsPage' | 'commitsPage'; args: (string | number)[]; firstCount: number;
  onItems: (items: T[]) => void; language?: string; label?: string;
}) {
  const [nextPage, setNextPage] = useState<number | null>(firstCount >= 100 ? 2 : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const loading = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const english = language === 'en';
  async function more(): Promise<void> {
    if (!nextPage || loading.current) return;
    loading.current = true; setBusy(true); setError('');
    try {
      const result = await window.easyHub!.github<GitHubPage<T>>(action, ...args, nextPage);
      if (!active.current) return;
      onItems(result.items); setNextPage(result.nextPage);
    } catch { if (active.current) setError(english ? 'Could not load more. Please retry.' : '暂时无法加载更多，请重试。'); }
    finally { loading.current = false; if (active.current) setBusy(false); }
  }
  if (!nextPage) return null;
  return <div className="discussion-pagination">{error && <p className="live-error" role="alert">{error}</p>}<button type="button" className="button button-quiet" disabled={busy} onClick={() => void more()}>{busy ? english ? 'Loading…' : '正在加载…' : error ? english ? 'Retry' : '重试' : label ?? (english ? 'Load more' : '加载更多')}</button></div>;
}
