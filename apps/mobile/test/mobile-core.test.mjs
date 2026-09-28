import test from 'node:test';
import assert from 'node:assert/strict';
import { requestDeviceCode, refreshCredential, awaitDeviceAuthorization } from '../features/auth/deviceFlow.ts';
import { inlineReadmeImages, resolveReadmeLinks } from '../features/github/markdown.ts';

test('OAuth device code request uses public client ID and expected scopes', async () => {
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ device_code: 'device', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
  };
  const result = await requestDeviceCode(undefined, fake);
  assert.equal(result.user_code, 'ABCD-EFGH');
  assert.equal(calls[0].url, 'https://github.com/login/device/code');
  assert.equal(new URLSearchParams(calls[0].options.body).get('scope'), 'repo read:user');
  assert.equal(new URLSearchParams(calls[0].options.body).has('client_secret'), false);
});

test('expiring credential rotates access and refresh token', async () => {
  const fake = async () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
  const renewed = await refreshCredential({ accessToken: 'old', refreshToken: 'old-refresh' }, undefined, fake);
  assert.equal(renewed.accessToken, 'new-access');
  assert.equal(renewed.refreshToken, 'new-refresh');
  assert.ok(renewed.expiresAt > Date.now());
});

test('device authorization can be cancelled before polling', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => awaitDeviceAuthorization({ device_code: 'x', user_code: 'x', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }, controller.signal), /取消/);
});

test('README relative images resolve to repository source without changing links', () => {
  const input = '![Screen](images/screen.png) [Guide](docs/guide.md) [Docs](https://docs.example.com) [Heading](#start)';
  assert.equal(resolveReadmeLinks(input, 'alice', 'tool', 'main'), '![Screen](https://raw.githubusercontent.com/alice/tool/main/images/screen.png) [Guide](https://github.com/alice/tool/blob/main/docs/guide.md) [Docs](https://docs.example.com) [Heading](#start)');
  assert.equal(resolveReadmeLinks('![unsafe](../secret.png)', 'alice', 'tool', 'main'), '![unsafe](../secret.png)');
});

test('README images from this repository are embedded while external images are left alone', async () => {
  const source = 'https://raw.githubusercontent.com/alice/tool/main/images/logo.svg';
  const html = `<img src="${source}"><img src="https://example.com/photo.png">`;
  const calls = [];
  const result = await inlineReadmeImages(html, 'alice', 'tool', 'main', async (path) => {
    calls.push(path);
    return 'data:image/svg+xml;base64,PHN2Zz4=';
  });
  assert.deepEqual(calls, ['images/logo.svg']);
  assert.match(result, /src="data:image\/svg\+xml;base64,PHN2Zz4="/);
  assert.match(result, /src="https:\/\/example.com\/photo.png"/);
});
