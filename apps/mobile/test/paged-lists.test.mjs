import test from 'node:test';
import assert from 'node:assert/strict';
import { createPagedList } from '../features/github/pagedList.ts';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('failed continuation preserves prior rows and retries the same page without duplicates', async () => {
  const pages = [];
  let fail = true;
  const list = createPagedList(async (page) => {
    pages.push(page);
    if (page === 1) return { items: [{ id: 1, title: 'first' }], nextPage: 2 };
    if (fail) throw new Error('offline');
    return { items: [{ id: 1, title: 'updated' }, { id: 2 }], nextPage: null };
  }, (item) => item.id);
  await list.refresh(); await list.more();
  assert.equal(list.snapshot().failedPage, 2);
  assert.deepEqual(list.snapshot().items, [{ id: 1, title: 'first' }]);
  fail = false; await list.more();
  assert.deepEqual(pages, [1, 2, 2]);
  assert.deepEqual(list.snapshot().items, [{ id: 1, title: 'updated' }, { id: 2 }]);
  assert.equal(list.snapshot().nextPage, null);
});

test('a refresh invalidates an old continuation even when its transport ignores abort', async () => {
  const old = deferred();
  let first = true;
  const signals = [];
  const list = createPagedList(async (page, signal) => {
    signals.push(signal);
    if (page === 2) return old.promise;
    return { items: [first ? 'old' : 'new'], nextPage: 2 };
  }, (item) => item);
  await list.refresh(); const stale = list.more(); first = false; await list.refresh();
  assert.equal(signals[1].aborted, true);
  old.resolve({ items: ['stale'], nextPage: null }); await stale;
  assert.deepEqual(list.snapshot().items, ['new']);
  assert.equal(list.snapshot().nextPage, 2);
  assert.equal(list.snapshot().busy, false);
});

test('blur cancellation cannot publish late results, while a failed refresh retries page one', async () => {
  const pending = deferred();
  const list = createPagedList(() => pending.promise, (item) => item);
  const task = list.refresh(); list.cancel(); pending.resolve({ items: ['private old result'], nextPage: null }); await task;
  assert.deepEqual(list.snapshot().items, []);
  let fail = false;
  const calls = [];
  const retry = createPagedList(async (page) => {
    calls.push(page);
    if (fail) throw new Error('offline');
    return { items: ['saved'], nextPage: 2 };
  }, (item) => item);
  await retry.refresh(); fail = true; await retry.refresh();
  assert.deepEqual(retry.snapshot().items, ['saved']);
  assert.equal(retry.snapshot().failedPage, 1);
  fail = false; await retry.more();
  assert.deepEqual(calls, [1, 1, 1]);
});

test('invalid next-page metadata is retryable and never skips a page', async () => {
  const list = createPagedList(async () => ({ items: ['row'], nextPage: 8 }), (item) => item);
  await list.refresh();
  assert.equal(list.snapshot().failedPage, 1);
  assert.deepEqual(list.snapshot().items, []);
});

test('pull refresh retains visible rows and stays pending until the new first page replaces them', async () => {
  const refreshed = deferred();
  let refreshing = false;
  const list = createPagedList(async (page) => {
    if (refreshing) return refreshed.promise;
    return { items: [{ id: page, title: `old page ${page}` }], nextPage: page + 1 };
  }, (item) => item.id);
  await list.refresh(); await list.more();
  refreshing = true;
  let complete = false;
  const task = list.refresh().then(() => { complete = true; });
  await Promise.resolve();
  assert.equal(complete, false);
  assert.equal(list.snapshot().busy, true);
  assert.deepEqual(list.snapshot().items, [{ id: 1, title: 'old page 1' }, { id: 2, title: 'old page 2' }]);
  refreshed.resolve({ items: [{ id: 1, title: 'new first page' }], nextPage: 2 });
  await task;
  assert.equal(complete, true);
  assert.equal(list.snapshot().busy, false);
  assert.deepEqual(list.snapshot().items, [{ id: 1, title: 'new first page' }]);
  assert.equal(list.snapshot().nextPage, 2);
});
