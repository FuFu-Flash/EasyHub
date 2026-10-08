import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { installDownloadFixture } from './download-fixture.mjs';

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(desktopDirectory, 'out', 'notifications-cursor-smoke');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'isolated-'));
const profileDirectory = join(runDirectory, 'profile');
await mkdir(profileDirectory);
const executableArgument = process.argv.find(value => value.startsWith('--executable='));
const executable = executableArgument?.slice('--executable='.length);
if (executableArgument && (!executable || !isAbsolute(executable))) throw new Error('--executable requires an absolute path.');
const runningOnly = process.argv.includes('--repro-running-only');
const launcher = join(runDirectory, 'launch.cjs');
if (!executable) await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profileDirectory)});
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Isolated notification fixture</title>';
globalThis.notificationRegisterMock = ipcMain.handle.bind(ipcMain);
globalThis.notificationRejectedIpc = [];
ipcMain.handle = (channel, callback) => globalThis.notificationRegisterMock(channel, channel.startsWith('easyhub:') ? () => {
  globalThis.notificationRejectedIpc.push(channel);
  throw new Error('Unmocked notification fixture IPC: ' + channel);
} : callback);
require(${JSON.stringify(join(desktopDirectory, 'out/main/index.js'))});
`, 'utf8');
const started = Date.now();
const app = await electron.launch({ executablePath: executable || electronPath,
  args: executable ? ['--user-data-dir=' + profileDirectory] : [launcher], cwd: desktopDirectory });
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profileDirectory, 'The smoke must use only its newly created isolated profile');
  await app.evaluate(({ ipcMain, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const register = globalThis.notificationRegisterMock ?? ipcMain.handle.bind(ipcMain);
    const handle = (channel, callback) => { ipcMain.removeHandler(channel); register(channel, callback); };
    const now = new Date().toISOString();
    const repo = { id: 3301, name: 'notifications-fixture', full_name: 'notification-fixture/notifications-fixture', description: 'Notification fixture',
      private: false, archived: false, permissions: { admin: true, push: true, pull: true }, updated_at: now, default_branch: 'main', owner: { login: 'notification-fixture' }, open_issues_count: 999 };
    const state = globalThis.notificationFixture = { live: true, counts: { 3301: { issues: 23, closedIssues: 0, pullRequests: 7, closedPullRequests: 0 } }, pendingDownloads: [], forbidden: [], cancellations: 0 };
    handle('easyhub:auth-status', () => ({ user: state.live ? { login: 'notification-fixture', name: 'Fixture', avatar_url: '', html_url: '' } : null, clientId: null }));
    handle('easyhub:local-list', () => []);
    handle('easyhub:local-discovery-roots', () => []);
    handle('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false }));
    handle('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    handle('easyhub:github-cancel', () => undefined);
    handle('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', engineVersion: '12.1.2' }));
    for (const channel of ['easyhub:ai-review-pull', 'easyhub:binary-ai-review', 'easyhub:ai-test-connection', 'easyhub:ai-save-settings',
      'easyhub:ai-forget-key', 'easyhub:translate-content', 'easyhub:auth-start', 'easyhub:auth-poll', 'easyhub:auth-logout',
      'easyhub:open-external-link', 'easyhub:open-downloaded-file', 'easyhub:reveal-downloaded-archive']) {
      handle(channel, () => { state.forbidden.push(channel); throw new Error('This notification fixture blocks real account, provider, filesystem and external actions.'); });
    }
    handle('easyhub:github', (_event, action) => {
      if (action === 'repos') return [repo];
      if (action === 'activityCounts') return state.counts;
      if (action === 'repository' || action === 'publicRepo') return repo;
      if (action === 'isStarred') return false;
      if (action === 'searchPublicRepos') return [repo];
      if (action === 'searchPublicReposPage') return { items: [repo], page: 1, totalCount: 1, hasNextPage: false, incompleteResults: false };
      if (action === 'trending') return { items: [repo], page: 1, hasNextPage: false };
      if (action === 'readme') return '# Notification fixture\n\nSelectable README text remains available.\n\n[Fixture link](https://example.invalid/fixture)';
      if (action === 'releases' || action === 'releasesPage') {
        const items = [{ id: 3302, tag_name: 'v1', name: 'Fixture release', body: '', draft: false, prerelease: false, published_at: now,
          assets: [{ id: 3303, name: 'fixture.zip', size: 1024, content_type: 'application/zip', state: 'uploaded', download_count: 0 }] }];
        return action === 'releasesPage' ? { items, nextPage: null } : items;
      }
      if (action === 'issues' || action === 'commits' || action === 'comments' || action === 'pullRequests' || action === 'pullRequestsPage') return [];
      if (action === 'issuesPage') return { items: [], nextPage: null };
      state.forbidden.push(action); throw new Error('Unexpected mock GitHub action: ' + action);
    });
    handle('easyhub:download-release-asset', (event) => {
      event.sender.send('easyhub:download-progress', { loaded: 256, total: 1024, percent: 25 });
      return new Promise((resolve, reject) => state.pendingDownloads.push({ resolve, reject }));
    });
    globalThis.finishNotificationDownload = (outcome) => {
      const pending = state.pendingDownloads.shift();
      if (!pending) throw new Error('No pending fake download');
      if (outcome === 'complete') pending.resolve('C:\\Fixture-only\\fixture.zip');
      else pending.reject(new Error(outcome === 'cancelled' ? '模拟下载已取消。' : 'Mock fixture download failed.'));
    };
    handle('easyhub:cancel-archive', () => { state.cancellations += 1; globalThis.finishNotificationDownload('cancelled'); });
  });
  await installDownloadFixture(app, ['easyhub:download-release-asset', 'easyhub:cancel-archive']);
  const page = await app.firstWindow();
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (!executable) await app.evaluate(async ({ BrowserWindow }, renderer) => { await BrowserWindow.getAllWindows()[0].loadFile(renderer); }, join(desktopDirectory, 'out/renderer/index.html'));
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('easyhub:language', 'zh'); localStorage.setItem('easyhub:auto-translate', 'false'); });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  const trigger = page.getByRole('button', { name: '通知', exact: true });
  const badge = page.locator('.download-notification-count');
  const panel = page.getByRole('dialog', { name: '通知', exact: true });
  await badge.getByText('2', { exact: true }).waitFor();
  await trigger.click();
  await panel.getByText('notifications-fixture 有 23 个待处理的问题', { exact: true }).waitFor();
  await badge.waitFor({ state: 'hidden' });
  assert.equal(await panel.locator('.activity-notification-item').count(), 2, 'Badge counts notices, not the 23 issues and 7 PRs in their titles');
  await panel.getByRole('button', { name: '关闭通知', exact: true }).click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: /我的云端项目/ }).click();
  await page.locator('.cloud-row').filter({ hasText: 'notifications-fixture' }).getByRole('button', { name: '查看', exact: true }).click();
  await page.getByRole('button', { name: '编辑发行版', exact: true }).click();
  await page.getByTestId('release-downloads').getByRole('button', { name: /fixture\.zip/ }).click();
  await panel.getByRole('progressbar').waitFor();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  await page.screenshot({ path: join(outputDirectory, 'running-already-read.png') });
  assert.equal(await badge.count(), 0, 'An already-read running download with the notification panel open must contribute zero unread notifications');
  if (!runningOnly) {
    const download = page.getByTestId('release-downloads').getByRole('button', { name: /fixture\.zip/ });
    const close = () => panel.getByRole('button', { name: '关闭通知', exact: true }).click();
    const finish = (outcome) => app.evaluate((_electron, outcome) => globalThis.finishNotificationDownload(outcome), outcome);
    const expectUnread = async (value) => {
      if (value === 0) await badge.waitFor({ state: 'hidden' });
      else await badge.getByText(String(value), { exact: true }).waitFor();
    };
    const read = async () => { await trigger.click(); await panel.waitFor(); await expectUnread(0); };
    const clear = async () => {
      await panel.getByRole('button', { name: '清除下载记录', exact: true }).click();
      assert.equal(await panel.locator('.download-notification-item').count(), 0);
      assert.equal(await panel.locator('.activity-notification-item').count(), 2, 'Clearing download history must retain project notices');
      await expectUnread(0);
    };
    const cursorEvidence = {};
    const cursor = async (locator, label) => {
      await locator.hover({ force: true });
      const value = await locator.evaluate(element => getComputedStyle(element).cursor);
      assert.equal(value, 'default', label + ' must keep the normal arrow');
      cursorEvidence[label] = value;
    };
    await cursor(download, 'download queue button');
    assert.equal(await download.isDisabled(), false, 'Further downloads must remain available while the queue is running');
    // Completion after closing produces one unread notice; reading clears it.
    await close();
    await finish('complete');
    await expectUnread(1);
    await read();
    await panel.getByText('项目已经下载完成。', { exact: true }).waitFor();
    await close();
    await download.click();
    await panel.getByRole('progressbar').waitFor();
    await expectUnread(0);
    // Clear finished history while retaining the active download.
    await panel.getByRole('button', { name: '清除下载记录', exact: true }).click();
    assert.equal(await panel.locator('.download-notification-item').count(), 1);
    await panel.getByRole('progressbar').waitFor();
    await finish('complete');
    await panel.getByText('项目已经下载完成。', { exact: true }).waitFor();
    await expectUnread(0);
    await page.screenshot({ path: join(outputDirectory, 'completed-while-open.png') });
    await clear();
    // User cancellation while visible is immediately read.
    await close();
    await download.click();
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    const cancelledError = panel.locator('.download-notification-error').filter({ hasText: /模拟下载已取消。$/ });
    await cancelledError.waitFor();
    const cancellationState = await app.evaluate(() => ({
      cancellations: globalThis.notificationFixture.cancellations,
      pendingDownloads: globalThis.notificationFixture.pendingDownloads.length,
    }));
    process.stdout.write('Cancellation fixture: ' + JSON.stringify({ ...cancellationState, displayedError: await cancelledError.innerText() }) + '\n');
    assert.equal(cancellationState.cancellations, 1);
    assert.equal(cancellationState.pendingDownloads, 0);
    await expectUnread(0);
    await clear();
    // A closed-panel failure becomes unread; retry replaces its record.
    await close();
    await download.click();
    await panel.getByRole('progressbar').waitFor();
    await close();
    await finish('failed');
    await expectUnread(1);
    await read();
    await panel.locator('.download-notification-error').filter({ hasText: /Mock fixture download failed\.$/ }).waitFor();
    await panel.getByRole('button', { name: '重试', exact: true }).click();
    await panel.getByRole('progressbar').waitFor();
    assert.equal(await panel.locator('.download-notification-item').count(), 1);
    await expectUnread(0);
    await close();
    await finish('cancelled');
    await expectUnread(1);
    await read();
    await panel.locator('.download-notification-error').filter({ hasText: /模拟下载已取消。$/ }).waitFor();
    await clear();
    await close();
    // One changed project notice produces +1, independently of issue totals.
    await app.evaluate(() => { globalThis.notificationFixture.counts[3301].issues = 24; });
    const refresh = page.getByRole('button', { name: '刷新 GitHub 数据', exact: true });
    await refresh.click();
    await expectUnread(1);
    await read();
    await panel.getByText('notifications-fixture 有 24 个待处理的问题', { exact: true }).waitFor();
    await app.evaluate(() => { globalThis.notificationFixture.counts[3301].issues = 25; });
    // Keyboard refresh leaves the panel open and marks its updated notice read.
    await refresh.press('Enter');
    await panel.getByText('notifications-fixture 有 25 个待处理的问题', { exact: true }).waitFor();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await expectUnread(0);
    await close();
    await page.screenshot({ path: join(outputDirectory, 'live-all-read.png') });
    // Check real DOM cursors while preserving clicking, typing and README selection.
    await cursor(page.locator('body'), 'ordinary page');
    const nav = page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true });
    await cursor(nav, 'hovered navigation button');
    await nav.click();
    await page.getByRole('button', { name: /我的云端项目/ }).click();
    await page.locator('.cloud-row').filter({ hasText: 'notifications-fixture' }).getByRole('button', { name: '查看', exact: true }).click();
    const readme = page.locator('.readme-markdown');
    const text = readme.getByText('Selectable README text remains available.', { exact: true });
    await text.waitFor();
    await cursor(readme.getByRole('link', { name: 'Fixture link', exact: true }), 'README link');
    await cursor(text, 'selectable README text');
    assert.equal(await text.evaluate(element => getComputedStyle(element).userSelect), 'text');
    const box = await text.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(270, box.width - 2), box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.match(await page.evaluate(() => window.getSelection()?.toString() ?? ''), /Selectable README/);
    await cursor(page.locator('.topbar-search input'), 'editable input');
    const input = page.locator('.topbar-search input');
    await input.fill('Cursor input probe');
    // Typing in the top bar intentionally moves the live workspace to Discover.
    const discoverInput = page.locator('.discover-search input');
    assert.equal(await discoverInput.inputValue(), 'Cursor input probe');
    await cursor(discoverInput, 'editable Discover input');
    await discoverInput.fill('');
    await cursor(trigger.locator('svg'), 'button SVG');
    await page.screenshot({ path: join(outputDirectory, 'cursor-readme.png') });
    // Reloading in demo mode keeps all operations within this isolated fixture.
    await app.evaluate(() => { globalThis.notificationFixture.live = false; });
    await page.reload();
    await page.locator('.live-connected').waitFor({ state: 'hidden' });
    await badge.waitFor();
    const demoUnread = Number(await badge.innerText());
    assert.ok(demoUnread > 0);
    await trigger.click();
    await panel.waitFor();
    assert.equal(await panel.locator('.activity-notification-item').count(), demoUnread, 'Demo badge also counts notification entries');
    await expectUnread(0);
    await close();
    await trigger.click();
    await expectUnread(0);
    assert.equal(await panel.locator('.activity-notification-item').count(), demoUnread, 'Reading Demo notifications retains the project tasks');
    await page.screenshot({ path: join(outputDirectory, 'demo-all-read.png') });
    await close();
    assert.deepEqual(await app.evaluate(() => globalThis.notificationFixture.forbidden), []);
    process.stdout.write('PASS: completion/open-panel read, failure/retry/cancellation, history clearing, activity updates, Demo read state, all default DOM cursors and README selection. ' + JSON.stringify(cursorEvidence) + '\n');
  }
  assert.deepEqual(errors, []);
  process.stdout.write('PASS: notifications/cursor smoke (' + (runningOnly ? 'minimal running reproduction' : 'full mocked boundary suite') + ', ' + ((Date.now() - started) / 1000).toFixed(1) + 's).\n');
} finally { await app.close(); }
