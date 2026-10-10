import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzableFile, parseAnalysisSource, verifiedReleaseDownload, verifiedPullDownload, MAX_ANALYSIS_BYTES } from '../features/analysis/source.ts';

const sha = 'a'.repeat(40);
const blob = 'b'.repeat(40);
test('program sources cover both Android bytecode and native desktop formats', () => {
  for (const name of ['app.apk', 'classes.dex', 'helper.JAR', 'Main.class', 'setup.exe', 'library.DLL', 'libapp.so', 'tool.dylib']) assert.equal(analyzableFile(name), true);
  assert.equal(analyzableFile('project.zip'), false);
  assert.equal(analyzableFile('notes.exe.txt'), false);
});
test('route parsing accepts only verified GitHub identities, never arbitrary URLs or local paths', () => {
  const source = parseAnalysisSource({ source: 'release', owner: 'dev', repo: 'app', assetId: '10', name: 'app.apk' });
  assert.equal(source.assetId, 10);
  assert.equal(parseAnalysisSource({ uri: 'file:///etc/passwd' }), null);
  assert.throws(() => parseAnalysisSource({ source: 'release', owner: '../dev', repo: 'app', assetId: '10', name: 'app.apk' }));
  assert.throws(() => parseAnalysisSource({ source: 'release', owner: 'dev', repo: 'app', assetId: '1e2', name: 'app.apk' }));
  assert.throws(() => parseAnalysisSource({ source: 'url', owner: 'dev', repo: 'app' }));
});
test('release analysis binds metadata identity, size and SHA256 digest', () => {
  const source = { kind: 'release', owner: 'dev', repo: 'app', assetId: 10, name: 'app.apk' };
  const asset = { id: 10, name: 'app.apk', state: 'uploaded', size: 200, digest: `sha256:${'c'.repeat(64)}` };
  assert.equal(verifiedReleaseDownload(source, asset).expectedSha256, 'c'.repeat(64));
  for (const changed of [{ id: 11 }, { name: 'other.apk' }, { state: 'new' }, { size: 0 }, { size: MAX_ANALYSIS_BYTES + 1 }, { digest: 'md5:bad' }]) assert.throws(() => verifiedReleaseDownload(source, { ...asset, ...changed }));
});
test('PR analysis pins inspected head and blob, then reads from the actual head fork', () => {
  const source = { kind: 'pull', owner: 'base', repo: 'app', number: 4, headSha: sha, fileSha: blob, path: 'bin/app.exe' };
  const pull = { head: { sha, repo: { owner: { login: 'fork-owner' }, name: 'fork' } } };
  const file = { filename: source.path, sha: blob, status: 'modified' };
  assert.deepEqual(verifiedPullDownload(source, pull, file), { owner: 'fork-owner', repo: 'fork', name: 'app.exe', blobSha: blob, expectedBlobSha: blob });
  assert.throws(() => verifiedPullDownload(source, { head: { ...pull.head, sha: 'c'.repeat(40) } }, file));
  assert.throws(() => verifiedPullDownload(source, pull, { ...file, sha }));
  assert.throws(() => verifiedPullDownload(source, pull, { ...file, status: 'removed' }));
});
