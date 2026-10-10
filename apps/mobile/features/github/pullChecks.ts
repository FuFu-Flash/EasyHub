import type { GitHubClient, GitHubCheckRun, GitHubCommitStatus, GitHubCheckSourcePage, GitHubPullChecks } from '@easyhub/github';
import { throwIfCancelled } from '../network/cancellation.js';

export type CheckOutcome = 'passed' | 'failed' | 'pending' | 'skipped' | 'neutral' | 'unknown';
export interface CheckRow { key: string; name: string; outcome: CheckOutcome; description: string; url: string | null }
export interface CheckSource<T> { items: T[]; nextPage: number | null; error: 'forbidden' | 'unavailable' | null; loaded: boolean }
export interface PullCheckSources { runs: CheckSource<GitHubCheckRun>; statuses: CheckSource<GitHubCommitStatus> }
export type PullChecksClient = Pick<GitHubClient, 'checkRunsPage' | 'statusesPage'>;

export function emptyCheckSources(): PullCheckSources {
  return { runs: { items: [], nextPage: 1, error: null, loaded: false }, statuses: { items: [], nextPage: 1, error: null, loaded: false } };
}
export function mergeCheckSource<T extends { id: number }>(previous: CheckSource<T>, page: GitHubCheckSourcePage<T>): CheckSource<T> {
  if (page.state !== 'available') return { ...previous, error: page.state, nextPage: page.nextPage };
  const items = new Map(previous.items.map((item) => [item.id, item]));
  for (const item of page.items) items.set(item.id, item);
  return { items: [...items.values()], nextPage: page.nextPage, error: null, loaded: true };
}
export function mergeCheckSources(previous: PullCheckSources, result: GitHubPullChecks): PullCheckSources {
  return { runs: result.checkRuns ? mergeCheckSource(previous.runs, result.checkRuns) : previous.runs,
    statuses: result.statuses ? mergeCheckSource(previous.statuses, result.statuses) : previous.statuses };
}

export async function loadPullChecksPage(client: PullChecksClient, owner: string, repo: string, headSha: string,
  checkPage: number | null, statusPage: number | null, signal?: AbortSignal): Promise<GitHubPullChecks> {
  throwIfCancelled(signal);
  const validPage = (page: number | null) => page === null || Number.isSafeInteger(page) && page >= 1 && page <= 10000;
  const validName = (name: string) => /^[A-Za-z0-9_.-]{1,100}$/u.test(name) && name !== '.' && name !== '..';
  if (!validName(owner) || !validName(repo) || !/^[a-f0-9]{40}$/iu.test(headSha) || !validPage(checkPage) || !validPage(statusPage) || checkPage === null && statusPage === null) throw new Error('Invalid checks request');
  const read = async <T>(page: number | null, operation: () => Promise<{ items: T[]; nextPage: number | null }>): Promise<GitHubCheckSourcePage<T> | null> => {
    if (page === null) return null;
    try { const result = await operation(); throwIfCancelled(signal); return { state: 'available', ...result }; }
    catch (reason) {
      throwIfCancelled(signal);
      if (reason instanceof Error && reason.name === 'AbortError') throw reason;
      const forbidden = reason instanceof Error && 'status' in reason && (reason.status === 401 || reason.status === 403);
      return { state: forbidden ? 'forbidden' : 'unavailable', items: [], nextPage: page };
    }
  };
  const [checkRuns, statuses] = await Promise.all([
    read(checkPage, () => client.checkRunsPage(owner, repo, headSha, checkPage!, signal)),
    read(statusPage, () => client.statusesPage(owner, repo, headSha, statusPage!, signal)),
  ]);
  throwIfCancelled(signal);
  return { headSha, checkRuns, statuses };
}

export function checkDetailsUrl(value: string | null | undefined): string | null {
  if (!value || /[\x00-\x20\x7f]/u.test(value)) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function checkOutcome(run: Pick<GitHubCheckRun, 'status' | 'conclusion'>): CheckOutcome {
  if (['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status)) return 'pending';
  if (run.status !== 'completed') return 'unknown';
  if (run.conclusion === 'success') return 'passed';
  if (['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'].includes(run.conclusion ?? '')) return 'failed';
  if (run.conclusion === 'skipped') return 'skipped';
  if (run.conclusion === 'neutral') return 'neutral';
  return 'unknown';
}
const text = (value: unknown, max = 512) => typeof value === 'string' ? value.slice(0, max) : '';
const priority: Record<CheckOutcome, number> = { failed: 0, pending: 1, unknown: 2, neutral: 3, skipped: 4, passed: 5 };
export function checkRows(runs: GitHubCheckRun[], statuses: GitHubCommitStatus[]): CheckRow[] {
  const currentRuns = new Map<string, GitHubCheckRun>();
  for (const run of runs) {
    const key = `${run.app?.id ?? ''}:${run.name}`;
    if (!currentRuns.has(key) || run.id > currentRuns.get(key)!.id) currentRuns.set(key, run);
  }
  const latestStatuses = new Map<string, GitHubCommitStatus>();
  for (const status of statuses) {
    const key = status.context.toLowerCase();
    if (!latestStatuses.has(key) || status.id > latestStatuses.get(key)!.id) latestStatuses.set(key, status);
  }
  return [
    ...[...currentRuns.values()].map((run): CheckRow => ({ key: `check:${run.id}`, name: text(run.name), outcome: checkOutcome(run),
      description: text(run.output?.title, 2000), url: checkDetailsUrl(run.html_url) ?? checkDetailsUrl(run.details_url) })),
    ...[...latestStatuses.values()].map((status): CheckRow => ({ key: `status:${status.id}`, name: text(status.context),
      outcome: status.state === 'success' ? 'passed' : ['failure', 'error'].includes(status.state) ? 'failed' : status.state === 'pending' ? 'pending' : 'unknown',
      description: text(status.description, 2000), url: checkDetailsUrl(status.target_url) })),
  ].sort((a, b) => priority[a.outcome] - priority[b.outcome]);
}
export function summarizeChecks(sources: PullCheckSources, busy = false) {
  const rows = checkRows(sources.runs.items, sources.statuses.items);
  const counts: Record<CheckOutcome, number> = { passed: 0, failed: 0, pending: 0, skipped: 0, neutral: 0, unknown: 0 };
  for (const row of rows) counts[row.outcome]++;
  const complete = !busy && sources.runs.loaded && sources.statuses.loaded && !sources.runs.error && !sources.statuses.error &&
    sources.runs.nextPage === null && sources.statuses.nextPage === null;
  const outcome = !complete ? 'partial' : rows.length === 0 ? 'none' : counts.failed > 0 ? 'failed' : counts.pending > 0 ? 'pending'
    : rows.every((row) => row.outcome === 'passed') ? 'passed' : 'other';
  return { rows, counts, complete, outcome };
}
