import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const fixture = await mkdtemp(join(tmpdir(), 'easyhub-local-introduction-'));
const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const profile = join(fixture, 'profile');
const first = join(fixture, 'first-checkout');
const second = join(fixture, 'second-checkout');
await mkdir(profile);
await mkdir(first);
await mkdir(second);
await writeFile(join(first, 'README.md'), '# First local introduction\n\nFirst checkout only.');
await writeFile(join(second, 'README.md'), '# Second local introduction\n\nSecond checkout only.');
const launcher = join(fixture, 'launch.cjs');
// Main services use the isolated profile from their first initialization. Keep
// the first renderer blank until every external bridge has been replaced.
await writeFile(launcher, `
const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Local introduction fixture</title>';
const fixtureFs = require('node:fs/promises');
const fixturePath = require('node:path');
const fixtureHosts = fixturePath.resolve(fixturePath.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'drivers', 'etc', 'hosts')).toLowerCase();
const fixtureReadFile = fixtureFs.readFile;
globalThis.easyHubIntroductionStartupGuards = { hostsReads: 0 };
fixtureFs.readFile = async (target, ...args) => {
  if (typeof target === 'string' && fixturePath.resolve(target).toLowerCase() === fixtureHosts) {
    globalThis.easyHubIntroductionStartupGuards.hostsReads += 1;
    return Buffer.alloc(0);
  }
  return fixtureReadFile(target, ...args);
};
require(${JSON.stringify(join(desktopDirectory, 'out', 'main', 'index.js'))});
`, 'utf8');
let app;
try {
  app = await electron.launch({ executablePath: electronPath, args: [launcher], cwd: desktopDirectory });
  assert.equal(await app.evaluate(({ app: runningApp }) => runningApp.getPath('userData')), profile);
  // Keep every read local and prevent GitHub writes while driving the real renderer and preload.
  await app.evaluate(({ BrowserWindow, ipcMain, session }, { first, second }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('Missing local introduction fixture window');
    const control = globalThis.easyHubIntroductionFixture = { errors: {}, held: { 'local-1': true }, waiters: {}, forbidden: [], network: [], reads: [] };
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      control.network.push(details.url);
      callback({ cancel: true });
    });
    const links = [first, second].map((localPath, index) => ({ id: `local-${index}`, repositoryId: 41, owner: 'tester', name: 'same-project', localPath, lastOpenedAt: '2026-09-29T10:00:00Z' }));
    const replace = (channel, handler) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (event, ...args) => {
        if (event.sender !== window.webContents) throw new Error('Fixture IPC used from another window');
        return handler(...args);
      });
    };
    for (const channel of [
      'easyhub:auth-start', 'easyhub:auth-start-delete', 'easyhub:auth-poll', 'easyhub:auth-logout',
      'easyhub:open-license', 'easyhub:open-external-link', 'easyhub:choose-folder',
      'easyhub:local-inspect', 'easyhub:local-connect', 'easyhub:local-create', 'easyhub:local-download',
      'easyhub:local-publish', 'easyhub:local-sync', 'easyhub:local-save-introduction', 'easyhub:local-open-folder',
      'easyhub:local-discovery-add-root', 'easyhub:local-discovery-remove-root', 'easyhub:local-discovery-scan',
      'easyhub:release-choose-files', 'easyhub:release-publish', 'easyhub:release-edit',
      'easyhub:release-add-assets', 'easyhub:release-remove-asset',
      'easyhub:download-archive', 'easyhub:download-release-asset', 'easyhub:download-pull-file',
      'easyhub:reveal-downloaded-archive', 'easyhub:open-downloaded-file',
      'easyhub:hosts-set-enabled', 'easyhub:hosts-refresh',
      'easyhub:ai-save-settings', 'easyhub:ai-forget-key', 'easyhub:ai-test-connection', 'easyhub:ai-review-pull',
    ]) replace(channel, () => {
      control.forbidden.push(channel);
      throw new Error(`External action is forbidden by the local fixture: ${channel}`);
    });
    for (const channel of ['easyhub:auth-cancel', 'easyhub:local-cancel', 'easyhub:release-cancel',
      'easyhub:github-cancel', 'easyhub:cancel-archive', 'easyhub:ai-cancel-review', 'easyhub:cancel-translation']) replace(channel, () => undefined);
    replace('easyhub:auth-status', () => ({ user: { login: 'tester', name: 'Tester', avatar_url: '', html_url: 'https://example.invalid/tester' }, clientId: 'fixture' }));
    replace('easyhub:ai-settings', () => ({ enabled: false, hasApiKey: false, baseUrl: '', model: '' }));
    replace('easyhub:hosts-status', () => ({ enabled: false, updatedAt: null, source: 'fixture' }));
    replace('easyhub:local-discovery-roots', () => []);
    replace('easyhub:translate-content', (request) => request.text);
    replace('easyhub:github', (action) => {
      if (action === 'repos') return [];
      if (action === 'activityCounts') return {};
      control.forbidden.push(`github:${action}`);
      throw new Error(`Offline fixture: ${action}`);
    });
    replace('easyhub:local-list', () => links);
    replace('easyhub:local-status', () => ({ files: [], needsReview: false }));
    replace('easyhub:local-check-sync', () => ({ state: 'current', files: [] }));
    replace('easyhub:local-read-introduction', async (id) => {
      const link = links.find((item) => item.id === id);
      if (!link) throw new Error('Unknown local fixture');
      control.reads.push(id);
      if (control.held[id]) await new Promise((resolve) => { control.waiters[id] = resolve; });
      if (control.errors[id]) throw new Error(control.errors[id]);
      return process.getBuiltinModule('node:fs/promises').readFile(`${link.localPath}/README.md`, 'utf8');
    });
  }, { first, second });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, renderer) => {
    await BrowserWindow.getAllWindows()[0].loadFile(renderer);
  }, join(desktopDirectory, 'out', 'renderer', 'index.html'));
  await page.locator('.live-connected').waitFor();
  const openLocal = async (index) => {
    await page.locator('.sidebar-nav button').filter({ hasText: /我的项目|My Projects/u }).click();
    await page.getByRole('button', { name: /这台电脑|This computer/u }).click();
    await page.locator('.project-card').nth(index).getByRole('button', { name: /打开项目|Open project/u, exact: true }).click();
    await page.locator('.local-workspace').waitFor();
  };
  await openLocal(1);
  await page.getByText('正在读取项目介绍…', { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await page.getByText('这个项目还没有介绍。', { exact: true }).count(), 0, 'Reading the README must not report an empty introduction.');
  await app.evaluate(() => { const control = globalThis.easyHubIntroductionFixture; control.held['local-1'] = false; control.waiters['local-1'](); });
  await page.getByRole('heading', { name: 'Second local introduction', exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await page.locator('.local-project-card').count(), 1, 'The clicked checkout must be the only local project shown.');
  assert.equal(await page.getByText('First checkout only.', { exact: true }).count(), 0, 'Another checkout must not supply this introduction.');
  assert.equal(await page.getByText(second, { exact: true }).count(), 1);
  assert.equal(await readFile(join(second, 'README.md'), 'utf8'), '# Second local introduction\n\nSecond checkout only.');
  await openLocal(0);
  await page.getByRole('heading', { name: 'First local introduction', exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await page.getByText('Second checkout only.', { exact: true }).count(), 0, 'Changing projects must clear the prior introduction.');
  await page.locator('.sidebar-nav button').filter({ hasText: /首页|Home/u }).click();
  await page.locator('.home-all-saved').getByRole('button').click();
  await page.locator('.local-project-card').nth(1).waitFor();
  assert.equal(await page.locator('.local-project-card').count(), 2, 'The general local view must clear the previously selected checkout.');
  await app.evaluate(() => { globalThis.easyHubIntroductionFixture.errors['local-0'] = '本地介绍暂时无法读取'; });
  await openLocal(0);
  await page.getByRole('alert').filter({ hasText: '本地介绍暂时无法读取' }).waitFor();
  assert.equal(await page.getByText('这个项目还没有介绍。', { exact: true }).count(), 0, 'A read error must not report an empty introduction.');
  await app.evaluate(() => { delete globalThis.easyHubIntroductionFixture.errors['local-0']; });
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.getByRole('heading', { name: 'First local introduction', exact: true }).waitFor();
  await writeFile(join(first, 'README.md'), '');
  await openLocal(0);
  await page.getByText('这个项目还没有介绍。', { exact: true }).waitFor();
  assert.equal(await page.locator('.readme-markdown').count(), 0);
  assert.deepEqual(errors, [], 'The isolated renderer must not have uncaught errors.');
  const isolation = await app.evaluate(() => ({ forbidden: globalThis.easyHubIntroductionFixture.forbidden,
    network: globalThis.easyHubIntroductionFixture.network, reads: globalThis.easyHubIntroductionFixture.reads,
    hostsReads: globalThis.easyHubIntroductionStartupGuards.hostsReads }));
  assert.deepEqual(isolation.forbidden, [], 'The test must not invoke account, file, or GitHub mutations.');
  assert.deepEqual(isolation.network, [], 'The test must not access external network resources.');
  assert.equal(isolation.hostsReads, 0, 'Main startup must not access system hosts when app proxy is disabled.');
  assert.ok(isolation.reads.includes('local-0') && isolation.reads.includes('local-1'), 'Both real fixture README files must be read.');
  process.stdout.write('Local introduction, exact checkout, offline navigation, loading, retry and empty states passed.\n');
} finally {
  if (app) await app.close();
  const resolved = await realpath(fixture).catch(() => null);
  const temp = await realpath(tmpdir());
  if (resolved?.startsWith(`${temp}${sep}easyhub-local-introduction-`)) await rm(resolved, { recursive: true, force: true });
}
