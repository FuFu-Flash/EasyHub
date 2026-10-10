import assert from 'node:assert/strict';
import test from 'node:test';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { checkDetailsUrl, checkOutcome, checkRows, emptyCheckSources, loadPullChecksPage, mergeCheckSources, summarizeChecks } from '../features/github/pullChecks.ts';

const nativeRequire = createRequire(realpathSync(new URL('../node_modules/react-native/package.json', import.meta.url)));
const { AbortController: NativeAbortController } = nativeRequire('abort-controller/dist/abort-controller');
const sha = 'a'.repeat(40);
const run = (id, overrides = {}) => ({ id, name: 'Build', head_sha: sha, status: 'completed', conclusion: 'success', app: { id: 1, name: 'CI' }, html_url: 'https://github.com/owner/repo/actions/runs/1', details_url: null, started_at: null, completed_at: null, ...overrides });
const status = (id, overrides = {}) => ({ id, context: 'Tests', state: 'success', description: 'Tests completed', target_url: null, created_at: '', updated_at: '', ...overrides });
const available = (items, nextPage = null) => ({ state: 'available', items, nextPage });
const completed = (runs = [], statuses = []) => mergeCheckSources(emptyCheckSources(), { headSha: sha, checkRuns: available(runs), statuses: available(statuses) });

test('latest status per context wins across pages, including a successful retry of an older failure', () => {
  let sources = mergeCheckSources(emptyCheckSources(), { headSha: sha, checkRuns: available([]), statuses: available([status(200)], 2) });
  assert.equal(summarizeChecks(sources).outcome, 'partial');
  sources = mergeCheckSources(sources, { headSha: sha, checkRuns: null, statuses: available([status(100, { context: 'TESTS', state: 'failure' }), status(200)]) });
  assert.equal(sources.statuses.items.length, 2);
  assert.equal(summarizeChecks(sources).rows.length, 1);
  assert.equal(summarizeChecks(sources).outcome, 'passed');
});

test('check reruns replace the same app and name, while checks from different apps remain visible', () => {
  const rows = checkRows([run(10, { conclusion: 'failure' }), run(12), run(11, { app: { id: 2, name: 'Other CI' }, conclusion: 'failure' })], []);
  assert.deepEqual(rows.map((row) => [row.key, row.outcome]), [['check:11', 'failed'], ['check:12', 'passed']]);
  assert.equal(summarizeChecks(completed([run(1, { status: 'in_progress', conclusion: null }), run(2, { name: 'Lint', conclusion: 'failure' })])).outcome, 'failed');
});

test('neutral, skipped and unknown checks cannot be reported as all passed', () => {
  for (const [statusValue, conclusion, expected] of [['queued', null, 'pending'], ['waiting', null, 'pending'], ['completed', 'cancelled', 'failed'], ['completed', 'timed_out', 'failed'], ['completed', 'neutral', 'neutral'], ['completed', 'skipped', 'skipped'], ['completed', null, 'unknown'], ['new-status', 'success', 'unknown']]) {
    assert.equal(checkOutcome({ status: statusValue, conclusion }), expected);
  }
  assert.equal(summarizeChecks(completed([run(1, { conclusion: 'neutral' })])).outcome, 'other');
  assert.equal(summarizeChecks(completed([run(1, { conclusion: 'skipped' })])).outcome, 'other');
  assert.equal(summarizeChecks(completed([run(1, { status: 'queued' })])).outcome, 'pending');
  assert.equal(summarizeChecks(completed()).outcome, 'none');
  assert.equal(summarizeChecks(completed(), true).outcome, 'partial');
});

test('independent permission failures preserve loaded rows and the exact page to retry', async () => {
  const denied = new Error('Denied'); denied.status = 403;
  const calls = [];
  const client = {
    checkRunsPage: async (...args) => { calls.push(['checks', ...args]); throw denied; },
    statusesPage: async (...args) => { calls.push(['statuses', ...args]); return { items: [status(1)], nextPage: null }; },
  };
  let sources = mergeCheckSources(emptyCheckSources(), await loadPullChecksPage(client, 'owner', 'repo', sha, 1, 1));
  assert.equal(sources.runs.error, 'forbidden');
  assert.equal(sources.runs.nextPage, 1);
  assert.equal(summarizeChecks(sources).outcome, 'partial');
  assert.equal(summarizeChecks(sources).counts.passed, 1);
  client.checkRunsPage = async (...args) => { calls.push(['checks', ...args]); return { items: [run(2)], nextPage: 2 }; };
  sources = mergeCheckSources(sources, await loadPullChecksPage(client, 'owner', 'repo', sha, sources.runs.nextPage, sources.statuses.nextPage));
  client.checkRunsPage = async () => { throw new Error('Temporary network problem'); };
  sources = mergeCheckSources(sources, await loadPullChecksPage(client, 'owner', 'repo', sha, 2, null));
  assert.equal(sources.runs.error, 'unavailable');
  assert.equal(sources.runs.items.length, 1);
  assert.equal(sources.runs.nextPage, 2);
  assert.equal(sources.statuses.items.length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'statuses').length, 1);
  client.checkRunsPage = async () => ({ items: [run(3, { name: 'Lint' })], nextPage: null });
  sources = mergeCheckSources(sources, await loadPullChecksPage(client, 'owner', 'repo', sha, 2, null));
  assert.equal(sources.runs.error, null);
  assert.equal(summarizeChecks(sources).outcome, 'passed');
});

test('100-plus checks accumulate without duplicates or premature completion', async () => {
  const client = { checkRunsPage: async (_owner, _repo, _sha, page) => ({ items: page === 1 ? Array.from({ length: 100 }, (_, id) => run(id + 1, { name: `Build ${id}` })) : [run(101, { name: 'Last check', status: 'in_progress', conclusion: null })], nextPage: page === 1 ? 2 : null }), statusesPage: async () => ({ items: [], nextPage: null }) };
  let sources = mergeCheckSources(emptyCheckSources(), await loadPullChecksPage(client, 'owner', 'repo', sha, 1, 1));
  assert.equal(summarizeChecks(sources).outcome, 'partial');
  sources = mergeCheckSources(sources, await loadPullChecksPage(client, 'owner', 'repo', sha, 2, null));
  assert.equal(summarizeChecks(sources).rows.length, 101);
  assert.equal(summarizeChecks(sources).outcome, 'pending');
});

test('Android cancellation before or during a checks read cannot return stale partial success', async () => {
  const controller = new NativeAbortController();
  let calls = 0;
  const client = { checkRunsPage: async (_owner, _repo, _sha, _page, signal) => { calls++; assert.equal(signal, controller.signal); controller.abort(); return { items: [run(1)], nextPage: null }; }, statusesPage: async () => ({ items: [], nextPage: null }) };
  await assert.rejects(loadPullChecksPage(client, 'owner', 'repo', sha, 1, 1, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(loadPullChecksPage(client, 'owner', 'repo', sha, 1, 1, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('check links allow only explicit HTTPS URLs without embedded credentials or whitespace', () => {
  assert.equal(checkDetailsUrl('https://ci.example.com/logs/1?line=2'), 'https://ci.example.com/logs/1?line=2');
  for (const value of ['javascript:alert(1)', 'file:///secret', 'http://ci.example.com', 'https://user:pass@ci.example.com', '//ci.example.com/logs', 'https://ci.example.com/\nlogs', 'https://ci.example.com/ log', '', null]) assert.equal(checkDetailsUrl(value), null);
  const row = checkRows([run(1, { html_url: 'javascript:alert(1)', details_url: 'https://ci.example.com/logs' })], [status(1, { target_url: 'intent://android-app' })]);
  assert.equal(row[0].url, 'https://ci.example.com/logs');
  assert.equal(row[1].url, null);
});

test('malformed references and pagination are rejected before any request', async () => {
  let calls = 0;
  const client = { checkRunsPage: async () => { calls++; return {}; }, statusesPage: async () => { calls++; return {}; } };
  for (const args of [['owner', 'repo', 'main', 1, 1], ['../owner', 'repo', sha, 1, 1], ['owner', '..', sha, 1, 1], ['owner', 'repo', sha, 0, 1], ['owner', 'repo', sha, 1, 10001], ['owner', 'repo', sha, null, null]]) {
    await assert.rejects(loadPullChecksPage(client, ...args), /Invalid/);
  }
  assert.equal(calls, 0);
});
