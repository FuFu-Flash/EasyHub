import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleHelp, Clock3, ExternalLink, RotateCw, XCircle } from 'lucide-react';
import type { GitHubCheckRun, GitHubCheckSourcePage, GitHubCommitStatus, GitHubPullChecks } from '@easyhub/github';
import { checkRows } from './pullReviewPresentation';
import type { CheckOutcome } from './pullReviewPresentation';
import type { Language } from '../i18n';
import './pullReviewDetails.css';

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
  const [runs, setRuns] = useState<Source<GitHubCheckRun>>(emptySource);
  const [statuses, setStatuses] = useState<Source<GitHubCommitStatus>>(emptySource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const generation = useRef(0);
  const loading = useRef(false);
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const rows = checkRows(runs.items, statuses.items);
  const priority: Record<CheckOutcome, number> = { failed: 0, pending: 1, unknown: 2, neutral: 3, skipped: 4, passed: 5 };
  const sortedRows = [...rows].sort((a, b) => priority[a.outcome] - priority[b.outcome]);
  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, 5);
  const complete = runs.loaded && statuses.loaded && !runs.error && !statuses.error && runs.nextPage === null && statuses.nextPage === null && !error && !busy;
  const counts = rows.reduce((value, row) => { value[row.outcome]++; return value; }, { passed: 0, failed: 0, pending: 0, skipped: 0, neutral: 0, unknown: 0 });
  const labels: Record<CheckOutcome, string> = { passed: t('已通过', 'Passed'), failed: t('未通过', 'Failed'), pending: t('等待或运行中', 'Pending or running'), skipped: t('已跳过', 'Skipped'), neutral: t('未报告通过或失败', 'Neutral'), unknown: t('结果未知', 'Unknown') };

  async function load(checkPage: number | null, statusPage: number | null, reset = false): Promise<void> {
    if (loading.current && !reset) return;
    const request = reset ? ++generation.current : generation.current;
    loading.current = true; setBusy(true); setError('');
    if (reset) { setRuns(emptySource()); setStatuses(emptySource()); }
    try {
      const result = await window.easyHub!.github<GitHubPullChecks>('pullChecks', owner, repo, number, { headSha, checkPage, statusPage });
      if (request !== generation.current) return;
      if (result.headSha !== headSha) throw new Error('revision changed');
      if (result.checkRuns) setRuns((old) => mergeSource(old, result.checkRuns!));
      if (result.statuses) setStatuses((old) => mergeSource(old, result.statuses!));
    } catch {
      if (request === generation.current) setError(t('暂时无法确认这次修改的检查结果。请刷新检查；如果修改已更新，请返回后重新打开。', 'The checks for these changes could not be verified. Refresh the checks, or reopen the request if its changes have been updated.'));
    } finally { if (request === generation.current) { loading.current = false; setBusy(false); } }
  }

  useEffect(() => {
    setShowAll(false);
    void load(1, 1, true);
    return () => { generation.current++; loading.current = false; };
    // The lookup is pinned to the selected request revision; locale changes do not refetch it.
  }, [owner, repo, number, headSha]);

  const summary = error || runs.error || statuses.error ? t('部分检查暂时无法确认', 'Some checks could not be verified')
    : !complete ? t('检查结果尚未完整载入', 'Check results are not fully loaded')
      : rows.length === 0 ? t('当前修改没有报告检查结果', 'No checks were reported for these changes')
        : counts.failed > 0 ? t('有检查未通过', 'Some checks failed')
          : counts.pending > 0 ? t('仍有检查等待或正在运行', 'Some checks are pending or running')
            : rows.every((row) => row.outcome === 'passed') ? t('已报告的检查均已通过', 'All reported checks passed')
              : t('请查看各项检查结果', 'Review each check result');
  return <section className="pull-checks" aria-label={t('构建与测试检查', 'Build and test checks')}>
    <div className="pull-checks-heading"><div><h3>{t('构建与测试', 'Build and tests')}</h3><p className={complete && rows.length > 0 && counts.passed === rows.length ? 'pull-checks-passed' : 'pull-review-note'} role="status">{summary}</p></div><button type="button" className="button button-quiet small-button" disabled={busy} onClick={() => void load(1, 1, true)}><RotateCw size={15} className={busy ? 'live-spin' : ''} />{t('刷新检查', 'Refresh checks')}</button></div>
    {error && <p className="live-error" role="alert">{error}</p>}
    {([{ value: runs, label: t('构建与测试', 'Build and tests') }, { value: statuses, label: t('其他检查', 'Other checks') }]).filter((source) => source.value.error).map((source) => <p key={source.label} className="pull-review-note" role="alert">{source.label}：{source.value.error === 'forbidden' ? t('GitHub 暂未允许读取，可能需要访问权限或稍后重试。', 'GitHub did not allow this read. Access permission or a later retry may be needed.') : t('暂时无法读取，已有结果不代表全部结果。', 'Could not load these results. The displayed results may be incomplete.')}</p>)}
    {rows.length > 0 && <div className="pull-checks-counts">{(['passed', 'failed', 'pending', 'skipped', 'neutral', 'unknown'] as const).filter((kind) => counts[kind] > 0).map((kind) => <span className={`pull-check-state ${kind}`} key={kind}>{labels[kind]} {counts[kind]}</span>)}</div>}
    <div className="pull-checks-list">{visibleRows.map((row) => <div className="pull-check-row" key={row.key}>{row.outcome === 'passed' ? <CheckCircle2 size={17} className="pull-checks-passed" /> : row.outcome === 'failed' ? <XCircle size={17} className="pull-checks-failed" /> : row.outcome === 'pending' ? <Clock3 size={17} /> : <CircleHelp size={17} />}<div><strong data-content-original>{row.name}</strong>{row.description && <p data-content-original>{row.description}</p>}<small>{labels[row.outcome]}</small></div>{row.url && <button type="button" className="text-link" onClick={() => onOpenLink(row.url!)}><ExternalLink size={14} />{t('查看日志', 'View logs')}</button>}</div>)}</div>
    {rows.length > 5 && <button type="button" className="text-link pull-checks-expand" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? t('收起检查', 'Show fewer checks') : t(`查看全部检查（${rows.length}）`, `Show all checks (${rows.length})`)}</button>}
    {busy && <p className="pull-review-note" role="status">{t('正在获取检查结果…', 'Loading check results…')}</p>}
    {(runs.nextPage !== null || statuses.nextPage !== null) && <button type="button" className="button button-quiet small-button" disabled={busy} onClick={() => void load(runs.nextPage, statuses.nextPage)}>{runs.error || statuses.error ? t('重试未读取的检查', 'Retry unavailable checks') : t('加载更多检查', 'Load more checks')}</button>}
    <p className="pull-checks-note">{t('这里只展示当前修改已报告的结果。是否可以合入，仍由 GitHub 的项目规则判断。', 'These are the results reported for the current changes. GitHub project rules still decide whether they can be merged.')}</p>
  </section>;
}
