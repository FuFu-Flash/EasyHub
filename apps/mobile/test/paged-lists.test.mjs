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

test('returning to a list revalidates every opened page without truncating visible rows', async () => {
  const calls = [];
  const last = deferred();
  let revisiting = false;
  const list = createPagedList(async (page) => {
    calls.push(page);
    if (revisiting && page === 2) return last.promise;
    return { items: [{ id: page, title: `${revisiting ? 'new' : 'old'} ${page}` }], nextPage: page + 1 };
  }, (item) => item.id);
  await list.refresh(); await list.more(); list.cancel(); revisiting = true;
  const task = list.revalidate(); await Promise.resolve();
  assert.deepEqual(calls, [1, 2, 1, 2]);
  assert.deepEqual(list.snapshot().items.map((item) => item.title), ['old 1', 'old 2']);
  assert.equal(list.snapshot().busy, true);
  last.resolve({ items: [{ id: 2, title: 'new 2' }], nextPage: 3 }); await task;
  assert.deepEqual(list.snapshot().items.map((item) => item.title), ['new 1', 'new 2']);
  assert.equal(list.snapshot().nextPage, 3);
});

test('failed window revalidation retains a consistent snapshot and retries the whole window', async () => {
  const calls = [];
  let revision = 'old';
  const list = createPagedList(async (page) => {
    calls.push(page);
    if (revision === 'failed' && page === 2) throw new Error('offline');
    return { items: [{ id: page, revision }], nextPage: page === 2 ? null : 2 };
  }, (item) => item.id);
  await list.refresh(); await list.more(); revision = 'failed'; await list.revalidate();
  assert.deepEqual(list.snapshot().items.map((item) => item.revision), ['old', 'old']);
  assert.equal(list.snapshot().failedPage, 2);
  revision = 'new'; await list.more();
  assert.deepEqual(calls, [1, 2, 1, 2, 1, 2]);
  assert.deepEqual(list.snapshot().items.map((item) => item.revision), ['new', 'new']);
  assert.equal(list.snapshot().failedPage, null);
});

test('a shorter refreshed result closes the old window, while explicit refresh resets it', async () => {
  const calls = [];
  let terminal = false;
  const list = createPagedList(async (page) => {
    calls.push(page);
    return { items: [page], nextPage: terminal ? null : page + 1 };
  }, (item) => item);
  await list.refresh(); await list.more(); await list.more();
  terminal = true; await list.revalidate();
  assert.deepEqual(list.snapshot().items, [1]);
  terminal = false; await list.more(); await list.refresh(); await list.revalidate();
  assert.deepEqual(calls, [1, 2, 3, 1, 1, 1]);
});

test('leaving during window revalidation rejects all partial and late pages', async () => {
  const last = deferred();
  let revisiting = false;
  const list = createPagedList(async (page) => {
    if (revisiting && page === 2) return last.promise;
    return { items: [`${revisiting ? 'new' : 'old'} ${page}`], nextPage: page + 1 };
  }, (item) => item);
  await list.refresh(); await list.more(); revisiting = true;
  const task = list.revalidate(); await Promise.resolve(); list.cancel();
  last.resolve({ items: ['late'], nextPage: null }); await task;
  assert.deepEqual(list.snapshot().items, ['old 1', 'old 2']);
  assert.equal(list.snapshot().busy, false);
});
