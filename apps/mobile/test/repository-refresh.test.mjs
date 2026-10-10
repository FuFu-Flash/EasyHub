import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAllRepos } from '../features/github/data.ts';

test('repository refresh forwards the same native cancellation signal to every page', async () => {
  const signal = { aborted: false }; const calls = [];
  const client = { repos: async (page, received) => { calls.push([page, received]); return page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }]; } };
  const result = await loadAllRepos(client, signal);
  assert.equal(result.length, 101); assert.deepEqual(calls, [[1, signal], [2, signal]]);
});

test('a canceled repository refresh stops pagination even if transport resolves late', async () => {
  const signal = { aborted: false }; let calls = 0;
  await assert.rejects(loadAllRepos({ repos: async () => { calls++; signal.aborted = true; return Array.from({ length: 100 }, (_, id) => ({ id })); } }, signal), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(loadAllRepos({ repos: async () => { calls++; return []; } }, signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
