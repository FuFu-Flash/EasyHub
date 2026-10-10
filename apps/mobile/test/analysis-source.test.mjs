import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzableFile, MAX_ANALYSIS_BYTES, parseAnalysisSource, verifiedPullDownload, verifiedReleaseDownload } from '../features/analysis/source.ts';

const headSha = 'a'.repeat(40);
const fileSha = 'b'.repeat(40);
const releaseSource = { kind: 'release', owner: 'owner', repo: 'repo', assetId: 7, name: 'program.apk' };
const asset = { id: 7, name: 'program.apk', state: 'uploaded', size: 1368, digest: `sha256:${'c'.repeat(64)}` };
const pullSource = { kind: 'pull', owner: 'owner', repo: 'repo', number: 42, headSha, fileSha, path: 'build/app.dex' };
const pull = { head: { sha: headSha, repo: { owner: { login: 'contributor' }, name: 'fork' } } };
const file = { filename: 'build/app.dex', sha: fileSha, status: 'added' };

test('program routes accept both Java bytecode and native binaries and reject ambiguous URL values', () => {
  for (const name of ['program.apk', 'classes.dex', 'library.jar', 'Main.class', 'APP.EXE', 'driver.sys', 'library.dll', 'program.elf', 'lib.so', 'lib.dylib', 'program.bin']) assert.equal(analyzableFile(name), true);
  for (const name of ['source.java', 'source.c', 'README.md', 'archive.zip', 'program.apk.exe.txt', 'program']) assert.equal(analyzableFile(name), false);
  assert.equal(parseAnalysisSource({}), null);
  assert.deepEqual(parseAnalysisSource({ source: 'release', owner: 'owner', repo: 'repo', assetId: '7', name: 'program.apk' }), releaseSource);
  assert.deepEqual(parseAnalysisSource({ source: 'pull', owner: 'owner', repo: 'repo', number: '42', headSha, fileSha, path: 'build/app.dex' }), pullSource);
  for (const changed of [{ assetId: '0' }, { assetId: '7.1' }, { assetId: '1e3' }, { assetId: '9007199254740992' }, { name: 'program.apk\0' }, { name: 'source.java' }, { owner: '../owner' }, { owner: '.' }, { owner: '..' }, { repo: '.' }, { repo: '..' }, { owner: ['owner', 'other'] }, { source: 'other' }]) {
    assert.throws(() => parseAnalysisSource({ source: 'release', owner: 'owner', repo: 'repo', assetId: '7', name: 'program.apk', ...changed }));
  }
  for (const changed of [{ headSha: 'main' }, { fileSha: 'b'.repeat(39) }, { path: 'build\0/app.dex' }, { path: ['a.dex', 'b.dex'] }, { number: '-1' }]) assert.throws(() => parseAnalysisSource({ source: 'pull', owner: 'owner', repo: 'repo', number: '42', headSha, fileSha, path: 'build/app.dex', ...changed }));
});

test('release input is bound to the selected immutable asset identity, name, size and digest', () => {
  assert.deepEqual(verifiedReleaseDownload(releaseSource, asset), { owner: 'owner', repo: 'repo', assetId: 7, name: 'program.apk', expectedSize: 1368, expectedSha256: 'c'.repeat(64) });
  const noDigest = verifiedReleaseDownload(releaseSource, { ...asset, digest: null });
  assert.equal('expectedSha256' in noDigest, false);
  assert.equal(noDigest.expectedSize, 1368);
  for (const changed of [{ id: 8 }, { name: 'replacement.apk' }, { state: 'new' }, { size: 0 }, { size: -1 }, { size: 1.5 }, { size: MAX_ANALYSIS_BYTES + 1 }, { digest: 'md5:123' }, { digest: `sha256:${'c'.repeat(63)}` }]) assert.throws(() => verifiedReleaseDownload(releaseSource, { ...asset, ...changed }));
  assert.equal(verifiedReleaseDownload(releaseSource, { ...asset, size: MAX_ANALYSIS_BYTES }).expectedSize, MAX_ANALYSIS_BYTES);
});

test('PR input downloads the exact selected blob from its fork rather than its base repository', () => {
  assert.deepEqual(verifiedPullDownload(pullSource, pull, file), { owner: 'contributor', repo: 'fork', name: 'app.dex', blobSha: fileSha, expectedBlobSha: fileSha });
  for (const changedPull of [{ head: { ...pull.head, sha: 'c'.repeat(40) } }, { head: { ...pull.head, repo: null } }]) assert.throws(() => verifiedPullDownload(pullSource, changedPull, file));
  for (const changedFile of [{ ...file, filename: 'build/other.dex' }, { ...file, sha: 'c'.repeat(40) }, { ...file, sha: undefined }, { ...file, status: 'removed' }]) assert.throws(() => verifiedPullDownload(pullSource, pull, changedFile));
});
