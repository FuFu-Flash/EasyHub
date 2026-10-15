import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleHelp, Clock3, ExternalLink, RotateCw, XCircle } from 'lucide-react';
import type { GitHubCheckRun, GitHubCheckSourcePage, GitHubCommitStatus, GitHubPullChecks } from '@easyhub/github';
import { checkRows } from './pullReviewPresentation';
import type { CheckOutcome } from './pullReviewPresentation';
import type { Language } from '../i18n';

interface Source<T> { items: T[]; nextPage: number | null; error: 'forbidden' | 'unavailable' | null; loaded: boolean }
function emptySource<T>(): Source<T> { return { items: [], nextPage: null, error: null, loaded: false }; }
function mergeSource<T extends { id: number }>(old: Source<T>, page: GitHubCheckSourcePage<T>): Source<T> {
  if (page.state !== 'available') return { ...old, error: page.state, nextPage: page.nextPage };
  const items = new Map(old.items.map((item) => [item.id, item]));
  for (const item of page.items) items.set(item.id, item);
  return { items: [...items.values()], nextPage: page.nextPage, error: null, loaded: true };
}

export function PullChecksPanel({ owner, repo, number, headSha, language, onOpenLink }: {
  owner: string; repo: string; number: number; headSha: string; language: Language; onOpenLink: (url: string) => void;
}) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [runs, setRuns] = useState<Source<GitHubCheckRun>>(emptySource);
  const [statuses, setStatuses] = useState<Source<GitHubCommitStatus>>(emptySource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const generation = useRef(0);
  const loading = useRef(false);
  
  const rows = checkRows(runs.items, statuses.items);
  const priority: Record<CheckOutcome, number> = { failed: 0, pending: 1, unknown: 2, neutral: 3, skipped: 4, passed: 5 };
  const sortedRows = [...rows].sort((a, b) => priority[a.outcome] - priority[b.outcome]);
  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, 5);
  const complete = runs.loaded && statuses.loaded && !runs.error && !statuses.error && runs.nextPage === null && statuses.nextPage === null && !error && !busy;
  const counts = rows.reduce((value, row) => { value[row.outcome]++; return value; }, { passed: 0, failed: 0, pending: 0, skipped: 0, neutral: 0, unknown: 0 });
  const labels: Record<CheckOutcome, string> = { passed: t("pullChecksPanel.passed"), failed: t("pullChecksPanel.failed"), pending: t("pullChecksPanel.pendingOrRunning"), skipped: t("pullChecksPanel.skipped"), neutral: t("pullChecksPanel.neutral"), unknown: t("pullChecksPanel.unknown") };

  async function load(checkPage: number | null, statusPage: number | null, reset = false): Promise<void> {
    if (loading.current && !reset) return;
    const request = reset ? ++generation.current : generation.current;
    loading.current = true; setBusy(true); setError('');
    if (reset) { setRuns(emptySource()); setStatuses(emptySource()); }
    try {
      const result = await easyHub!.github<GitHubPullChecks>('pullChecks', owner, repo, number, { headSha, checkPage, statusPage });
      if (request !== generation.current) return;
      if (result.headSha !== headSha) throw new Error('revision changed');
      if (result.checkRuns) setRuns((old) => mergeSource(old, result.checkRuns!));
      if (result.statuses) setStatuses((old) => mergeSource(old, result.statuses!));
    } catch {
      if (request === generation.current) setError(t("pullChecksPanel.theChecksForTheseChangesCouldNotBeVerified"));
    } finally { if (request === generation.current) { loading.current = false; setBusy(false); } }
  }

  useEffect(() => {
    setShowAll(false);
    void load(1, 1, true);
    return () => { generation.current++; loading.current = false; };
    // The lookup is pinned to the selected request revision; locale changes do not refetch it.
  }, [owner, repo, number, headSha]);

  const summary = error || runs.error || statuses.error ? t("pullChecksPanel.someChecksCouldNotBeVerified")
    : !complete ? t("pullChecksPanel.checkResultsAreNotFullyLoaded")
      : rows.length === 0 ? t("pullChecksPanel.noChecksWereReportedForTheseChanges")
        : counts.failed > 0 ? t("pullChecksPanel.someChecksFailed")
          : counts.pending > 0 ? t("pullChecksPanel.someChecksArePendingOrRunning")
            : rows.every((row) => row.outcome === 'passed') ? t("pullChecksPanel.allReportedChecksPassed")
              : t("pullChecksPanel.reviewEachCheckResult");
  return <section className="pull-checks" aria-label={t("pullChecksPanel.buildAndTestChecks")}>
    <div className="pull-checks-heading"><div><h3>{t("pullChecksPanel.buildAndTests")}</h3><p className={complete && rows.length > 0 && counts.passed === rows.length ? 'pull-checks-passed' : 'pull-review-note'} role="status">{summary}</p></div><button type="button" className="button button-quiet small-button" disabled={busy} onClick={() => void load(1, 1, true)}><RotateCw size={15} className={busy ? 'live-spin' : ''} />{t("pullChecksPanel.refreshChecks")}</button></div>
    {error && <p className="live-error" role="alert"><ErrorMessage error={error} language={language} /></p>}
    {([{ value: runs, label: t("pullChecksPanel.buildAndTests") }, { value: statuses, label: t("pullChecksPanel.otherChecks") }]).filter((source) => source.value.error).map((source) => <p key={source.label} className="pull-review-note" role="alert">{source.label}：{source.value.error === 'forbidden' ? t("pullChecksPanel.githubDidNotAllowThisReadAccessPermissionOr") : t("pullChecksPanel.couldNotLoadTheseResultsTheDisplayedResultsMay")}</p>)}
    {rows.length > 0 && <div className="pull-checks-counts">{(['passed', 'failed', 'pending', 'skipped', 'neutral', 'unknown'] as const).filter((kind) => counts[kind] > 0).map((kind) => <span className={`pull-check-state ${kind}`} key={kind}>{labels[kind]} {counts[kind]}</span>)}</div>}
    <div className="pull-checks-list">{visibleRows.map((row) => <div className="pull-check-row" key={row.key}>{row.outcome === 'passed' ? <CheckCircle2 size={17} className="pull-checks-passed" /> : row.outcome === 'failed' ? <XCircle size={17} className="pull-checks-failed" /> : row.outcome === 'pending' ? <Clock3 size={17} /> : <CircleHelp size={17} />}<div><strong data-content-original>{row.name}</strong>{row.description && <p data-content-original>{row.description}</p>}<small>{labels[row.outcome]}</small></div>{row.url && <button type="button" className="text-link" onClick={() => onOpenLink(row.url!)}><ExternalLink size={14} />{t("pullChecksPanel.viewLogs")}</button>}</div>)}</div>
    {rows.length > 5 && <button type="button" className="text-link pull-checks-expand" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? t("pullChecksPanel.showFewerChecks") : t("pullChecksPanel.showAllChecks", { p0: rows.length })}</button>}
    {busy && <p className="pull-review-note" role="status">{t("pullChecksPanel.loadingCheckResults")}</p>}
    {(runs.nextPage !== null || statuses.nextPage !== null) && <button type="button" className="button button-quiet small-button" disabled={busy} onClick={() => void load(runs.nextPage, statuses.nextPage)}>{runs.error || statuses.error ? t("pullChecksPanel.retryUnavailableChecks") : t("pullChecksPanel.loadMoreChecks")}</button>}
    <p className="pull-checks-note">{t("pullChecksPanel.theseAreTheResultsReportedForTheCurrentChanges")}</p>
  </section>;
}
