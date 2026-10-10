import { describe, expect, it } from 'vitest';
import type { GitHubCheckRun, GitHubCommitStatus } from '@easyhub/github';
import { checkOutcome, checkRows, parsePullPatch, reviewLink } from './pullReviewPresentation';

describe('line change preview', () => {
  it('tracks before/after line numbers across replacements and separate hunks', () => {
    const result = parsePullPatch({ patch: '@@ -2,3 +2,3 @@\n same\n-before\n+after\n same again\n@@ -20,0 +21,2 @@\n+one\n+two', additions: 3, deletions: 1 });
    expect(result.incomplete).toBe(false);
    expect(result.lines.filter((line) => line.kind === 'remove')).toEqual([{ kind: 'remove', text: 'before', before: 3, after: null }]);
    expect(result.lines.filter((line) => line.kind === 'add').map((line) => line.after)).toEqual([3, 21, 22]);
  });
  it('handles zero-line new/deleted files and the no-newline marker', () => {
    const added = parsePullPatch({ patch: '@@ -0,0 +1 @@\n+new\n\\ No newline at end of file', additions: 1, deletions: 0 });
    expect(added.incomplete).toBe(false); expect(added.lines[1]).toMatchObject({ before: null, after: 1 });
    expect(parsePullPatch({ patch: '@@ -1 +0,0 @@\n-old', additions: 0, deletions: 1 }).incomplete).toBe(false);
  });
  it('does not label missing, truncated or malformed text as a complete comparison', () => {
    expect(parsePullPatch({ additions: 2, deletions: 1 }).incomplete).toBe(true);
    expect(parsePullPatch({ patch: '@@ -1 +1 @@\n-old', additions: 1, deletions: 1 }).incomplete).toBe(true);
    expect(parsePullPatch({ patch: '@@ -1 +1 @@\n-old\n+new', additions: 10, deletions: 1 }).incomplete).toBe(true);
    expect(parsePullPatch({ patch: 'not a diff', additions: 0, deletions: 0 }).incomplete).toBe(true);
  });
  it('bounds very large previews and keeps markup as plain text', () => {
    const markup = '<img src=x onerror=alert(1)>';
    expect(parsePullPatch({ patch: `@@ -0,0 +1 @@\n+${markup}`, additions: 1, deletions: 0 }).lines[1]?.text).toBe(markup);
    const result = parsePullPatch({ patch: '@@ -0,0 +1,6000 @@\n' + '+large\n'.repeat(6000), additions: 6000, deletions: 0 });
    expect(result.limited).toBe(true); expect(result.incomplete).toBe(true); expect(result.lines.length).toBeLessThanOrEqual(5000);
  });
});

describe('check result presentation', () => {
  it('only identifies explicit completed success as passed', () => {
    expect(checkOutcome({ status: 'completed', conclusion: 'success' })).toBe('passed');
    for (const status of ['queued', 'in_progress', 'requested', 'waiting', 'pending']) expect(checkOutcome({ status, conclusion: null })).toBe('pending');
    expect(checkOutcome({ status: 'completed', conclusion: null })).toBe('unknown');
    expect(checkOutcome({ status: 'future-state', conclusion: 'success' })).toBe('unknown');
    expect(checkOutcome({ status: 'completed', conclusion: 'skipped' })).toBe('skipped');
    expect(checkOutcome({ status: 'completed', conclusion: 'neutral' })).toBe('neutral');
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'stale']) expect(checkOutcome({ status: 'completed', conclusion })).toBe('failed');
  });
  it('keeps the latest status per context even when older pages arrive later', () => {
    const status = (id: number, state: string, context = 'build'): GitHubCommitStatus => ({ id, state, context, description: null, target_url: 'https://example.com/log', created_at: '', updated_at: '' });
    const rows = checkRows([], [status(10, 'success'), status(9, 'failure'), status(11, 'pending', 'test'), status(8, 'error', 'BUILD')]);
    expect(rows).toHaveLength(2); expect(rows.find((row) => row.name === 'build')?.outcome).toBe('passed'); expect(rows.find((row) => row.name === 'test')?.outcome).toBe('pending');
  });
  it('does not conflate checks from distinct applications, and filters unsafe links', () => {
    const run = (id: number, app: number): GitHubCheckRun => ({ id, app: { id: app, name: 'builder' }, name: 'test', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'success', html_url: 'javascript:alert(1)', details_url: 'https://github.com/o/r/actions/runs/1', started_at: null, completed_at: null });
    const rows = checkRows([run(3, 1), run(2, 1), run(4, 2)], []);
    expect(rows).toHaveLength(2); expect(rows.map((row) => row.key)).toEqual(['check:3', 'check:4']); expect(rows[0]?.url).toBe('https://github.com/o/r/actions/runs/1');
    for (const link of ['javascript:alert(1)', 'file:///C:/secret', 'https://user:pass@example.com/', 'not a link']) expect(reviewLink(link)).toBeNull();
  });
});
