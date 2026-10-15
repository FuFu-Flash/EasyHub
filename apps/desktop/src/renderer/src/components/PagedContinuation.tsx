import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { useEffect, useRef, useState } from 'react';
import type { GitHubPage } from '@easyhub/github';

/** Mounted after the first page completes; keyed by repository and discussion. */
export function PagedContinuation<T>({ action, args, firstCount, onItems, language, label, initialNextPage }: {
  action: 'commentsPage' | 'commitsPage'; args: (string | number)[]; firstCount: number;
  onItems: (items: T[], nextPage?: number | null) => void; language?: string; label?: string; initialNextPage?: number | null;
}) {
  const t = useTranslation(language === undefined ? undefined : language === 'en' ? 'en' : 'zh');
  const easyHub = useEasyHub();
  const [nextPage, setNextPage] = useState<number | null>(initialNextPage === undefined ? firstCount >= 100 ? 2 : null : initialNextPage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const loading = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function more(): Promise<void> {
    if (!nextPage || loading.current) return;
    loading.current = true; setBusy(true); setError('');
    try {
      const result = await easyHub!.github<GitHubPage<T>>(action, ...args, nextPage);
      if (!active.current) return;
      onItems(result.items, result.nextPage); setNextPage(result.nextPage);
    } catch { if (active.current) setError(t("pagedContinuation.cannotLoadMoreRightNowPleaseRetry")); }
    finally { loading.current = false; if (active.current) setBusy(false); }
  }
  if (!nextPage) return null;
  return <div className="discussion-pagination">{error && <p className="live-error" role="alert"><ErrorMessage error={error} /></p>}<button type="button" className="button button-quiet" disabled={busy} onClick={() => void more()}>{busy ? t("pagedContinuation.loading") : error ? t("pagedContinuation.retry") : label ?? (t("pagedContinuation.loadMore"))}</button></div>;
}
