import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_RELEASES_URL, AppUpdateError, checkAndroidAppUpdate, selectAndroidUpdate } from '../features/updates/appUpdate.ts';

function androidRelease(version, overrides = {}) {
  return { tag_name: `v${version}`, draft: false, prerelease: false,
    assets: [{ name: `EasyHub-Android-${version}-arm64.apk` }], ...overrides };
}

function errorCode(code) {
  return (error) => error instanceof AppUpdateError && error.code === code;
}

test('the independent Android release tag is detected without changing desktop tags', () => {
  const release = androidRelease('1.1.0', { tag_name: 'android-v1.1.0' });
  assert.deepEqual(selectAndroidUpdate('1.0.0', [release, androidRelease('1.0.0')]), {
    currentVersion: '1.0.0', latestVersion: '1.1.0', available: true,
    releaseUrl: 'https://github.com/FuFu-Flash/EasyHub/releases/tag/android-v1.1.0',
  });
  assert.equal(selectAndroidUpdate('1.1.0', [release]).available, false);
});

test('independent Android tags still require canonical stable versions and matching application assets', () => {
  for (const tag of ['android-v01.1.0', 'android-v1.1.0-beta.1', 'android-v1.1.0+build.1', 'android-v1.1', 'android-1.1.0']) {
    assert.throws(() => selectAndroidUpdate('1.0.0', [androidRelease('1.1.0', { tag_name: tag })]), errorCode('no-android-release'));
  }
  assert.throws(() => selectAndroidUpdate('1.0.0', [androidRelease('1.1.0', {
    tag_name: 'android-v1.1.0', assets: [{ name: 'EasyHub-Android-1.0.0-arm64.apk' }],
  })]), errorCode('no-android-release'));
});

test('Android update selection ignores newer desktop releases and framework downloads', () => {
  const data = [
    { tag_name: 'v1.2.1', draft: false, prerelease: false, assets: [{ name: 'EasyHub-1.2.1-setup.exe' }] },
    { tag_name: 'v1.2.0', draft: false, prerelease: false, assets: [{ name: 'EasyHub-1.2.0-portable.exe' }] },
    { tag_name: 'analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1', draft: false, prerelease: true,
      assets: [{ name: 'easyhub-jadx-1.5.6-android-v1.zip' }, { name: 'jadx-runtime.apk' }] },
    androidRelease('1.0.0'),
  ];
  assert.deepEqual(selectAndroidUpdate('1.1.0', data), {
    currentVersion: '1.1.0', latestVersion: '1.0.0', available: false,
    releaseUrl: 'https://github.com/FuFu-Flash/EasyHub/releases/tag/v1.0.0',
  });
});

test('versions are sorted numerically even when API order differs', () => {
  const result = selectAndroidUpdate('1.9.9', [androidRelease('1.9.10'), androidRelease('1.10.0'), androidRelease('1.2.99')]);
  assert.equal(result.latestVersion, '1.10.0');
  assert.equal(result.available, true);
  assert.equal(selectAndroidUpdate('1.10.0', [androidRelease('1.10.0')]).available, false);
  assert.equal(selectAndroidUpdate('2.0.0', [androidRelease('1.99.99')]).available, false);
});

test('stable channel excludes draft, prerelease, suffixes, and noncanonical release tags', () => {
  const data = [
    androidRelease('9.0.0', { draft: true }),
    androidRelease('8.0.0', { prerelease: true }),
    androidRelease('7.0.0', { tag_name: 'v7.0.0-beta.1' }),
    androidRelease('6.0.0', { tag_name: 'v6.0.0+build.10' }),
    androidRelease('5.0.0', { tag_name: 'release/v5.0.0' }),
    androidRelease('4.0.0', { tag_name: 'V4.0.0' }),
    androidRelease('3.0.0', { tag_name: 'v03.0.0' }),
    androidRelease('2.0.0', { draft: undefined }),
    androidRelease('1.1.0', { tag_name: '1.1.0' }),
  ];
  const result = selectAndroidUpdate('1.0.0', data);
  assert.equal(result.latestVersion, '1.1.0');
  assert.equal(result.releaseUrl, 'https://github.com/FuFu-Flash/EasyHub/releases/tag/1.1.0');
});

test('only an exact application APK name for the release version identifies an Android release', () => {
  for (const abi of ['arm64', 'arm64-v8a', 'universal', 'armv7', 'armeabi-v7a', 'x86', 'x86_64']) {
    assert.equal(selectAndroidUpdate('1.0.0', [androidRelease('1.1.0', {
      assets: [{ name: `EasyHub-Android-1.1.0-${abi}.apk` }],
    })]).available, true);
  }
  for (const name of ['EasyHub-Android-1.0.0-arm64.apk', 'EasyHub-Android-1.1.0-arm64.apk.zip', 'EasyHub-Android-1.1.0-source.apk',
    'EasyHub-Android-on-demand-frameworks-arm64.apk', 'easyhub-android-1.1.0-arm64.apk', 'jadx-runtime.apk']) {
    assert.throws(() => selectAndroidUpdate('1.0.0', [androidRelease('1.1.0', { assets: [{ name }] })]), errorCode('no-android-release'));
  }
});

test('malformed release entries cannot qualify, and remote HTML URLs cannot change the download destination', () => {
  const malformed = [null, [], 'v9.0.0', 99, {}, androidRelease('9.0.0', { assets: null }),
    androidRelease('8.0.0', { assets: [null, 2, {}, { name: { toString: 'bad' } }] })];
  const result = selectAndroidUpdate('1.0.0', [...malformed, androidRelease('1.1.0', { html_url: 'https://untrusted.example/apk' })]);
  assert.equal(result.releaseUrl, 'https://github.com/FuFu-Flash/EasyHub/releases/tag/v1.1.0');
  assert.throws(() => selectAndroidUpdate('1.0.0', []), errorCode('no-android-release'));
  assert.throws(() => selectAndroidUpdate('1.0.0', { releases: [] }), errorCode('response'));
});

test('invalid or unsafe installed versions are rejected before issuing any network request', async () => {
  let calls = 0;
  const transport = async () => { calls += 1; return Response.json([]); };
  for (const value of ['', '1.0', '1.0.0-beta', '01.0.0', '1.0.9007199254740992', 'Infinity.0.0']) {
    await assert.rejects(checkAndroidAppUpdate(value, transport), errorCode('version'));
  }
  assert.equal(calls, 0);
  assert.throws(() => selectAndroidUpdate('1.0.0', [androidRelease('9007199254740992.0.0')]), errorCode('no-android-release'));
});

test('manual update requests use the official list anonymously and bypass cached responses', async () => {
  const calls = [];
  const result = await checkAndroidAppUpdate('1.0.0', async (url, options) => {
    calls.push([url, options]);
    return Response.json([androidRelease('1.1.0')]);
  });
  assert.equal(result.available, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], APP_RELEASES_URL);
  assert.deepEqual(calls[0][1].headers, { Accept: 'application/vnd.github+json', 'Cache-Control': 'no-store' });
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(calls[0][1].signal.aborted, false);
});

test('network, HTTP, and invalid response failures produce safe error codes', async () => {
  await assert.rejects(checkAndroidAppUpdate('1.0.0', async () => { throw new Error('internal token=secret'); }), errorCode('network'));
  for (const status of [403, 429]) {
    await assert.rejects(checkAndroidAppUpdate('1.0.0', async () => new Response('', { status })), errorCode('rate-limit'));
  }
  await assert.rejects(checkAndroidAppUpdate('1.0.0', async () => new Response('', { status: 500 })), errorCode('network'));
  await assert.rejects(checkAndroidAppUpdate('1.0.0', async () => new Response('invalid JSON')), errorCode('response'));
  await assert.rejects(checkAndroidAppUpdate('1.0.0', async () => Response.json({ message: 'invalid' })), errorCode('response'));
  await assert.rejects(checkAndroidAppUpdate('1.0.0', async () => Response.json([])), errorCode('no-android-release'));
});

test('a cancelled check never starts a request or returns a stale response', async () => {
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await assert.rejects(checkAndroidAppUpdate('1.0.0', async () => { throw new Error('must not run'); }, alreadyCancelled.signal), { name: 'AbortError' });

  const controller = new AbortController();
  let complete;
  const pending = checkAndroidAppUpdate('1.0.0', async () => ({ ok: true, json: () => new Promise((resolve) => { complete = resolve; }) }), controller.signal);
  await Promise.resolve();
  controller.abort();
  complete([androidRelease('1.1.0')]);
  await assert.rejects(pending, { name: 'AbortError' });
});

test('the 15-second deadline aborts a stuck request without AbortSignal.timeout support', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let requestSignal;
  const pending = checkAndroidAppUpdate('1.0.0', async (_url, { signal }) => {
    requestSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  context.mock.timers.tick(14_999);
  assert.equal(requestSignal.aborted, false);
  context.mock.timers.tick(1);
  await assert.rejects(pending, errorCode('network'));
  assert.equal(requestSignal.aborted, true);
});

test('finished requests remove the cancellation listener and deadline timer', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let requestSignal;
  await checkAndroidAppUpdate('1.0.0', async (_url, { signal }) => {
    requestSignal = signal;
    return Response.json([androidRelease('1.1.0')]);
  }, controller.signal);
  controller.abort();
  context.mock.timers.tick(15_000);
  assert.equal(requestSignal.aborted, false);
});
