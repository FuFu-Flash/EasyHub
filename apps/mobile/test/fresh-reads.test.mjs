import test from 'node:test';
import assert from 'node:assert/strict';
import { withFreshReads } from '../features/network/freshReads.ts';

test('mobile data reads bypass the native cache while retaining authentication and cancellation', async () => {
  const controller = new AbortController(); const original = { Authorization: 'Bearer local-test', Accept: 'application/vnd.github+json' }; let seen;
  const transport = withFreshReads(async (url, options) => { seen = { url, options }; return Response.json([]); });
  await transport('https://api.github.com/user/repos', { signal: controller.signal, headers: original });
  assert.equal(seen.url, 'https://api.github.com/user/repos');
  assert.equal(seen.options.cache, 'no-store'); assert.equal(seen.options.signal, controller.signal);
  assert.equal(seen.options.headers.get('cache-control'), 'no-store');
  assert.equal(seen.options.headers.get('authorization'), 'Bearer local-test');
  assert.equal(seen.options.headers.get('accept'), original.Accept);
  assert.equal(original['Cache-Control'], undefined);
});

test('GraphQL reads retain their method, body and Headers while forcing a fresh response', async () => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' }); let seen;
  const transport = withFreshReads(async (_url, options) => { seen = options; return Response.json({ data: {} }); });
  await transport('https://api.github.com/graphql', { method: 'POST', body: '{"query":"test"}', headers });
  assert.equal(seen.method, 'POST'); assert.equal(seen.body, '{"query":"test"}');
  assert.equal(seen.headers.get('content-type'), 'application/json');
  assert.equal(seen.headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('cache-control'), 'max-age=60');
});

test('Request inputs retain inherited authentication, method, body and cancellation', async () => {
  const controller = new AbortController(); let seen;
  const request = new Request('https://api.github.com/graphql', {
    method: 'POST', body: '{"query":"test"}', signal: controller.signal,
    headers: { Authorization: 'Bearer local-test', 'Content-Type': 'application/json' },
  });
  const transport = withFreshReads(async (input, options) => { seen = new Request(input, options); return Response.json({ data: {} }); });
  await transport(request);
  assert.equal(seen.headers.get('authorization'), 'Bearer local-test');
  assert.equal(seen.headers.get('content-type'), 'application/json');
  assert.equal(seen.headers.get('cache-control'), 'no-store');
  assert.equal(seen.method, 'POST'); assert.equal(await seen.text(), '{"query":"test"}');
  controller.abort(); assert.equal(seen.signal.aborted, true);
  assert.equal(request.headers.get('cache-control'), null);
});

test('explicit init headers replace Request headers while cache headers remain fresh', async () => {
  let seen;
  const request = new Request('https://api.github.com/user', { headers: { Authorization: 'Bearer old', 'X-Original': 'old' } });
  const overrides = new Headers({ Authorization: 'Bearer current' });
  const transport = withFreshReads(async (input, options) => { seen = new Request(input, options); return Response.json({}); });
  await transport(request, { headers: overrides });
  assert.equal(seen.headers.get('authorization'), 'Bearer current');
  assert.equal(seen.headers.get('x-original'), null);
  assert.equal(seen.headers.get('cache-control'), 'no-store');
  assert.equal(overrides.get('cache-control'), null);
});
