import test from 'node:test';
import assert from 'node:assert/strict';
import { pullReviewGroupExpanded, pullReviewGroupKey, refreshPullReviewGroups } from '../features/github/pullReviewGroups.ts';
import { createPagedList } from '../features/github/pagedList.ts';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('late counts expand every pending group without expanding handled groups', () => {
  const expansion = {};
  assert.equal(pullReviewGroupExpanded(expansion, 1, 'open', undefined), false);
  assert.equal(pullReviewGroupExpanded(expansion, 2, 'open', 0), false);
  assert.equal(pullReviewGroupExpanded(expansion, 1, 'open', 2), true);
  assert.equal(pullReviewGroupExpanded(expansion, 2, 'open', 1), true);
  assert.equal(pullReviewGroupExpanded(expansion, 1, 'closed', 4), false);
});

test('manual collapse survives late counts, refresh and switching filters', () => {
  const expansion = { [pullReviewGroupKey(1, 'open')]: false, [pullReviewGroupKey(1, 'closed')]: true };
  for (const count of [undefined, 0, 1, 27]) assert.equal(pullReviewGroupExpanded(expansion, 1, 'open', count), false);
  assert.equal(pullReviewGroupExpanded(expansion, 1, 'closed', 3), true);
  assert.equal(pullReviewGroupExpanded(expansion, 2, 'open', 1), true);
  assert.equal(pullReviewGroupExpanded(expansion, 2, 'closed', 3), false);
});

test('refresh starts groups independently and waits for slow groups even after another fails', async () => {
  const slow = deferred();
  const calls = [];
  let complete = false;
  const refresh = refreshPullReviewGroups([
    { refresh: async () => { calls.push('slow'); await slow.promise; } },
    { refresh: async () => { calls.push('failed'); throw new Error('offline'); } },
    { refresh: async () => { calls.push('ready'); } },
  ]).then(() => { complete = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls, ['slow', 'failed', 'ready']);
  assert.equal(complete, false);
  slow.resolve(); await refresh;
  assert.equal(complete, true);
});

test('one group failing does not discard another group results or retry the wrong page', async () => {
  const late = deferred();
  let fail = true;
  const first = createPagedList(async () => {
    if (fail) throw new Error('offline');
    return { items: [{ id: 1, title: 'common.reload / 用户原文' }], nextPage: null };
  }, item => item.id);
  const second = createPagedList(async () => late.promise, item => item.id);
  const refreshing = refreshPullReviewGroups([{ refresh: first.refresh }, { refresh: second.refresh }]);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(first.snapshot().failedPage, 1);
  assert.equal(second.snapshot().busy, true);
  fail = false; await first.more();
  assert.deepEqual(first.snapshot().items, [{ id: 1, title: 'common.reload / 用户原文' }]);
  late.resolve({ items: [{ id: 2, title: 'Public authored title' }], nextPage: null }); await refreshing;
  assert.deepEqual(second.snapshot().items.map(item => item.id), [2]);
  assert.equal(first.snapshot().failedPage, null);
});

test('pending and handled reading windows remain independent across cancellation and return', async () => {
  const calls = [];
  const list = state => createPagedList(async page => {
    calls.push(`${state}:${page}`);
    return { items: [{ id: `${state}:${page}` }], nextPage: page + 1 };
  }, item => item.id);
  const pending = list('open');
  const handled = list('closed');
  await pending.revalidate(); await pending.more(); pending.cancel();
  await handled.revalidate(); handled.cancel(); await pending.revalidate();
  assert.deepEqual(calls, ['open:1', 'open:2', 'closed:1', 'open:1', 'open:2']);
  assert.deepEqual(pending.snapshot().items.map(item => item.id), ['open:1', 'open:2']);
  assert.deepEqual(handled.snapshot().items.map(item => item.id), ['closed:1']);
});
