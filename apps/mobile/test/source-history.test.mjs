import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommitChangesReader, parseCommitPatch } from '../features/github/sourceHistory.ts';

const SHA = 'a'.repeat(40);
const file = (filename, extra = {}) => ({ filename, status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-before\n+after', ...extra });
const result = (files, nextPage = null, extra = {}) => ({ commit: { sha: SHA, commit: { message: 'Update behavior' }, files }, nextPage, limited: false, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('a commit continuation deduplicates files and preserves loaded pages during focus revalidation', async () => {
  const calls = [];
  let updated = false;
  const reader = createCommitChangesReader(SHA, async page => {
    calls.push(page);
    return page === 1 ? result([file('a.ts', { status: updated ? 'renamed' : 'modified' })], 2) : result([file('a.ts'), file('b.ts')]);
  });
  await reader.reload(); await reader.more();
  assert.deepEqual(reader.snapshot().commit.files.map(item => item.filename), ['a.ts', 'b.ts']);
  updated = true; await reader.revalidate();
  assert.deepEqual(calls, [1, 2, 1, 2]);
  assert.equal(reader.snapshot().commit.files.length, 2);
  await reader.reload();
  assert.deepEqual(reader.snapshot().commit.files.map(item => item.filename), ['a.ts']);
  assert.equal(reader.snapshot().commit.files[0].status, 'renamed');
});

test('failed focus revalidation preserves the full old window and retries the whole window', async () => {
  let fail = false;
  let changed = false;
  const calls = [];
  const reader = createCommitChangesReader(SHA, async page => {
    calls.push(page);
    if (fail && page === 2) throw new Error('offline');
    return page === 1 ? result([file(changed ? 'new.ts' : 'old.ts')], 2) : result([file('second.ts')]);
  });
  await reader.reload(); await reader.more(); fail = true; changed = true; await reader.revalidate();
  assert.equal(reader.snapshot().failedPage, 2);
  assert.deepEqual(reader.snapshot().commit.files.map(item => item.filename), ['old.ts', 'second.ts']);
  fail = false; await reader.retry();
  assert.deepEqual(calls, [1, 2, 1, 2, 1, 2]);
  assert.deepEqual(reader.snapshot().commit.files.map(item => item.filename), ['new.ts', 'second.ts']);
});

test('an explicit refresh resets the reading window even if that refresh fails', async () => {
  const calls = []; let fail = false;
  const reader = createCommitChangesReader(SHA, async page => {
    calls.push(page);
    if (fail) throw new Error('offline');
    return result([file(`${page}.ts`)], page === 1 ? 2 : null);
  });
  await reader.reload(); await reader.more(); fail = true; await reader.reload();
  assert.equal(reader.snapshot().commit.files.length, 2);
  fail = false; await reader.revalidate();
  assert.deepEqual(calls, [1, 2, 1, 1]);
  assert.deepEqual(reader.snapshot().commit.files.map(item => item.filename), ['1.ts']);
});

test('a refresh invalidates a late continuation even when abort is ignored', async () => {
  const late = deferred();
  let fresh = false;
  let oldSignal;
  const reader = createCommitChangesReader(SHA, async (page, signal) => {
    if (page === 2) { oldSignal = signal; return late.promise; }
    return result([file(fresh ? 'fresh.ts' : 'old.ts')], 2);
  });
  await reader.reload(); const old = reader.more(); await Promise.resolve(); fresh = true; await reader.reload();
  assert.equal(oldSignal.aborted, true);
  late.resolve(result([file('stale.ts')])); await old;
  assert.deepEqual(reader.snapshot().commit.files.map(item => item.filename), ['fresh.ts']);
  assert.equal(reader.snapshot().nextPage, 2);
});

test('blur drops a late first response and duplicate load-more taps share one request', async () => {
  const pending = deferred(); let calls = 0;
  const reader = createCommitChangesReader(SHA, async () => { calls++; return pending.promise; });
  const first = reader.reload(); const second = reader.more();
  await Promise.resolve();
  assert.equal(first, second); assert.equal(calls, 1);
  reader.cancel(); pending.resolve(result([file('private.ts')])); await first;
  assert.equal(reader.snapshot().commit, null);
  assert.equal(reader.snapshot().busy, false);
});

test('mismatching immutable commits and skipped or unbounded continuation pages never replace the inspected version', async () => {
  for (const invalid of [result([file('b.ts')], null, { commit: { sha: 'b'.repeat(40), files: [] } }), result([file('b.ts')], 7), result([file('b.ts')], 31)]) {
    let bad = false;
    const reader = createCommitChangesReader(SHA, async () => bad ? invalid : result([file('a.ts')]));
    await reader.reload(); bad = true; await reader.reload();
    assert.deepEqual(reader.snapshot().commit.files.map(item => item.filename), ['a.ts']);
    assert.equal(reader.snapshot().failedPage, 1);
  }
});

test('API file limit is surfaced and a completed commit never reads page 31', async () => {
  const calls = [];
  const reader = createCommitChangesReader(SHA, async page => {
    calls.push(page); return result([file(`${page}.ts`)], page < 30 ? page + 1 : null, { limited: page === 30 });
  });
  await reader.reload(); for (let i = 1; i < 32; i++) await reader.more();
  assert.equal(calls.length, 30); assert.equal(reader.snapshot().limited, true); assert.equal(reader.snapshot().nextPage, null);
});

test('unified diffs preserve old/new line numbers and flag omitted or malformed evidence', () => {
  const complete = parseCommitPatch(file('file.ts', { additions: 2, deletions: 1, patch: '@@ -10,2 +10,3 @@\n context\n-old\n+new\n+more' }));
  assert.equal(complete.incomplete, false);
  assert.deepEqual(complete.lines.map(({ kind, before, after }) => ({ kind, before, after })), [
    { kind: 'hunk', before: null, after: null }, { kind: 'context', before: 10, after: 10 },
    { kind: 'remove', before: 11, after: null }, { kind: 'add', before: null, after: 11 }, { kind: 'add', before: null, after: 12 },
  ]);
  assert.equal(parseCommitPatch(file('partial', { additions: 4 })).incomplete, true);
  assert.equal(parseCommitPatch(file('malformed', { patch: 'pretend this is a diff' })).incomplete, true);
  const huge = parseCommitPatch(file('huge', { patch: '+'.repeat(300_001) }));
  assert.equal(huge.limited, true);
});
