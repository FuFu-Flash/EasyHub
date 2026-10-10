import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOpenIssues } from '../features/github/openIssues.ts';

const repo = (id, count) => ({ id, name: `repo-${id}`, owner: { login: 'owner' }, open_issues_count: count });
const counts = { 1: { issues: 0, closedIssues: 0, pullRequests: 3, closedPullRequests: 0 }, 2: { issues: 2, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 } };

test('open issue badges use actual issues instead of repository open count', async () => {
  const calls = [];
  const client = { issues: async (_owner, name) => {
    calls.push(name);
    return name === 'repo-2' ? [{ id: 5, title: 'Help wanted' }] : [];
  }, activityCounts: async () => counts };
  const result = await loadOpenIssues(client, [repo(1, 3), repo(2, 1), repo(3, 0)]);
  assert.deepEqual(calls, ['repo-2']);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].repo.id, 2);
  assert.equal(result.groups[0].count, 2);
  assert.equal(result.failed, 0);
  assert.equal((await loadOpenIssues(client, [repo(1, 3), repo(2, 1)])).groups.length, 1);
  assert.equal(calls.length, 1);
});

test('partial failures remain visible to the caller', async () => {
  const client = { issues: async () => { throw new Error('offline'); }, activityCounts: async () => ({ 1: { issues: 2, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 } }) };
  assert.deepEqual(await loadOpenIssues(client, [repo(1, 1)]), { groups: [], counts: { 1: { issues: 2, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 } }, failed: 1 });
});

test('open and closed issue groups use separate caches and their own counts', async () => {
  const calls = [];
  const client = { issues: async (_owner, _name, state) => { calls.push(state); return [{ id: state, state }]; },
    activityCounts: async () => ({ 1: { issues: 2, closedIssues: 4, pullRequests: 0, closedPullRequests: 0 } }) };
  const open = await loadOpenIssues(client, [repo(1, 99)]);
  const closed = await loadOpenIssues(client, [repo(1, 99)], { state: 'closed' });
  assert.equal(open.groups[0].count, 2);
  assert.equal(closed.groups[0].count, 4);
  assert.equal(closed.groups[0].issues[0].state, 'closed');
  await loadOpenIssues(client, [repo(1, 99)]);
  await loadOpenIssues(client, [repo(1, 99)], { state: 'closed' });
  assert.deepEqual(calls, ['open', 'closed']);
});
