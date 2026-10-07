import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { smokeExecutable, smokeEnvironment, smokeRenderer } from './smoke-runtime.mjs';

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const executable = smokeExecutable(desktopDirectory);
const outputDirectory = resolve(desktopDirectory, 'out', 'v2-live-regression');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'isolated-'));
const profileDirectory = join(runDirectory, 'profile');
await mkdir(profileDirectory);
const launcherPath = join(runDirectory, 'launch.cjs');

// Set the profile before main creates services. A blank first renderer allows
// the mock bridge to be installed before any auth or GitHub calls occur.
await writeFile(launcherPath, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profileDirectory)});
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Isolated regression fixture</title>';
const fixtureHandle = ipcMain.handle.bind(ipcMain);
globalThis.easyHubV2RegisterMock = fixtureHandle;
globalThis.easyHubV2RejectedIpc = [];
ipcMain.handle = (channel, listener) => fixtureHandle(channel, channel.startsWith('easyhub:') && !['easyhub:window-set-style', 'easyhub:menu-state'].includes(channel) ? () => {
  globalThis.easyHubV2RejectedIpc.push(channel);
  throw new Error('IPC was not explicitly mocked by the regression fixture: ' + channel);
} : listener);
const fixtureFs = require('node:fs/promises');
const fixturePath = require('node:path');
const fixtureHosts = fixturePath.resolve(fixturePath.join(process.env.SystemRoot || 'C:\\\\Windows', 'System32', 'drivers', 'etc', 'hosts')).toLowerCase();
const fixtureReadFile = fixtureFs.readFile;
globalThis.easyHubV2StartupGuards = { hostsReads: 0 };
fixtureFs.readFile = async (target, ...args) => {
  if (typeof target === 'string' && fixturePath.resolve(target).toLowerCase() === fixtureHosts) {
    globalThis.easyHubV2StartupGuards.hostsReads += 1;
    return Buffer.alloc(0);
  }
  return fixtureReadFile(target, ...args);
};
require(${JSON.stringify(join(desktopDirectory, 'out', 'main', 'index.js'))});
`, 'utf8');

let app;
let page;
try {
  app = await electron.launch({ executablePath: executable || electronPath, args: executable ? [] : [launcherPath], cwd: desktopDirectory, env: smokeEnvironment(profileDirectory) });
  assert.equal(await app.evaluate(({ app: runningApp }) => runningApp.getPath('userData')), profileDirectory);
  await app.evaluate(({ BrowserWindow, ipcMain, session }, fixtureDirectory) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('Missing isolated fixture window');
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const now = new Date().toISOString();
    const repository = (id, name) => ({
      id, name, full_name: `fixture-user/${name}`, description: `Description of ${name}, not a commit`,
      private: false, archived: false, default_branch: 'main', owner: { login: 'fixture-user', avatar_url: '' },
      open_issues_count: 999, updated_at: now, pushed_at: now, permissions: { push: true, pull: true, admin: true },
      stargazers_count: 3, language: 'TypeScript',
    });
    const fixture = globalThis.easyHubV2Regression = {
      repos: [repository(701, 'active-project'), repository(702, 'quiet-project')],
      counts: { 701: { issues: 2, closedIssues: 0, pullRequests: 1, closedPullRequests: 0 },
        702: { issues: 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 } },
      links: [
        { id: 'fixture-current', repositoryId: 701, owner: 'fixture-user', name: 'active-project', localPath: `${fixtureDirectory}/active-project`, lastOpenedAt: now },
        { id: 'fixture-remote', repositoryId: 702, owner: 'fixture-user', name: 'quiet-project', localPath: `${fixtureDirectory}/quiet-project`, lastOpenedAt: now },
      ],
      reads: [], forbidden: [], pendingStatuses: [], pendingCounts: [], deferStatuses: true, deferCounts: true, failIssues: true,
      statuses: { 'fixture-current': { files: [], needsReview: false }, 'fixture-remote': { files: [], needsReview: false } },
      previews: { 'fixture-current': { state: 'current', changedFiles: 0, files: [] },
        'fixture-remote': { state: 'ready', changedFiles: 1, files: [], remoteRevision: 'b'.repeat(40) } },
    };
    globalThis.easyHubV2RegisterMock ??= ipcMain.handle.bind(ipcMain);
    globalThis.easyHubV2RejectedIpc ??= [];
    globalThis.easyHubV2StartupGuards ??= { hostsReads: 0 };
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      globalThis.easyHubV2RegisterMock(channel, (event, ...args) => {
        if (event.sender !== window.webContents) throw new Error('Fixture bridge used from another window');
        return handler(...args);
      });
    };
    mock('easyhub:auth-status', () => ({
      user: { login: 'fixture-user', name: 'Fixture User', avatar_url: '', html_url: 'https://example.invalid/user' }, clientId: 'fixture-client',
    }));
    mock('easyhub:ai-settings', () => ({ enabled: false, hasKey: false, baseUrl: '', model: '' }));
    mock('easyhub:hosts-status', () => ({ enabled: false, updatedAt: null, source: 'fixture' }));
    mock('easyhub:local-list', () => fixture.links);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:local-status', (id) => {
      fixture.reads.push({ action: 'localStatus', id });
      if (fixture.deferStatuses) return new Promise((resolveStatus) => fixture.pendingStatuses.push({ id, resolveStatus }));
      return fixture.statuses[id];
    });
    mock('easyhub:local-check-sync', (id) => fixture.previews[id]);
    mock('easyhub:local-read-introduction', () => '# Fixture introduction\n\nREADME content survived an unrelated issue failure.');
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:translate-content', (request) => request.text);
    mock('easyhub:cancel-translation', () => undefined);
    mock('easyhub:github', (action, ...args) => {
      fixture.reads.push({ action, args });
      const name = args[1];
      if (action === 'repos') return args[0] === 1 ? fixture.repos : [];
      if (action === 'activityCounts') {
        if (fixture.deferCounts) return new Promise((resolveCounts) => fixture.pendingCounts.push(resolveCounts));
        return fixture.counts;
      }
      if (action === 'readme') return '# Fixture introduction\n\nREADME content survived an unrelated issue failure.';
      if (action === 'commits') return [{ sha: name === 'active-project' ? 'a'.repeat(40) : 'b'.repeat(40),
        commit: { message: `Actual commit for ${name}\n\nDetailed commit body.`, author: { name: 'Fixture User', date: now } }, author: { login: 'fixture-user' } }];
      if (action === 'commit') return { sha: args[2], files: [],
        commit: { message: `Actual commit for ${name}\n\nDetailed commit body.`, author: { name: 'Fixture User', date: now } }, author: { login: 'fixture-user' } };
      if (action === 'issuesPage') {
        if (fixture.failIssues && name === 'active-project') throw new Error('Fixture issuesPage failed');
        return { items: [], nextPage: null };
      }
      if (action === 'isStarred') return false;
      if (action === 'pullRequests' || action === 'pullRequestsPage') return name === 'active-project' ? [{
        id: 7011, number: 1, title: 'Fixture improvement', body: 'A read only mock request', state: 'open', draft: false,
        merged: false, merged_at: null, created_at: now, user: { login: 'contributor' }, comments: 0,
        head: { ref: 'improve', label: 'contributor:improve', sha: 'c'.repeat(40) }, base: { ref: 'main', sha: 'd'.repeat(40) },
      }] : [];
      if (action === 'trending') return { items: fixture.repos, page: 1, hasNextPage: false };
      if (action === 'searchPublicRepos') return fixture.repos;
      if (action === 'releases' || action === 'comments') return [];
      fixture.forbidden.push(action);
      throw new Error(`Unexpected GitHub action in isolated fixture: ${action}`);
    });
  }, runDirectory);

  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(async ({ BrowserWindow }, rendererPath) => {
    await BrowserWindow.getAllWindows()[0].loadFile(rendererPath);
  }, smokeRenderer(desktopDirectory, executable));
  await page.locator('.live-connected').waitFor();
  const homeRows = page.locator('.home-project-row');
  await homeRows.last().waitFor();
  assert.equal(await homeRows.count(), 2);
  await page.locator('.home-all-saved.checking').waitFor();
  assert.equal(await page.getByText('你的项目已经全部保存。', { exact: true }).count(), 0);
  assert.equal(await homeRows.locator('.home-row-status.checking').count(), 2);
  assert.equal(await homeRows.getByText(/… 个问题/).count(), 2, 'Unresolved activity counts must display an ellipsis');
  const overview = page.getByRole('region', { name: '项目概览', exact: true });
  assert.equal(await overview.getByRole('button', { name: /尚未发布的文件/ }).locator('strong').innerText(), '…');
  assert.equal(await overview.getByRole('button', { name: /待处理的反馈与改进/ }).locator('strong').innerText(), '…');
  await page.screenshot({ path: join(outputDirectory, 'home-checking.png') });

  await app.evaluate(() => {
    const fixture = globalThis.easyHubV2Regression;
    fixture.deferStatuses = false;
    fixture.deferCounts = false;
    for (const { id, resolveStatus } of fixture.pendingStatuses.splice(0)) resolveStatus(fixture.statuses[id]);
    for (const resolveCounts of fixture.pendingCounts.splice(0)) resolveCounts(fixture.counts);
  });
  await page.locator('.home-all-saved.remote').waitFor();
  const currentHome = homeRows.filter({ hasText: 'active-project' }).locator('.home-row-status');
  const remoteHome = homeRows.filter({ hasText: 'quiet-project' }).locator('.home-row-status');
  await currentHome.filter({ hasText: '已保存到 GitHub' }).waitFor();
  await remoteHome.filter({ hasText: 'GitHub 上有新内容' }).waitFor();
  const homeStatuses = [await currentHome.innerText(), await remoteHome.innerText()];
  await page.locator('.home-recent-row').first().waitFor();
  assert.deepEqual(await page.locator('.home-recent-row em').allTextContents(), [
    'Actual commit for active-project', 'Actual commit for quiet-project',
  ]);
  await page.screenshot({ path: join(outputDirectory, 'home-resolved.png') });
  await page.locator('.home-recent-row').first().click();
  await page.getByRole('heading', { name: 'Actual commit for active-project', exact: true }).waitFor();
  await page.getByRole('button', { name: '最近更新', exact: true }).click();
  await page.getByRole('heading', { name: '最近更新', exact: true }).waitFor();
  assert.equal(await page.locator('.history-row').count(), 2);
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.locator('.v2-dashboard-intro').waitFor();

  const notifications = page.getByRole('button', { name: '通知', exact: true });
  const badge = page.locator('.download-notification-count');
  await badge.getByText('2', { exact: true }).waitFor();
  await notifications.click();
  const notificationDialog = page.getByRole('dialog', { name: '通知', exact: true });
  await notificationDialog.waitFor();
  await badge.waitFor({ state: 'hidden' });
  assert.equal(await notificationDialog.locator('.activity-notification-item').count(), 2, 'Reading notifications must retain the tasks');
  await notificationDialog.getByRole('button', { name: '关闭通知', exact: true }).click();
  await notifications.click();
  assert.equal(await notificationDialog.locator('.activity-notification-item').count(), 2);
  assert.equal(await badge.count(), 0);
  await notificationDialog.getByRole('button', { name: '关闭通知', exact: true }).click();
  await app.evaluate(() => { globalThis.easyHubV2Regression.counts[701].issues = 3; });
  await page.getByRole('button', { name: '刷新 GitHub 数据', exact: true }).click();
  await badge.getByText('1', { exact: true }).waitFor();
  await notifications.click();
  await notificationDialog.getByText('active-project 有 3 个待处理的问题', { exact: true }).waitFor();
  await badge.waitFor({ state: 'hidden' });
  await notificationDialog.getByRole('button', { name: '关闭通知', exact: true }).click();

  const navigation = page.getByRole('navigation', { name: '主导航', exact: true });
  await navigation.getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: '这台电脑 2', exact: true }).click();
  const localCards = page.locator('.project-card');
  await localCards.last().waitFor();
  await localCards.filter({ hasText: 'quiet-project' }).locator('.status-remote').waitFor();
  assert.equal(await localCards.filter({ hasText: 'active-project' }).locator('.status').innerText(), homeStatuses[0]);
  assert.equal(await localCards.filter({ hasText: 'quiet-project' }).locator('.status').innerText(), homeStatuses[1]);
  await localCards.filter({ hasText: 'active-project' }).getByRole('button', { name: '查看详情', exact: true }).click();
  await page.locator('.detail-primary').getByRole('heading', { name: 'Fixture introduction', exact: true }).waitFor();
  await page.getByText('部分反馈或历史版本暂时无法加载，请刷新重试。', { exact: true }).waitFor();
  assert.equal(await page.locator('.detail-primary').getByText('这个项目还没有介绍。', { exact: true }).count(), 0);
  const reviewSide = page.locator('.detail-side .side-panel').filter({ has: page.getByRole('heading', { name: '代码提交审查', exact: true }) });
  assert.equal(await reviewSide.locator('.count-bubble').innerText(), '1');
  await reviewSide.getByRole('button', { name: '审阅改进请求', exact: false }).click();
  await page.locator('.pull-requests-panel').getByText('Fixture improvement', { exact: true }).waitFor();
  assert.equal(await page.getByText('部分反馈或历史版本暂时无法加载，请刷新重试。', { exact: true }).count(), 0, 'A project loading error must clear when leaving the project page');
  assert.equal(await page.getByRole('tab', { name: process.platform === 'darwin' ? '合并请求审查 1' : '代码提交审查 1', exact: true }).getAttribute('aria-selected'), 'true');

  await navigation.getByRole('button', { name: /^问题/ }).click();
  await page.getByRole('heading', { name: '问题', exact: true }).waitFor();
  let groups = page.locator('.issue-project-group');
  assert.equal(await groups.count(), 1, 'Repos with no issues should be folded by default');
  assert.equal(await groups.locator('.issue-project-heading strong').innerText(), 'active-project');
  const otherIssues = page.getByRole('button', { name: '查看其他项目 1', exact: true });
  assert.equal(await otherIssues.getAttribute('aria-expanded'), 'false');
  await otherIssues.focus();
  await page.keyboard.press('Enter');
  assert.equal(await groups.count(), 2);
  assert.equal(await page.getByRole('button', { name: '收起其他项目 1', exact: true }).getAttribute('aria-expanded'), 'true');
  await page.getByRole('button', { name: '收起其他项目 1', exact: true }).click();
  await page.getByRole('tab', { name: process.platform === 'darwin' ? '合并请求审查 1' : '代码提交审查 1', exact: true }).click();
  assert.equal(await groups.count(), 1, 'Repos with no reviews should be folded by default');
  assert.equal(await groups.locator('.issue-project-heading strong').innerText(), 'active-project');
  const otherReviews = page.getByRole('button', { name: '查看其他项目 1', exact: true });
  assert.equal(await otherReviews.getAttribute('aria-expanded'), 'false');
  await otherReviews.focus();
  await page.keyboard.press('Space');
  assert.equal(await groups.count(), 2);
  await page.getByRole('button', { name: '收起其他项目 1', exact: true }).click();

  await navigation.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索项目/用户', exact: true }).pressSequentially('project', { delay: 20 });
  await page.locator('.discover-page').waitFor();
  assert.equal(await page.getByText('部分反馈或历史版本暂时无法加载，请刷新重试。', { exact: true }).count(), 0);
  assert.equal(await page.locator('.topbar-search input').count(), 0, 'Discover must not duplicate its search field in the topbar');
  assert.equal(await page.locator('.discover-search input').count(), 1);
  assert.equal(await page.getByRole('textbox', { name: '搜索公开项目', exact: true }).inputValue(), 'project', 'Typing must continue after the first character moves search into Discover');
  assert.equal(await page.locator('.discover-search input').evaluate((input) => input === document.activeElement), true);
  const displayMode = page.getByRole('group', { name: '结果显示方式', exact: true });
  await displayMode.waitFor();
  await page.locator('.search-result-grid .trending-card').first().waitFor();
  assert.equal(await page.locator('.discover-results-toolbar').evaluate((toolbar) => Boolean(
    toolbar.compareDocumentPosition(document.querySelector('.search-result-grid')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  await displayMode.getByRole('button', { name: '详细', exact: true }).click();
  assert.equal(await displayMode.getByRole('button', { name: '详细', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.search-result-grid.detailed .trending-card').count(), 2);
  await displayMode.getByRole('button', { name: '精简', exact: true }).click();
  assert.equal(await page.locator('.search-result-grid.compact .trending-card.compact').count(), 2);
  await page.setViewportSize({ width: 1060, height: 700 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'Supported minimum window must not overflow');
  assert.ok(await page.locator('.v2-page-transition').evaluate((element) => getComputedStyle(element).animationDuration
    .split(',').every((value) => parseFloat(value) <= 0.001)), 'Reduced motion should disable visible page animations');
  await page.screenshot({ path: join(outputDirectory, 'discover-minimum.png') });

  // More than eight activity tasks: add four read-only fixture repositories and
  // refresh through the real navigation action rather than injecting React state.
  await navigation.getByRole('button', { name: '首页', exact: true }).click();
  await app.evaluate(() => {
    const fixture = globalThis.easyHubV2Regression;
    for (let index = 0; index < 4; index++) {
      const id = 710 + index;
      const name = `extra-project-${index}`;
      fixture.repos.push({ ...fixture.repos[0], id, name, full_name: `fixture-user/${name}` });
      fixture.counts[id] = { issues: 1, closedIssues: 0, pullRequests: 1, closedPullRequests: 0 };
    }
  });
  await page.getByRole('button', { name: '刷新 GitHub 数据', exact: true }).click();
  await badge.getByText('8', { exact: true }).waitFor();
  await notifications.click();
  assert.equal(await notificationDialog.locator('.activity-notification-item').count(), 10, 'All activity tasks must render, including those beyond eight');
  await badge.waitFor({ state: 'hidden' });
  await notificationDialog.getByRole('button', { name: '关闭通知', exact: true }).click();
  assert.deepEqual(errors, []);
  const metrics = await app.evaluate(() => ({ forbidden: globalThis.easyHubV2Regression.forbidden,
    actions: globalThis.easyHubV2Regression.reads.map((item) => item.action) }));
  assert.deepEqual(metrics.forbidden, [], 'The regression test must not invoke account, file, or GitHub mutations');
  assert.deepEqual(await app.evaluate(() => globalThis.easyHubV2RejectedIpc), [], 'Every tested IPC action must use an explicit local mock');
  assert.equal(await app.evaluate(() => globalThis.easyHubV2StartupGuards.hostsReads), 0, 'App proxy must not access system hosts at startup');
  await writeFile(join(outputDirectory, 'result.json'), JSON.stringify({ passed: true, reads: metrics.actions.length }, null, 2));
  console.log(`V2 live Electron regression checks passed. Screenshots: ${outputDirectory}`);
} catch (cause) {
  if (page) await page.screenshot({ path: join(outputDirectory, 'failure.png') }).catch(() => undefined);
  throw cause;
} finally {
  if (app) await app.close();
  // Only the temporary directory created by this invocation can be removed.
  assert.equal(dirname(resolve(runDirectory)), outputDirectory);
  assert.ok(runDirectory.startsWith(join(outputDirectory, 'isolated-')));
  await rm(runDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
