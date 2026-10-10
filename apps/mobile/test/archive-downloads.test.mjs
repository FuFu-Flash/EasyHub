import test from 'node:test';
import assert from 'node:assert/strict';
import { currentProjectArchive, commitArchive, transferArchive } from '../features/github/archiveDownload.ts';

test('current project source uses its actual default branch even without any releases', () => {
  const target = currentProjectArchive({ owner: { login: 'creator' }, name: 'tool', default_branch: 'stable/mobile' });
  assert.equal(target.path, '/repos/creator/tool/zipball/stable%2Fmobile');
  assert.equal(target.fileName, 'tool-stable_mobile.zip');
  assert.throws(() => currentProjectArchive({ owner: { login: 'creator' }, name: 'tool', default_branch: '' }), /下载地址无效/);
  assert.throws(() => commitArchive('creator', 'tool', 'main'), /历史版本地址无效/);
  assert.equal(commitArchive('creator', 'tool', 'a'.repeat(40)).path, `/repos/creator/tool/zipball/${'a'.repeat(40)}`);
});

test('a transfer that resolves after cancellation cannot emit progress or become complete', async () => {
  const controller = new AbortController();
  const samples = [];
  const target = commitArchive('creator', 'tool', 'a'.repeat(40));
  const result = await transferArchive(async (path, name, progress, signal) => {
    assert.equal(path, target.path); assert.equal(name, target.fileName); assert.equal(signal, controller.signal);
    progress(100, 1000); controller.abort(); progress(1000, 1000);
  }, target, (...sample) => samples.push(sample), controller.signal);
  assert.equal(result, 'cancelled');
  assert.deepEqual(samples, [[100, 1000]]);
});

test('failed transfers retain the original failure and can be retried with a fresh signal', async () => {
  const target = commitArchive('creator', 'tool', 'a'.repeat(40));
  const cause = new Error('offline');
  await assert.rejects(() => transferArchive(async () => { throw cause; }, target, () => {}, new AbortController().signal), (error) => error === cause);
  assert.equal(await transferArchive(async () => {}, target, () => {}, new AbortController().signal), 'complete');
});
