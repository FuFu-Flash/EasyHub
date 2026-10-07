import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { smokeExecutable, smokeEnvironment } from './smoke-runtime.mjs';

const desktop = dirname(fileURLToPath(import.meta.url));
const executable = smokeExecutable(desktop);
const packaged = !!executable;
const mainDirectory = packaged ? (process.platform === 'darwin' ? join(executable, '../../Resources/app.asar/out/main') : join(executable, '../resources/app.asar/out/main')) : join(desktop, 'out/main');
const root = await mkdtemp(join(tmpdir(), 'easyhub-github-proxy-network-'));
const profile = join(root, 'profile');
await mkdir(profile);
const launcher = join(root, 'launch.cjs');
await writeFile(launcher, `
const {app}=require('electron');
globalThis.easyHubProxyTestWorker=require('node:worker_threads').Worker;
const fixtureWorkerDirectory=${JSON.stringify(mainDirectory)};
globalThis.easyHubProxyTestWorkerPath=require('node:path').join(fixtureWorkerDirectory,require('node:fs').readdirSync(fixtureWorkerDirectory).find(name=>/^gitWorker-.+\\.js$/.test(name)));
app.setPath('userData',${JSON.stringify(profile)});
process.env.EASYHUB_PROXY_APP_ONLY_TEST='1';
process.env.ELECTRON_RENDERER_URL='data:text/html,<title>GitHub proxy connection test</title>';
require(${JSON.stringify(join(mainDirectory, 'index.js'))});
`, 'utf8');
let running;
try {
  running = await electron.launch({ executablePath: executable || electronPath, args: executable ? [] : [launcher], cwd: desktop, env: smokeEnvironment(profile) });
  if (executable) await running.evaluate((_electron, workerDirectory) => {
    globalThis.easyHubProxyTestWorker = process.getBuiltinModule('node:worker_threads').Worker;
    const path = process.getBuiltinModule('node:path');
    const fs = process.getBuiltinModule('node:fs');
    globalThis.easyHubProxyTestWorkerPath = path.join(workerDirectory, fs.readdirSync(workerDirectory).find(name => /^gitWorker-.+\.js$/.test(name)));
  }, mainDirectory);
  const page = await running.firstWindow();
  await page.waitForFunction(() => typeof window.easyHub?.githubProxySetEnabled === 'function');
  assert.equal(await running.evaluate(({ app }) => app.getPath('userData')), profile);
  // This changes only the isolated Electron session. The Windows proxy, hosts,
  // certificate store and the user's real EasyHub preferences remain untouched.
  await running.evaluate(async ({ session }) => { await session.defaultSession.setProxy({ mode: 'direct' }); });
  assert.equal((await page.evaluate(() => window.easyHub.githubProxyStatus())).enabled, false);
  const checks = await page.evaluate(() => window.easyHub.githubProxySetEnabled(true));
  assert.equal(checks.state, 'ready', JSON.stringify(checks));
  assert.equal(checks.enabled, true);
  assert.equal(checks.checks.length, 3);
  assert.ok(checks.checks.every(check => check.ok));
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'github-proxy.json'), 'utf8')), { enabled: true });
  const result = await running.evaluate(async ({ net }) => {
    const signal = AbortSignal.timeout(25000);
    const api = await net.fetch('https://api.github.com/repos/octocat/Hello-World', { signal });
    const repository = await api.json();
    const raw = await net.fetch('https://raw.githubusercontent.com/octocat/Hello-World/master/README', { signal });
    const rawBody = await raw.text();
    const git = await net.fetch('https://github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack', { signal });
    const advertisement = await git.text();
    const archive = await net.fetch('https://api.github.com/repos/octocat/Hello-World/zipball/master', { signal });
    const archiveBytes = new Uint8Array(await archive.arrayBuffer());
    return { api: api.status, fullName: repository.full_name, raw: raw.status, rawMatches: rawBody.includes('Hello World'),
      git: git.status, advertisement: advertisement.includes('git-upload-pack'),
      archive: archive.status, archiveSize: archiveBytes.length, zipSignature: Array.from(archiveBytes.slice(0, 4)) };
  });
  assert.equal(result.api, 200);
  assert.equal(result.fullName, 'octocat/Hello-World');
  assert.equal(result.raw, 200);
  assert.equal(result.rawMatches, true);
  assert.equal(result.git, 200);
  assert.equal(result.advertisement, true);
  assert.equal(result.archive, 200);
  assert.ok(result.archiveSize > 300);
  assert.deepEqual(result.zipSignature, [80, 75, 3, 4]);
  const destination = join(root, 'downloads');
  await mkdir(destination);
  const checkout = await running.evaluate(async (_electron, { destination }) => {
    return new Promise((resolve, reject) => {
      const worker = new globalThis.easyHubProxyTestWorker(globalThis.easyHubProxyTestWorkerPath, { workerData: { action: 'download', path: destination,
        repo: { owner: 'octocat', name: 'Hello-World', defaultBranch: 'master' }, token: 'unused-public-fixture',
        githubRules: { 'github.com': { addresses: ['20.207.73.82'], servername: '' } } } });
      const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('Public Git download timed out')); }, 45000);
      const finish = () => { clearTimeout(timeout); void worker.terminate(); };
      worker.on('message', message => {
        if (message.type === 'result') { finish(); resolve(message.value); }
        if (message.type === 'error') { finish(); reject(new Error(message.message)); }
      });
      worker.on('error', error => { finish(); reject(error); });
    });
  }, { destination });
  assert.equal(checkout.path, join(destination, 'Hello-World'));
  assert.ok((await readFile(join(checkout.path, 'README'), 'utf8')).includes('Hello World'));
  assert.equal((await page.evaluate(() => window.easyHub.githubProxySetEnabled(false))).enabled, false);
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'github-proxy.json'), 'utf8')), { enabled: false });
  console.log(`PASS ${packaged ? 'packaged' : 'built'} Electron GitHub proxy: device login, API JSON, README, Git protocol, redirected ZIP and Git worker project download; isolated profile, no account or OS changes.`);
} finally {
  await running?.close();
  const absolute = await realpath(root);
  assert.ok(absolute.startsWith(`${await realpath(tmpdir())}${sep}`) && absolute.includes('easyhub-github-proxy-network-'));
  await rm(absolute, { recursive: true, force: true });
}
