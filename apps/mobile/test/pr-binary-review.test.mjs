import assert from 'node:assert/strict';
import test from 'node:test';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { reviewPullRequest } from '../features/ai/review.ts';

const nativeRequire = createRequire(realpathSync(new URL('../node_modules/react-native/package.json', import.meta.url)));
const { AbortController: NativeAbortController } = nativeRequire('abort-controller/dist/abort-controller');
const HEAD = 'a'.repeat(40);
const BLOB = 'd'.repeat(40);
const BASE = 'b'.repeat(40);
const settings = { providerId: 'openai', model: 'example-model', apiKey: 'private-test-key' };
const text = () => ({ filename: 'src/login.ts', sha: 'c'.repeat(40), status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' });
const program = (filename = 'bin/tool.exe', extra = {}) => ({ filename, sha: BLOB, status: 'added', additions: 0, deletions: 0, ...extra });
const pull = (changed_files) => ({ number: 12, title: 'Review program update', body: 'Untrusted PR text', state: 'open', changed_files,
  head: { sha: HEAD, ref: 'feature', repo: { name: 'app-fork', owner: { login: 'contributor' } } },
  base: { sha: BASE, ref: 'main', repo: { name: 'app', owner: { login: 'writer' } } } });
const evidence = () => ({ id: 'analysis-one', fileName: 'tool.exe', size: 1024, sha256: 'e'.repeat(64), format: 'pe', architecture: 'x86:LE:64', functionCount: 1,
  functions: [{ name: 'entry0', address: '0x140001000', code: 'int entry0(int *p) { return *p; }' }],
  imports: ['ExitProcess'], strings: ['untrusted executable text'], summary: 'Recovered code', limitations: ['One sampled function'] });
const reply = (value = { summary: 'Reviewed', findings: [] }) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
const payload = (init) => JSON.parse(JSON.parse(init.body).messages[1].content);
const input = (files, extra = {}) => {
  const current = pull(files.length);
  return { client: { pullRequest: async () => current, pullFilesPage: async () => files }, owner: 'writer', repo: 'app', number: 12, headSha: HEAD,
    settings, language: 'en', signal: new AbortController().signal, consentToSend: true, providerBaseUrl: 'https://api.openai.com/v1',
    binaryReviewer: { analyze: async () => evidence() }, fetcher: async () => reply(), ...extra };
};

test('mixed PR review uses the selected head/blob and maps binary findings without inventing text lines', async () => {
  const files = [text(), program(), { filename: 'logo.png', status: 'modified', additions: 0, deletions: 0 }];
  const order = [];
  const progress = [];
  const controller = new AbortController();
  const result = await reviewPullRequest(input(files, {
    signal: controller.signal, onProgress: (...entry) => progress.push(entry),
    binaryReviewer: { analyze: async (file, current, signal, phase) => {
      order.push('analysis');
      assert.equal(file.filename, 'bin/tool.exe'); assert.equal(file.sha, BLOB);
      assert.equal(current.head.sha, HEAD); assert.equal(current.base.sha, BASE);
      assert.equal(current.head.repo.owner.login, 'contributor'); assert.equal(signal, controller.signal);
      phase('Reading bounded program evidence');
      return evidence();
    } },
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      const data = payload(init);
      if (data.files) {
        order.push('text');
        assert.deepEqual(data.files.map((file) => file.filename), ['src/login.ts']);
        return reply({ summary: 'Text result', findings: [{ severity: 'high', file: 'src/login.ts', line: 2, description: 'Null input fails.', suggestion: 'Validate input.' }] });
      }
      order.push('binary');
      assert.equal(data.sha256, evidence().sha256); assert.equal(data.functions[0].address, '0x140001000');
      assert.equal(data.patch, undefined); assert.equal(data.title, undefined);
      assert.match(JSON.parse(init.body).messages[0].content, /no earlier program version/);
      return reply({ summary: 'Program result', findings: [{ severity: 'medium', address: '0x140001000', line: 999, description: 'The sampled dereference requires a non-null pointer.', suggestion: 'Check callers or guard the pointer.' }] });
    },
  }));
  assert.deepEqual(order, ['text', 'analysis', 'binary']);
  assert.equal(result.reviewedFiles, 2); assert.equal(result.binaryReviewedFiles, 1); assert.equal(result.totalFiles, 3);
  assert.equal(result.binaryAnalyses[0].file, 'bin/tool.exe'); assert.equal(result.binaryAnalyses[0].fileSha, BLOB);
  assert.equal(result.findings[0].line, 2);
  assert.equal(result.findings[1].file, 'bin/tool.exe'); assert.equal(result.findings[1].address, '0x140001000');
  assert.equal(result.findings[1].analysisId, 'analysis-one'); assert.equal(Object.hasOwn(result.findings[1], 'line'), false);
  assert.match(result.limitations.join(' '), /logo.png|1 files have no/);
  assert.match(result.limitations.join(' '), /No earlier version was compared/);
  assert.ok(progress.some((entry) => entry[2] === 'Reading bounded program evidence'));
  assert.deepEqual(progress.at(-1), [2, 2]);
});

test('APK/DEX/JAR/CLASS programs are included and Java class identifiers remain intact', async () => {
  const source = evidence();
  source.format = 'jar'; source.architecture = 'JVM'; source.functions[0].address = `com.example.${'LongPackage.'.repeat(12)}Main`;
  const visited = [];
  const result = await reviewPullRequest(input(['app.apk', 'library.jar', 'Main.class'].map((name) => program(name)), {
    binaryReviewer: { analyze: async (file) => { visited.push(file.filename); return source; } },
    fetcher: async (_url, init) => {
      const data = payload(init); assert.equal(data.files, undefined);
      assert.equal(data.functions[0].address, source.functions[0].address);
      return reply({ summary: 'Class evidence', findings: [{ severity: 'low', address: source.functions[0].address, description: 'Check the sampled method.', suggestion: 'Inspect callers.' }] });
    },
  }));
  assert.deepEqual(visited, ['app.apk', 'library.jar', 'Main.class']);
  assert.equal(result.binaryReviewedFiles, 3); assert.equal(result.reviewedFiles, 3);
  assert.equal(result.findings[0].address, source.functions[0].address);
});

test('only the empty Git blob is skipped; added binary files with zero line counts still receive analysis', async () => {
  const visited = [];
  const files = [program('empty.exe', { sha: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' }), program('real.exe'), program('removed.dll', { status: 'removed' }),
    { ...text(), filename: 'source.class' }];
  const result = await reviewPullRequest(input(files, { binaryReviewer: { analyze: async (file) => { visited.push(file.filename); return evidence(); } } }));
  assert.deepEqual(visited, ['real.exe']); assert.equal(result.binaryReviewedFiles, 1); assert.equal(result.reviewedFiles, 2);
  const emptyResult = await reviewPullRequest(input([files[0]], { fetcher: async () => { throw new Error('Must not send empty content'); } }));
  assert.equal(emptyResult.reviewedFiles, 0); assert.match(emptyResult.summary, /newly added empty file/);
});

test('absent reviewers or unverified blobs report explicit limitations without downloading or sending program evidence', async () => {
  let analyzed = 0; let sent = 0;
  const unavailable = await reviewPullRequest(input([program()], { binaryReviewer: undefined, fetcher: async () => { sent++; return reply(); } }));
  const invalid = await reviewPullRequest(input([program('unknown.dex', { sha: undefined }), program('bad.dll', { sha: 'invalid' })], {
    binaryReviewer: { analyze: async () => { analyzed++; return evidence(); } }, fetcher: async () => { sent++; return reply(); },
  }));
  for (const result of [unavailable, invalid]) {
    assert.equal(result.reviewedFiles, 0); assert.equal(result.binaryReviewedFiles, 0); assert.equal(result.binaryAnalyses, undefined);
    assert.match(result.limitations.join(' '), /not reviewed.*unavailable/);
  }
  assert.equal(analyzed, 0); assert.equal(sent, 0);
});

test('program consent and confirmed provider are checked before GitHub reads, downloads or AI requests', async () => {
  let reads = 0; let analyzed = 0; let sent = 0;
  const base = input([program()], {
    client: { pullRequest: async () => { reads++; return pull(1); }, pullFilesPage: async () => [] },
    binaryReviewer: { analyze: async () => { analyzed++; return evidence(); } }, fetcher: async () => { sent++; return reply(); },
  });
  await assert.rejects(reviewPullRequest({ ...base, consentToSend: undefined }), /Confirm/);
  await assert.rejects(reviewPullRequest({ ...base, consentToSend: false }), /Confirm/);
  await assert.rejects(reviewPullRequest({ ...base, providerBaseUrl: 'https://api.deepseek.com' }), /provider changed/);
  await assert.rejects(reviewPullRequest({ ...base, settings: { ...settings, providerId: 'deepseek' } }), /provider changed/);
  assert.deepEqual([reads, analyzed, sent], [0, 0, 0]);
});

test('only the first three programs are attempted and ordinary extraction failure preserves text findings', async () => {
  const visited = [];
  const files = [text(), ...Array.from({ length: 5 }, (_, index) => program(`program-${index}.exe`))];
  const result = await reviewPullRequest(input(files, {
    binaryReviewer: { analyze: async (file) => {
      visited.push(file.filename);
      if (file.filename === 'program-0.exe') throw new Error('/private/native/snapshot engine stack');
      return { ...evidence(), id: file.filename.replace('.', '-') };
    } },
    fetcher: async (_url, init) => payload(init).files
      ? reply({ summary: 'Text remains', findings: [{ severity: 'high', file: text().filename, description: 'Text defect.', suggestion: 'Fix the text.' }] }) : reply(),
  }));
  assert.deepEqual(visited, ['program-0.exe', 'program-1.exe', 'program-2.exe']);
  assert.equal(result.reviewedFiles, 3); assert.equal(result.binaryReviewedFiles, 2); assert.equal(result.findings[0].file, text().filename);
  assert.deepEqual(result.binaryAnalyses.map((item) => item.file), ['program-1.exe', 'program-2.exe']);
  assert.match(result.limitations.join(' '), /program-3.exe: not reviewed.*at most 3/);
  assert.match(result.limitations.join(' '), /program-4.exe: not reviewed.*at most 3/);
  assert.doesNotMatch(JSON.stringify(result), /private\/native|engine stack/);
});

test('unsupported AI function addresses retain local program evidence and completed text results', async () => {
  const result = await reviewPullRequest(input([text(), program()], {
    fetcher: async (_url, init) => payload(init).files ? reply({ summary: 'Text completed', findings: [] })
      : reply({ summary: 'Cannot accept', findings: [{ severity: 'high', address: 'invented', description: 'Unsupported claim.', suggestion: 'Guess a fix.' }] }),
  }));
  assert.equal(result.summary, 'Text completed'); assert.equal(result.reviewedFiles, 1); assert.equal(result.binaryReviewedFiles, 0);
  assert.equal(result.binaryAnalyses.length, 1); assert.equal(result.binaryAnalyses[0].fileSha, BLOB);
  assert.equal(result.findings.length, 0); assert.match(result.limitations.join(' '), /program AI review could not be completed/);
});

test('provider failure on one program keeps local evidence and continues to the next program', async () => {
  let requests = 0;
  const result = await reviewPullRequest(input([program('one.exe'), program('two.dll')], {
    fetcher: async () => { if (++requests === 1) throw new Error('/private/provider diagnostic'); return reply(); },
  }));
  assert.equal(requests, 2); assert.equal(result.binaryAnalyses.length, 2); assert.equal(result.binaryReviewedFiles, 1);
  assert.equal(result.reviewedFiles, 1); assert.doesNotMatch(JSON.stringify(result), /private\/provider/);
});

test('mutable file and analysis objects cannot change returned blob, report or finding identities', async () => {
  const selected = program(); const source = evidence();
  const result = await reviewPullRequest(input([selected], {
    binaryReviewer: { analyze: async (file) => {
      selected.filename = 'other.dll'; selected.sha = 'f'.repeat(40); file.filename = 'injected.dll'; file.sha = 'f'.repeat(40);
      return source;
    } },
    fetcher: async (_url, init) => {
      assert.equal(payload(init).functions[0].address, '0x140001000');
      source.id = 'changed'; source.functions[0].address = 'changed'; source.functions[0].code = 'changed'; source.limitations[0] = 'changed';
      return reply({ summary: 'Stable evidence', findings: [{ severity: 'low', address: '0x140001000', description: 'Evidence retained.', suggestion: 'Inspect callers.' }] });
    },
  }));
  assert.equal(result.binaryAnalyses[0].file, 'bin/tool.exe'); assert.equal(result.binaryAnalyses[0].fileSha, BLOB);
  assert.equal(result.binaryAnalyses[0].analysis.id, 'analysis-one'); assert.equal(result.binaryAnalyses[0].analysis.functions[0].address, '0x140001000');
  assert.equal(result.binaryAnalyses[0].analysis.limitations[0], 'One sampled function'); assert.equal(result.findings[0].analysisId, 'analysis-one');
});

test('files read followed by in-place head, base or file-count changes is rejected before any evidence is sent', async () => {
  for (const change of [
    (current) => { current.head.sha = 'f'.repeat(40); },
    (current) => { current.base.sha = 'f'.repeat(40); },
    (current) => { current.base.ref = 'release'; },
    (current) => { current.changed_files = 99; },
  ]) {
    const current = pull(2); let sent = 0; let analyzed = 0;
    await assert.rejects(reviewPullRequest(input([text(), program()], {
      client: { pullRequest: async () => current, pullFilesPage: async () => { change(current); return [text(), program()]; } },
      binaryReviewer: { analyze: async () => { analyzed++; return evidence(); } }, fetcher: async () => { sent++; return reply(); },
    })), /request or its target changed/);
    assert.equal(sent, 0); assert.equal(analyzed, 0);
  }
});

test('every text batch rechecks target context and prevents sending a later batch from a changed base', async () => {
  const current = pull(2); let sent = 0;
  const files = [text(), { ...text(), filename: 'src/second.ts' }].map((file) => ({ ...file, patch: '+important code\n'.repeat(1800) }));
  await assert.rejects(reviewPullRequest(input(files, {
    client: { pullRequest: async () => current, pullFilesPage: async () => files },
    fetcher: async () => { sent++; current.base.sha = 'f'.repeat(40); return reply(); },
  })), /request or its target changed/);
  assert.equal(sent, 1);
});

test('context change during extraction rejects the whole review before binary AI and without completion progress', async () => {
  const current = pull(2); let sent = 0; const progress = [];
  await assert.rejects(reviewPullRequest(input([text(), program()], {
    client: { pullRequest: async () => current, pullFilesPage: async () => [text(), program()] },
    binaryReviewer: { analyze: async () => { current.base.ref = 'release'; return evidence(); } },
    fetcher: async () => { sent++; return reply(); }, onProgress: (...entry) => progress.push(entry),
  })), /request or its target changed/);
  assert.equal(sent, 1); assert.equal(progress.some(([done, total]) => done === total), false);
});

test('the final context check rejects a head-stable base change after binary AI instead of returning mixed results', async () => {
  const current = pull(1); const progress = [];
  await assert.rejects(reviewPullRequest(input([program()], {
    client: { pullRequest: async () => current, pullFilesPage: async () => [program()] },
    fetcher: async () => { current.base.sha = 'f'.repeat(40); return reply(); }, onProgress: (...entry) => progress.push(entry),
  })), /request or its target changed/);
  assert.equal(progress.some(([done, total]) => done === total), false);
});

test('native cancellation during extraction awaits its cleanup, throws AbortError and sends no binary request or completion', async () => {
  const controller = new NativeAbortController(); const progress = []; let sent = 0; let cleaned = false; let settled = false;
  let started; const ready = new Promise((resolve) => { started = resolve; });
  let finishCleanup; const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
  const pending = reviewPullRequest(input([text(), program()], {
    signal: controller.signal, onProgress: (...entry) => progress.push(entry),
    binaryReviewer: { analyze: async (_file, _pull, signal) => {
      started();
      try { await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('native operation aborted')), { once: true })); }
      finally { await cleanup; cleaned = true; }
      return evidence();
    } }, fetcher: async () => { sent++; return reply(); },
  }));
  const rejected = assert.rejects(pending, { name: 'AbortError' }).then(() => { settled = true; });
  await ready; controller.abort(); await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false); assert.equal(cleaned, false);
  finishCleanup(); await rejected;
  assert.equal(cleaned, true); assert.equal(sent, 1); assert.equal(progress.some(([done, total]) => done === total), false);
});

test('native cancellation during the binary provider request reaches fetch and cannot return a completed PR review', async () => {
  const controller = new NativeAbortController(); const progress = [];
  let started; const ready = new Promise((resolve) => { started = resolve; });
  const pending = reviewPullRequest(input([program()], {
    signal: controller.signal, onProgress: (...entry) => progress.push(entry), fetcher: async (_url, init) => {
      started(); return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true }));
    },
  }));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await ready; controller.abort(); await rejected;
  assert.equal(progress.some(([done, total]) => done === total), false);
});

test('cancellation from a progress callback stops before text or binary content is sent', async () => {
  for (const files of [[text()], [program()]]) {
    const controller = new NativeAbortController(); let sent = 0; let analyzed = 0;
    await assert.rejects(reviewPullRequest(input(files, {
      signal: controller.signal, onProgress: () => controller.abort(),
      binaryReviewer: { analyze: async () => { analyzed++; return evidence(); } }, fetcher: async () => { sent++; return reply(); },
    })), { name: 'AbortError' });
    assert.equal(sent, 0); assert.equal(analyzed, 0);
  }
});
