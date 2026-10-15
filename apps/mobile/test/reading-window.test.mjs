import test from 'node:test';
import assert from 'node:assert/strict';
import { readListWindow } from '../features/workspace/readingWindow.ts';

test('a retained reader revalidates only its opened window and deduplicates moved rows', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const result = await readListWindow(async (page, received) => {
    calls.push([page, received]);
    return { items: page === 1 ? [{ id: 1, title: 'old' }, { id: 2 }] : [{ id: 1, title: 'updated' }, { id: 3 }], nextPage: page + 1 };
  }, 2, (item) => item.id, signal);
  assert.deepEqual(calls, [[1, signal], [2, signal]]);
  assert.deepEqual(result, { items: [{ id: 1, title: 'updated' }, { id: 2 }, { id: 3 }], nextPage: 3, pages: 2 });
});

test('revalidation stops early when the remote window shrinks', async () => {
  let calls = 0;
  const result = await readListWindow(async () => {
    calls++;
    return { items: [], nextPage: null };
  }, 4, (item) => item.id, new AbortController().signal);
  assert.equal(calls, 1);
  assert.deepEqual(result, { items: [], nextPage: null, pages: 1 });
});

test('window failures reject the full read instead of returning partial replacement rows', async () => {
  await assert.rejects(readListWindow(async (page) => {
    if (page === 2) throw new Error('offline');
    return { items: ['first new row'], nextPage: 2 };
  }, 2, (item) => item, new AbortController().signal), /offline/);
});

test('cancellation stops follow-up pages even if transport ignores the abort', async () => {
  let calls = 0;
  const controller = new AbortController();
  await assert.rejects(readListWindow(async () => {
    calls++; controller.abort();
    return { items: ['late'], nextPage: 2 };
  }, 3, (item) => item, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(readListWindow(async () => { calls++; return { items: [], nextPage: null }; }, 3, (item) => item, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
