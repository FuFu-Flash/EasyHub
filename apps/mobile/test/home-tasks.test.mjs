import test from 'node:test';
import assert from 'node:assert/strict';
import { homeTasks } from '../features/github/homeTasks.ts';

const repo = (id, name) => ({ id, name, owner: { login: 'me' } });
const counts = (issues, pullRequests) => ({ issues, pullRequests, closedIssues: 0, closedPullRequests: 0 });

test('home tasks list issues before pull requests, larger counts first, and skip empty projects', () => {
  const repos = [repo(1, 'a'), repo(2, 'b'), repo(3, 'c'), repo(4, 'd')];
  const tasks = homeTasks(repos, { 1: counts(1, 9), 2: counts(5, 0), 3: counts(0, 0), 4: counts(1, 2) });
  assert.deepEqual(tasks.map((task) => [task.kind, task.repo.name, task.count]), [
    ['issues', 'b', 5], ['issues', 'a', 1], ['issues', 'd', 1], ['pulls', 'a', 9], ['pulls', 'd', 2],
  ]);
});

test('home tasks ignore projects whose counts have not loaded', () => {
  assert.deepEqual(homeTasks([repo(1, 'a')], {}), []);
});
