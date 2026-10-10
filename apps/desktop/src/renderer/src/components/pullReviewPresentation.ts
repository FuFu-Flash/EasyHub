import type { GitHubCheckRun, GitHubCommitStatus } from '@easyhub/github';

export type CheckOutcome = 'passed' | 'failed' | 'pending' | 'skipped' | 'neutral' | 'unknown';
export interface CheckRow { key: string; name: string; outcome: CheckOutcome; description: string; url: string | null; source: 'check' | 'status'; updatedAt: string | null }

export function reviewLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
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
export function checkRows(runs: GitHubCheckRun[], statuses: GitHubCommitStatus[]): CheckRow[] {
  // The statuses endpoint includes older updates of each context. Only its latest
  // state describes this revision; historical failures must not override a retry.
  const latest = new Map<string, GitHubCommitStatus>();
  for (const status of statuses) {
    const key = status.context.toLowerCase();
    const previous = latest.get(key);
    if (!previous || status.id > previous.id) latest.set(key, status);
  }
  const currentRuns = new Map<string, GitHubCheckRun>();
  for (const run of runs) {
    const key = `${run.app?.id ?? ''}:${run.name}`;
    const previous = currentRuns.get(key);
    if (!previous || run.id > previous.id) currentRuns.set(key, run);
  }
  return [
    ...[...currentRuns.values()].map((run): CheckRow => ({ key: `check:${run.id}`, name: run.name, outcome: checkOutcome(run), description: run.output?.title ?? '', url: reviewLink(run.html_url) ?? reviewLink(run.details_url), source: 'check', updatedAt: run.completed_at ?? run.started_at })),
    ...[...latest.values()].map((status): CheckRow => ({ key: `status:${status.id}`, name: status.context, outcome: status.state === 'success' ? 'passed' : ['failure', 'error'].includes(status.state) ? 'failed' : status.state === 'pending' ? 'pending' : 'unknown', description: status.description ?? '', url: reviewLink(status.target_url), source: 'status', updatedAt: status.updated_at ?? status.created_at })),
  ];
}

export { parsePullPatch } from '../../../shared/pullPatch';
export type { PatchLine, ParsedPatch } from '../../../shared/pullPatch';
