import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { smokeEnvironment, smokeExecutable } from './smoke-runtime.mjs';

const executable = smokeExecutable(process.cwd());
assert.ok(executable, 'This test requires --executable or --packaged.');
const resources = resolve(executable, '../../Resources');
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const archive = join(resources, 'app.asar');
const files = asar.listPackage(archive).map(file => file.replace(/^\//, ''));
const modules = [...new Set(files.filter(file => file.startsWith('node_modules/') && typeof asar.statFile(archive, file).size === 'number')
  .map(file => file.split('/').slice(1, 3).join('/')))];
assert.deepEqual(modules.sort(), ['@napi-rs/keyring', '@napi-rs/keyring-darwin-arm64']);
assert.ok(!files.some(file => /\.(?:map|ts|mts|cts)$/.test(file)), 'No source/type/debug files in the runtime.');
for (const target of ['main', 'renderer']) {
  const notices = asar.extractFile(archive, `out/${target}/bundled-dependency-notices.txt`).toString();
  assert.match(notices, /Permission is hereby granted/);
  assert.match(notices, target === 'main' ? /openai@7\.23\.0/ : /react@19\./);
}

const directory = await mkdtemp(join(tmpdir(), 'easyhub-compact-package-'));
const profile = join(directory, 'profile');
const fixture = join(directory, 'repository');
await mkdir(profile);
await mkdir(fixture);
execFileSync('/usr/bin/git', ['init', '--initial-branch=main', fixture], { stdio: 'ignore' });
await writeFile(join(fixture, 'README.md'), '# Local fixture\n');
execFileSync('/usr/bin/git', ['-C', fixture, 'add', 'README.md']);
execFileSync('/usr/bin/git', ['-C', fixture, '-c', 'user.name=Package Test', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture'], { stdio: 'ignore' });
await writeFile(join(fixture, 'README.md'), '# Edited fixture\n');
let app;
try {
  app = await electron.launch({ executablePath: executable, args: [], cwd: process.cwd(), env: smokeEnvironment(profile) });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof window.easyHub?.aiTestConnection === 'function');
  const native = await app.evaluate(() => {
    const require = process.getBuiltinModule('node:module').createRequire(`${process.resourcesPath}/app.asar/package.json`);
    const keyring = require('@napi-rs/keyring');
    return { asyncEntry: typeof keyring.AsyncEntry, entry: typeof keyring.Entry };
  });
  assert.deepEqual(native, { asyncEntry: 'function', entry: 'function' });

  // Exercise the actual inlined SDK and production IPC/provider. Only its
  // transport is replaced; no AI account, network request or real key is used.
  await app.evaluate(({ net }) => {
    globalThis.compactFixture = { status: 200, calls: [] };
    net.fetch = async (url, init) => {
      globalThis.compactFixture.calls.push({ url: String(url), body: JSON.parse(init.body), redirect: init.redirect, credentials: init.credentials });
      return new Response(JSON.stringify(globalThis.compactFixture.status === 200
        ? { id: 'fixture', object: 'chat.completion', created: 0, model: 'fixture-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }] }
        : { error: { message: 'fixture private error', type: 'fixture' } }),
      { status: globalThis.compactFixture.status, headers: { 'content-type': 'application/json' } });
    };
  });
  await page.evaluate(() => window.easyHub.aiSaveSettings({ providerId: 'openai', model: 'fixture-model', apiKey: 'sk-synthetic-package-fixture' }));
  await page.evaluate(() => window.easyHub.aiTestConnection());
  const calls = await app.evaluate(() => globalThis.compactFixture.calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].body.model, 'fixture-model');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].credentials, 'omit');
  await app.evaluate(() => { globalThis.compactFixture.status = 401; });
  const failure = await page.evaluate(async () => {
    try { await window.easyHub.aiTestConnection(); return ''; } catch (error) { return String(error); }
  });
  assert.match(failure, /授权失败/);
  assert.ok(!failure.includes('fixture private error'));

  // Run the real bundled worker and Git library on our disposable repository.
  const git = await app.evaluate(async (_electron, { fixture }) => {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const { Worker } = process.getBuiltinModule('node:worker_threads');
    const main = path.join(process.resourcesPath, 'app.asar/out/main');
    const workerPath = path.join(main, fs.readdirSync(main).find(file => /^gitWorker-.+\.js$/.test(file)));
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: { action: 'status', path: fixture } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Fixture Git worker timeout')); }, 15000);
      const finish = () => { clearTimeout(timer); void worker.terminate(); };
      worker.on('message', message => {
        if (message.type === 'result') { finish(); resolve(message.value); }
        if (message.type === 'error') { finish(); reject(new Error(message.message)); }
      });
      worker.on('error', error => { finish(); reject(error); });
    });
  }, { fixture });
  assert.deepEqual(git.files, [{ path: 'README.md', kind: 'modified' }]);
  assert.match(git.head, /^[a-f0-9]{40}$/);
  assert.equal(await readFile(join(fixture, 'README.md'), 'utf8'), '# Edited fixture\n');
  const report = { status: 'passed', executable, asarBytes: (await stat(archive)).size,
    runtimeModules: modules, fullDependencyNoticesRetained: true, nativeKeyringLoaded: true,
    realBundledSdkSuccessAndSanitizedFailure: true, realBundledGitWorkerStatus: true,
    isolatedProfile: true, userAccountAndSystemProxyUntouched: true };
  if (process.env.EASYHUB_COMPACT_REPORT) await writeFile(process.env.EASYHUB_COMPACT_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
