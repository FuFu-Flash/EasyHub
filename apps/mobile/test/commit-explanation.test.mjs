import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { commitExplanationEvidence, explainCommit } from '../features/ai/commitExplanation.ts';

const SHA = 'a'.repeat(40);
const settings = { providerId: 'openai', model: 'fixture-model', apiKey: 'private-fixture-key' };
const file = (filename = 'src/a.ts', extra = {}) => ({ filename, status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-before\n+after', ...extra });
const page = (files, nextPage = null, extra = {}) => ({ commit: { sha: SHA, commit: { message: 'Untrusted commit message' }, files }, nextPage, limited: false, ...extra });
const reply = (explanation = 'This change updates the supplied behavior.') => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ explanation }) } }] });
const input = (extra = {}) => ({ client: { commitChangesPage: async () => page([file()]) }, owner: 'writer', repo: 'app', sha: SHA, settings, language: 'en', signal: new AbortController().signal, consentToSend: true, providerBaseUrl: 'https://api.openai.com/v1', ...extra });

test('commit explanation loads the selected immutable SHA and sends only bounded message and file evidence after consent', async () => {
  const reads = []; const sends = [];
  const result = await explainCommit(input({ client: { commitChangesPage: async (...args) => { reads.push(args); return page([file()]); } }, fetcher: async (url, init) => { sends.push({ url, init }); return reply(); } }));
  assert.equal(reads[0][2], SHA); assert.equal(reads[0][3], 1);
  assert.equal(sends[0].url, 'https://api.openai.com/v1/chat/completions');
  const payload = JSON.parse(sends[0].init.body);
  assert.equal(payload.max_tokens, 3000); assert.match(payload.messages[0].content, /untrusted DATA/);
  const evidence = JSON.parse(payload.messages[1].content);
  assert.equal(evidence.sha, SHA); assert.deepEqual(evidence.files.map(item => item.path), ['src/a.ts']);
  assert.equal(JSON.stringify(evidence).includes(settings.apiKey), false);
  assert.equal(result.includedFiles, 1); assert.equal(result.partial, false);
});

test('absent consent and a changed AI destination stop before GitHub or provider requests', async () => {
  let calls = 0;
  const forbidden = { client: { commitChangesPage: async () => { calls++; throw new Error('unexpected'); } }, fetcher: async () => { calls++; throw new Error('unexpected'); } };
  await assert.rejects(explainCommit(input({ ...forbidden, consentToSend: false })), /Confirm/);
  await assert.rejects(explainCommit(input({ ...forbidden, providerBaseUrl: 'https://other.example/v1' })), /provider changed/);
  assert.equal(calls, 0);
});

test('changed SHA, invalid pagination and invalid identifiers never send content to AI', async () => {
  let sends = 0;
  const fetcher = async () => { sends++; return reply(); };
  for (const value of [page([file()], null, { commit: { sha: 'b'.repeat(40), files: [] } }), page([file()], 4)]) {
    await assert.rejects(explainCommit(input({ client: { commitChangesPage: async () => value }, fetcher })), /mismatch/);
  }
  await assert.rejects(explainCommit(input({ owner: '..', fetcher })), /Invalid commit/);
  await assert.rejects(explainCommit(input({ sha: 'main', fetcher })), /Invalid commit/);
  assert.equal(sends, 0);
});

test('bounded explanation deduplicates files, marks missing or clipped patches, and stops after 100 files', async () => {
  const calls = [];
  const evidence = await commitExplanationEvidence(input({ client: { commitChangesPage: async (_o, _r, _s, number) => {
    calls.push(number);
    return number === 1 ? page([file('binary.exe', { patch: undefined }), file('large.ts', { patch: '+'.repeat(20_000) })], 2)
      : page([file('binary.exe'), ...Array.from({ length: 110 }, (_, index) => file(`f${index}.ts`))], 3);
  } } }));
  const payload = JSON.parse(evidence.content);
  assert.equal(payload.files.filter(item => item.path === 'binary.exe').length, 1);
  assert.equal(payload.files[0].patch, undefined); assert.equal(payload.files[1].patch.length, 8000);
  assert.equal(payload.files.length <= 100, true); assert.equal(payload.files.reduce((sum, item) => sum + (item.patch?.length ?? 0), 0) <= 24_000, true);
  assert.equal(evidence.content.length <= 24_000, true);
  assert.equal(evidence.partial, true); assert.deepEqual(calls, [1, 2]);
});

test('the complete serialized evidence stays within budget when message, paths and patch need JSON escaping', async () => {
  const message = '\0\n"\\'.repeat(1000);
  const filename = `src/${'"nested/'.repeat(500)}file.ts`;
  const patch = `@@ -1 +1 @@\n-before\n+${'\0\u0001\n"\\😀'.repeat(3000)}`;
  const evidence = await commitExplanationEvidence(input({ owner: 'o'.repeat(100), repo: 'r'.repeat(100), client: {
    commitChangesPage: async () => page([file(filename, { patch })], null, { commit: { sha: SHA, commit: { message }, files: [file(filename, { patch })] } }),
  } }));
  const data = JSON.parse(evidence.content);
  assert.equal(evidence.content.length <= 24_000, true);
  assert.equal(data.repository, `${'o'.repeat(100)}/${'r'.repeat(100)}`);
  assert.equal(data.sha, SHA); assert.equal(data.message, message.slice(0, 2000));
  assert.equal(data.files[0].path, filename);
  assert.equal(data.files[0].patch.length <= 8000, true);
  assert.equal(patch.startsWith(data.files[0].patch), true);
  assert.equal(evidence.partial, true); assert.equal(data.partial, true);
});

test('message clipping is disclosed even when all file changes fit', async () => {
  const commit = { sha: SHA, commit: { message: 'm'.repeat(3000) }, files: [file()] };
  const evidence = await commitExplanationEvidence(input({ client: { commitChangesPage: async () => page([], null, { commit }) } }));
  const data = JSON.parse(evidence.content);
  assert.equal(data.message.length, 2000); assert.equal(data.files[0].patch, file().patch);
  assert.equal(data.partial, true); assert.equal(evidence.partial, true);
});

test('oversized escaped metadata is omitted as a whole and never causes truncated JSON or a paid request', async () => {
  const huge = file('unshortened.ts', { status: '\0'.repeat(5000), patch: undefined });
  const client = { commitChangesPage: async () => page([huge]) };
  const evidence = await commitExplanationEvidence(input({ client }));
  assert.equal(evidence.content.length <= 24_000, true);
  assert.deepEqual(JSON.parse(evidence.content).files, []); assert.equal(evidence.partial, true);
  let sent = false;
  await assert.rejects(explainCommit(input({ client, fetcher: async () => { sent = true; return reply(); } })), /no file changes/);
  assert.equal(sent, false);
});

test('the provider receives the same valid bounded JSON when escaped content exhausts the budget', async () => {
  const files = Array.from({ length: 100 }, (_, index) => file(`src/${'"/'.repeat(800)}${index}.ts`, { patch: `@@ -1 +1 @@\n-old\n+${'\n\0"\\'.repeat(4000)}` }));
  const result = await explainCommit(input({ client: { commitChangesPage: async () => page(files, 2) }, fetcher: async (_url, init) => {
    const content = JSON.parse(init.body).messages[1].content;
    assert.equal(content.length <= 24_000, true);
    const data = JSON.parse(content);
    assert.equal(data.files.length <= 100, true); assert.equal(data.partial, true);
    for (const file of data.files) assert.equal((file.patch?.length ?? 0) <= 8000, true);
    return reply();
  } }));
  assert.equal(result.partial, true);
});

test('a commit without file changes does not make a paid request', async () => {
  let sent = false;
  await assert.rejects(explainCommit(input({ client: { commitChangesPage: async () => page([]) }, fetcher: async () => { sent = true; return reply(); } })), /no file changes/);
  assert.equal(sent, false);
});

test('React Native cancellation during reads prevents sending and cancellation during an ignored provider abort prevents results', async () => {
  const nativeRequire = createRequire(realpathSync(new URL('../node_modules/react-native/package.json', import.meta.url)));
  const { AbortController: NativeAbortController } = nativeRequire('abort-controller/dist/abort-controller');
  const first = new NativeAbortController(); let sent = false;
  await assert.rejects(explainCommit(input({ signal: first.signal, client: { commitChangesPage: async () => { first.abort(); return page([file()]); } }, fetcher: async () => { sent = true; return reply(); } })), { name: 'AbortError' });
  assert.equal(sent, false);
  const second = new NativeAbortController();
  await assert.rejects(explainCommit(input({ signal: second.signal, fetcher: async () => { second.abort(); return reply('Do not return after blur.'); } })), { name: 'AbortError' });
});

test('incomplete, invalid, overlong, and secret-containing model responses are rejected', async () => {
  for (const response of [Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"explanation":"truncated"}' } }] }), reply(''), reply(settings.apiKey), reply('x'.repeat(16_001)), Response.json({ choices: [{ message: { content: 'not JSON' } }] })]) {
    await assert.rejects(explainCommit(input({ fetcher: async () => response })), /Invalid explanation/);
  }
});

test('DeepSeek explanations disable thinking within the short answer budget without changing provider routing', async () => {
  let payload;
  await explainCommit(input({ settings: { ...settings, providerId: 'deepseek' }, providerBaseUrl: 'https://api.deepseek.com', fetcher: async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); payload = JSON.parse(init.body); return reply();
  } }));
  assert.deepEqual(payload.thinking, { type: 'disabled' });
});
