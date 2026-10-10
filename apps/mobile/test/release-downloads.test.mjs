import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadTracker, formatBytes, formatRemainingTime, releaseSourceDownload } from '../features/github/downloadProgress.ts';
import { loadReleaseDetails } from '../features/github/releaseDetails.ts';

test('release detail loads its ID directly instead of scanning the first 30 releases', async () => {
  const calls = [];
  const release = { id: 900, tag_name: 'v1.0' };
  const client = {
    release: async (owner, repo, id) => { calls.push([owner, repo, id]); return release; },
    repo: async () => ({ private: false }),
  };
  const result = await loadReleaseDetails(client, 'owner', 'tool', '900');
  assert.equal(result.release, release);
  assert.equal(result.isPublic, true);
  assert.deepEqual(calls, [['owner', 'tool', 900]]);
});

test('private or unavailable repository metadata never enables release translation', async () => {
  const client = { release: async () => ({ id: 1 }), repo: async () => ({ private: true }) };
  assert.equal((await loadReleaseDetails(client, 'o', 'r', '1')).isPublic, false);
  client.repo = async () => { throw new Error('offline'); };
  const result = await loadReleaseDetails(client, 'o', 'r', '1');
  assert.equal(result.repository, null);
  assert.equal(result.isPublic, false);
  await assert.rejects(() => loadReleaseDetails(client, 'o', 'r', 'not-an-id'), /版本地址无效/);
  await assert.rejects(() => loadReleaseDetails(client, 'o', 'r', '1e2'), /版本地址无效/);
});

test('release source downloads use the selected tag, including escaped branch-style tags', () => {
  const zip = releaseSourceDownload('user name', 'my repo', 'release/v2', 'zip');
  assert.equal(zip.path, '/repos/user%20name/my%20repo/zipball/release%2Fv2');
  assert.equal(zip.fileName, 'my_repo-release_v2.zip');
  assert.equal(releaseSourceDownload('owner', 'tool', 'v1.0', 'tar.gz').path, '/repos/owner/tool/tarball/v1.0');
});

test('progress reports speed, completion and remaining time from byte samples', () => {
  const sample = createDownloadTracker(1000);
  const first = sample(500, 2000, 1500);
  assert.equal(first.percentage, 25);
  assert.equal(first.bytesPerSecond, 1000);
  assert.equal(first.etaSeconds, 1.5);
  assert.equal(sample(1999, 2000, 2000).percentage, 99);
  const completed = sample(2200, 2000, 2500);
  assert.equal(completed.percentage, 100);
  assert.equal(completed.etaSeconds, 0);
});

test('missing content length still reports transferred bytes and never invents an ETA', () => {
  const sample = createDownloadTracker(0);
  const result = sample(1024, -1, 1000);
  assert.equal(result.total, 0);
  assert.equal(result.percentage, null);
  assert.equal(result.etaSeconds, null);
  assert.equal(result.bytesPerSecond, 1024);
});

test('short callback intervals accumulate before speed calculation and invalid bytes stay finite', () => {
  const sample = createDownloadTracker(0);
  assert.equal(sample(100, 1000, 100).bytesPerSecond, 0);
  assert.equal(sample(400, 1000, 400).bytesPerSecond, 1000);
  assert.equal(sample(Number.NaN, Number.NaN, 401).loaded, 400);
  assert.equal(formatBytes(1024 ** 3), '1.0 GB');
  assert.equal(formatRemainingTime(61.1), '1:02');
});

test('a restarted transfer resets its rate sample rather than keeping the cancelled transfer rate', () => {
  const sample = createDownloadTracker(0);
  sample(500, 1000, 500);
  assert.equal(sample(0, 1000, 1000).bytesPerSecond, 0);
  assert.equal(sample(100, 1000, 2000).bytesPerSecond, 100);
});
