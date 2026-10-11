import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { smokeEnvironment, smokeExecutable } from './smoke-runtime.mjs';

const executable = smokeExecutable(process.cwd());
assert.ok(executable, 'This test requires --executable or --packaged.');
const resourcesFor = application => process.platform === 'darwin'
  ? resolve(dirname(application), '../Resources') : join(dirname(application), 'resources');
const resources = resourcesFor(executable);
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const archive = join(resources, 'app.asar');
const files = new Map();
function collect(entries, prefix = '') {
  for (const [name, entry] of Object.entries(entries)) {
    const filename = prefix ? `${prefix}/${name}` : name;
    if (entry.files) collect(entry.files, filename);
    else files.set(filename, entry);
  }
}
// ASAR's listPackage and statFile use the host separator. Header paths let us
// compare archives consistently while passing native paths to extractFile.
collect(asar.getRawHeader(archive).header.files);
const modules = [...new Set([...files.keys()].filter(file => file.startsWith('node_modules/'))
  .map(file => file.split('/').slice(1, file.split('/')[1].startsWith('@') ? 3 : 2).join('/')))];
let platformSuffix;
if (process.platform === 'win32' && ['x64', 'arm64', 'ia32'].includes(process.arch)) {
  platformSuffix = `win32-${process.arch}-msvc`;
} else if (process.platform === 'darwin' && ['x64', 'arm64'].includes(process.arch)) {
  platformSuffix = `darwin-${process.arch}`;
} else if (process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch)) {
  process.report.excludeNetwork = true;
  platformSuffix = `linux-${process.arch}-${process.report.getReport().header.glibcVersionRuntime ? 'gnu' : 'musl'}`;
} else throw new Error(`Unsupported native keyring target: ${process.platform}/${process.arch}`);
const nativePackage = `@napi-rs/keyring-${platformSuffix}`;
assert.deepEqual(modules.sort(), ['@napi-rs/keyring', nativePackage].sort());
assert.ok(![...files.keys()].some(file => /\.(?:map|ts|mts|cts)$/.test(file)), 'No source/type/debug files in the runtime.');
const extract = (source, file) => asar.extractFile(source, join(...file.split('/')));
for (const target of ['main', 'renderer']) {
  const notices = extract(archive, `out/${target}/bundled-dependency-notices.txt`).toString();
  assert.match(notices, /Permission is hereby granted/);
  assert.match(notices, target === 'main' ? /openai@7\.23\.0/ : /react@19\./);
  const packages = target === 'main' ? ['openai', 'isomorphic-git', 'https-proxy-agent', 'tar', 'yauzl'] : ['react', 'react-markdown'];
  for (const packageName of packages) assert.ok(notices.includes(`${packageName}@`), `Missing bundled notice: ${packageName}`);
  if (target === 'main') assert.match(notices, /Apache License/);
}
for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
  assert.ok((await readFile(join(resources, file), 'utf8')).trim().length > 100, `Missing distribution notice: ${file}`);
}
assert.match(await readFile(join(resources, 'licenses', 'openai-LICENSE'), 'utf8'), /Apache License/);
assert.match(extract(archive, 'node_modules/@napi-rs/keyring/LICENSE').toString(), /Permission is hereby granted/);
const nativeFiles = [...files].filter(([file]) => file.startsWith(`node_modules/${nativePackage}/`) && file.endsWith('.node'));
assert.equal(nativeFiles.length, 1, 'The matching native addon must be included exactly once.');
for (const [file, entry] of nativeFiles) {
  assert.equal(entry.unpacked, true, 'Native addons must be unpacked from ASAR.');
  assert.equal((await stat(join(resources, 'app.asar.unpacked', ...file.split('/')))).size, entry.size);
}

const directory = await mkdtemp(join(tmpdir(), 'easyhub-compact-package-'));
assert.ok(isAbsolute(directory) && dirname(directory) === resolve(tmpdir()), 'The test must own its temporary directory.');
let app;
try {
  const profile = join(directory, 'profile');
  const fixture = join(directory, 'repository');
  const extracted = join(directory, 'extracted');
  await mkdir(profile);
  await mkdir(fixture);
  const gitExecutable = process.platform === 'darwin' ? '/usr/bin/git' : 'git';
  const gitCommand = arguments_ => execFileSync(gitExecutable, arguments_, { stdio: 'ignore', windowsHide: true });
  gitCommand(['init', '--initial-branch=main', fixture]);
  await writeFile(join(fixture, 'README.md'), '# Local fixture\n');
  await writeFile(join(fixture, 'deleted.txt'), 'Original file to delete\n');
  gitCommand(['-C', fixture, 'add', 'README.md', 'deleted.txt']);
  gitCommand(['-C', fixture, '-c', 'core.autocrlf=false', '-c', 'user.name=Package Test', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']);
  await writeFile(join(fixture, 'README.md'), '# Edited fixture\n');
  await writeFile(join(fixture, 'added.txt'), 'A completely different new fixture file\n');
  await rm(join(fixture, 'deleted.txt'));
  const indexBefore = await readFile(join(fixture, '.git', 'index'));

  // A separate application copy makes this wrapper the entrypoint. Its native
  // credential interception runs before the unchanged production main bundle,
  // even on releases that ignore test environment flags or NODE_OPTIONS.
  const applicationRoot = process.platform === 'darwin' ? resolve(dirname(executable), '../..') : dirname(executable);
  const copiedRoot = join(directory, process.platform === 'darwin' ? 'EasyHub.app' : 'application');
  await cp(applicationRoot, copiedRoot, { recursive: true, verbatimSymlinks: true });
  const copiedExecutable = join(copiedRoot, relative(applicationRoot, executable));
  const copiedArchive = join(resourcesFor(copiedExecutable), 'app.asar');
  asar.extractAll(archive, extracted);
  const metadata = JSON.parse(await readFile(join(extracted, 'package.json'), 'utf8'));
  assert.equal(metadata.main, './out/main/index.js');
  metadata.main = './compact-package-bootstrap.cjs';
  await writeFile(join(extracted, 'package.json'), JSON.stringify(metadata));
  await writeFile(join(extracted, 'compact-package-bootstrap.cjs'), String.raw`
const { app, net, session } = require('electron');
const keyring = require('@napi-rs/keyring');
const memory = new WeakMap();
globalThis.compactFixture = { status: 200, calls: [], credentialReads: 0, credentialWrites: 0,
  nativeLoaded: typeof keyring.AsyncEntry === 'function' && typeof keyring.Entry === 'function',
  credentialStore: 'memory', unexpectedNetworkCalls: [] };
for (const [Class, asynchronous] of [[keyring.AsyncEntry, true], [keyring.Entry, false]]) {
  for (const method of ['getPassword', 'getSecret', 'setPassword', 'setSecret', 'deleteCredential', 'deletePassword']) {
    Object.defineProperty(Class.prototype, method, { configurable: true, writable: true,
      value: function(value) {
        let result;
        if (method.startsWith('get')) { globalThis.compactFixture.credentialReads++; result = memory.get(this); }
        else if (method.startsWith('set')) { globalThis.compactFixture.credentialWrites++; memory.set(this, value); }
        else { globalThis.compactFixture.credentialWrites++; result = memory.delete(this); }
        return asynchronous ? Promise.resolve(result) : result;
      } });
  }
}
net.fetch = async (url, init) => {
  if (String(url) !== 'https://api.openai.com/v1/chat/completions') {
    globalThis.compactFixture.unexpectedNetworkCalls.push(String(url));
    throw new Error('Unexpected fixture network request');
  }
  globalThis.compactFixture.calls.push({ url: String(url), body: JSON.parse(init.body),
    redirect: init.redirect, credentials: init.credentials });
  return new Response(JSON.stringify(globalThis.compactFixture.status === 200
    ? { id: 'fixture', object: 'chat.completion', created: 0, model: 'fixture-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }] }
    : { error: { message: 'fixture private error', type: 'fixture' } }),
    { status: globalThis.compactFixture.status, headers: { 'content-type': 'application/json' } });
};
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
  callback({ cancel: /^https?:/.test(details.url) })));
// Exercise the production credential path on both platforms; the wrapper has
// already replaced every native store operation before these flags are cleared.
delete process.env.EASYHUB_TEST_MODE;
delete process.env.EASYHUB_TEST_USER_DATA;
require('./out/main/index.js');
`);
  await asar.createPackageWithOptions(extracted, copiedArchive, { unpack: '**/*.node' });
  const digest = data => createHash('sha256').update(data).digest('hex');
  const verifiedFiles = [...files.keys()].filter(file => file.startsWith('out/') || file.endsWith('.node'));
  for (const file of verifiedFiles) {
    assert.equal(digest(extract(copiedArchive, file)), digest(extract(archive, file)), `Production payload changed: ${file}`);
  }
  app = await electron.launch({ executablePath: copiedExecutable, args: [`--user-data-dir=${profile}`],
    cwd: process.cwd(), env: smokeEnvironment(profile) });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  const native = await app.evaluate(() => ({ loaded: globalThis.compactFixture?.nativeLoaded,
    credentialStore: globalThis.compactFixture?.credentialStore }));
  assert.deepEqual(native, { loaded: true, credentialStore: 'memory' });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof window.easyHub?.aiTestConnection === 'function');
  const initialSettings = await page.evaluate(() => window.easyHub.aiSettings());
  assert.equal(initialSettings.hasApiKey, false, 'Fixture startup must not read a user API key.');
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
  const workerResult = await app.evaluate(async (_electron, { fixture }) => {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const { Worker } = process.getBuiltinModule('node:worker_threads');
    const main = path.join(process.resourcesPath, 'app.asar', 'out', 'main');
    const name = fs.readdirSync(main).find(file => /^gitWorker-.+\.js$/.test(file));
    if (!name) throw new Error('The bundled Git worker is missing.');
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(main, name), { workerData: { action: 'status', path: fixture } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Fixture Git worker timeout')); }, 15000);
      const finish = () => { clearTimeout(timer); void worker.terminate(); };
      worker.on('message', message => {
        if (message.type === 'result') { finish(); resolve(message.value); }
        if (message.type === 'error') { finish(); reject(new Error(message.message)); }
      });
      worker.on('error', error => { finish(); reject(error); });
    });
  }, { fixture });
  assert.deepEqual(workerResult.files.sort((a, b) => a.path.localeCompare(b.path)), [
    { path: 'added.txt', kind: 'added' }, { path: 'deleted.txt', kind: 'deleted' }, { path: 'README.md', kind: 'modified' },
  ].sort((a, b) => a.path.localeCompare(b.path)));
  assert.match(workerResult.head, /^[a-f0-9]{40}$/);
  assert.equal(await readFile(join(fixture, 'README.md'), 'utf8'), '# Edited fixture\n');
  assert.deepEqual(await readFile(join(fixture, '.git', 'index')), indexBefore, 'Status must leave the Git index unchanged.');
  const fixtureState = await app.evaluate(() => ({ calls: globalThis.compactFixture.calls.length,
    writes: globalThis.compactFixture.credentialWrites, unexpected: globalThis.compactFixture.unexpectedNetworkCalls }));
  assert.equal(fixtureState.calls, 2);
  assert.ok(fixtureState.writes > 0);
  assert.deepEqual(fixtureState.unexpected, []);
  const report = { status: 'passed', executable, asarBytes: (await stat(archive)).size,
    runtimeModules: modules, fullDependencyNoticesRetained: true, unpackedNativeAddonLoaded: true,
    realBundledSdkSuccessAndSanitizedFailure: true, realBundledGitWorkerStatus: ['added', 'deleted', 'modified'],
    testHarness: 'isolated application copy with memory credentials', unchangedPayloadFiles: verifiedFiles.length,
    isolatedProfile: true, userAccountAndSystemProxyUntouched: true };
  if (process.env.EASYHUB_COMPACT_REPORT) await writeFile(process.env.EASYHUB_COMPACT_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await app?.close(); }
  finally {
    assert.ok(dirname(directory) === resolve(tmpdir()) && directory.startsWith(join(resolve(tmpdir()), 'easyhub-compact-package-')));
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
