import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedPullDownload } from '../features/github/pullDownload.ts';

const pull = { head: { sha: 'a'.repeat(40), repo: { id: 1, name: 'fork', owner: { login: 'author' } } } };
const file = { filename: 'src/code.ts', sha: 'b'.repeat(40), status: 'modified' };
test('changed file download uses the inspected blob in the contributor repository', () => {
  assert.deepEqual(checkedPullDownload(file, pull, pull), { owner: 'author', repo: 'fork', sha: 'b'.repeat(40), name: 'code.ts' });
});
test('changed head, contributor repository, deleted file and invalid blob are rejected', () => {
  assert.throws(() => checkedPullDownload(file, pull, { head: { ...pull.head, sha: 'c'.repeat(40) } }));
  assert.throws(() => checkedPullDownload(file, pull, { head: { ...pull.head, repo: { ...pull.head.repo, id: 2 } } }));
  assert.throws(() => checkedPullDownload({ ...file, status: 'removed' }, pull, pull));
  assert.throws(() => checkedPullDownload({ ...file, sha: 'bad' }, pull, pull));
});
