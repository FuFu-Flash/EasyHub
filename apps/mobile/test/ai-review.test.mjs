import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAiReview, reviewPullRequest, validateAiSettings } from '../features/ai/review.ts';

const SHA = 'a'.repeat(40);
const settings = { providerId: 'openai', model: 'example-model', apiKey: 'user-supplied-key' };
const pull = { number: 12, title: 'Fix login', body: 'Handle empty input', state: 'open', head: { sha: SHA }, changed_files: 1 };
const file = { filename: 'src/login.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' };

test('AI review sends only the selected revision to the configured provider and validates the result', async () => {
  const calls = [];
  const client = { pullRequest: async () => pull, pullFilesPage: async () => [file] };
  const result = await reviewPullRequest({ client, owner: 'writer', repo: 'app', number: 12, headSha: SHA, settings, language: 'zh', signal: new AbortController().signal,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '发现一处问题', findings: [{ severity: 'high', file: 'src/login.ts', line: 2, description: '空值会失败', suggestion: '先检查输入' }] }) } }] }), { status: 200 });
    } });
  assert.equal(result.headSha, SHA);
  assert.equal(result.findings[0].file, 'src/login.ts');
  assert.equal(result.reviewedFiles, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer user-supplied-key');
  assert.match(calls[0].init.body, /src\/login.ts/);
});

test('a changed revision is blocked before any content is sent', async () => {
  let sent = false;
  await assert.rejects(reviewPullRequest({ client: { pullRequest: async () => ({ ...pull, head: { sha: 'b'.repeat(40) } }), pullFilesPage: async () => [file] },
    owner: 'writer', repo: 'app', number: 12, headSha: SHA, settings, language: 'zh', signal: new AbortController().signal,
    fetcher: async () => { sent = true; throw new Error('unexpected'); } }), /新修改/);
  assert.equal(sent, false);
});

test('invalid findings and untrusted settings are rejected', () => {
  assert.throws(() => parseAiReview(JSON.stringify({ summary: 'ok', findings: [{ severity: 'high', file: 'other.ts', description: 'bad', suggestion: 'fix' }] }), [file]), /无法对应/);
  assert.throws(() => validateAiSettings({ ...settings, providerId: 'https://example.org' }), /服务商/);
  assert.throws(() => validateAiSettings({ ...settings, apiKey: 'space in key' }), /API Key/);
});

test('binary only changes return an explicit limited result without calling AI', async () => {
  const result = await reviewPullRequest({ client: { pullRequest: async () => pull, pullFilesPage: async () => [{ ...file, patch: undefined }] },
    owner: 'writer', repo: 'app', number: 12, headSha: SHA, settings, language: 'zh', signal: new AbortController().signal,
    fetcher: async () => { throw new Error('unexpected AI request'); } });
  assert.equal(result.reviewedFiles, 0);
  assert.equal(result.findings.length, 0);
  assert.match(result.summary, /没有可供 AI 审查/);
});
