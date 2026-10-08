import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { installDownloadFixture } from './download-fixture.mjs';

// Real renderer with isolated read fixtures: no account, disk download or remote mutation.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out', 'common-workflows-smoke');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'isolated-'));
const profile = join(run, 'profile');
await mkdir(profile);
const launcher = join(run, 'launch.cjs');
await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
process.env.EASYHUB_PROXY_APP_ONLY_TEST = '1';
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Isolated workflows fixture</title>';
globalThis.workflowsRegister = ipcMain.handle.bind(ipcMain);
globalThis.workflowsForbidden = [];
ipcMain.handle = (channel, handler) => globalThis.workflowsRegister(channel, channel.startsWith('easyhub:') ? () => {
  globalThis.workflowsForbidden.push(channel); throw new Error('Unmocked workflows IPC: ' + channel);
} : handler);
require(${JSON.stringify(join(desktop, 'out', 'main', 'index.js'))});
`);
const app = await electron.launch({ executablePath: electronPath, args: [launcher], cwd: desktop });
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await app.evaluate(({ ipcMain, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const mock = (channel, handler) => { ipcMain.removeHandler(channel); globalThis.workflowsRegister(channel, (_event, ...args) => handler(...args)); };
    const now = new Date().toISOString();
    const repo = id => ({ id, name: `project-${id}`, full_name: `another-author/project-${id}`, owner: { login: 'another-author', avatar_url: '' }, private: false, default_branch: 'main', open_issues_count: 1, updated_at: now });
    const version = { sha: 'a'.repeat(40), commit: { message: 'Historical source snapshot', author: { name: 'Author', date: now } }, author: { login: 'another-author' }, stats: { additions: 2, deletions: 1 }, files: [{ filename: 'main.ts', status: 'modified' }] };
    const otherVersion = { ...version, sha: 'b'.repeat(40), commit: { ...version.commit, message: 'Another historical snapshot' } };
    const issue = { id: 8, number: 8, title: 'Links in a conversation', body: '[Issue documentation](https://example.com/issue-guide)\n\n<details><summary>More information</summary>\n\nSafely rendered details\n\n</details>', state: 'open', created_at: now, user: { login: 'visitor' }, comments: 1 };
    globalThis.workflowsReads = [];
    globalThis.workflowsDownloads = [];
    globalThis.workflowsLinks = [];
    globalThis.workflowsHoldDetails = false;
    globalThis.workflowsCommitResolvers = {};
    globalThis.workflowsCommentResolvers = {};
    mock('easyhub:auth-status', () => ({ user: { login: 'workflow-fixture', name: 'Workflow Fixture', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:open-external-link', url => { globalThis.workflowsLinks.push(url); });
    mock('easyhub:download-archive', (...args) => { globalThis.workflowsDownloads.push(args); return null; });
    mock('easyhub:github', (action, ...args) => {
      globalThis.workflowsReads.push({ action, args });
      if (action === 'repos') return [];
      if (action === 'activityCounts') return Object.fromEntries(args[0].map(item => [item.id, { issues: 1, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }]));
      if (action === 'trending') return { items: [], page: 1, hasNextPage: false };
      if (action === 'searchPublicReposPage') {
        const page = args[1];
        return { items: Array.from({ length: page === 3 ? 1 : 30 }, (_, index) => repo((page - 1) * 30 + index + 1)), page, totalCount: 61, hasNextPage: page < 3, incompleteResults: false };
      }
      if (action === 'searchUsersPage') {
        const page = args[1];
        return { items: Array.from({ length: page === 3 ? 1 : 12 }, (_, index) => ({ id: (page - 1) * 12 + index + 1, login: `person-${(page - 1) * 12 + index + 1}`, avatar_url: '', html_url: '', type: 'User' })), page, totalCount: 25, hasNextPage: page < 3, incompleteResults: false };
      }
      if (action === 'publicRepo' || action === 'repository') return repo(Number(args[1].split('-').at(-1)));
      if (action === 'profile') return { login: args[0], name: args[0], avatar_url: '', html_url: '', public_repos: 1, followers: 1, following: 1 };
      if (action === 'contributions') return { total: 0, years: [new Date().getFullYear()], weeks: [], repositories: [] };
      if (action === 'topStarredRepos') return [repo(1), repo(2), repo(3)];
      if (action === 'readme') return '# Public project\n\nBrowse a project without local operations.';
      if (action === 'isStarred') return false;
      if (action === 'issuesPage') return { items: [issue, { ...issue, id: 10, number: 10, title: 'Another conversation' }], nextPage: null };
      if (action === 'comments') {
        const comments = [{ id: 90 + args[2], body: args[2] === 8 ? '[Comment documentation](https://example.com/comment-guide)' : 'Comment belongs to the second issue', created_at: now, user: { login: 'reviewer' } }];
        if (globalThis.workflowsHoldDetails) return new Promise(resolve => { globalThis.workflowsCommentResolvers[args[2]] = () => resolve(comments); });
        return comments;
      }
      if (action === 'commits') return [version, otherVersion];
      if (action === 'commit') {
        const result = args[2] === version.sha ? version : otherVersion;
        if (globalThis.workflowsHoldDetails) return new Promise(resolve => { globalThis.workflowsCommitResolvers[args[2]] = () => resolve(result); });
        return result;
      }
      throw new Error('Unexpected workflow action: ' + action);
    });
  });
  await installDownloadFixture(app, ['easyhub:download-archive']);
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), join(desktop, 'out', 'renderer', 'index.html'));
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('easyhub:language', 'zh'); });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await page.setViewportSize({ width: 1060, height: 700 });
  await page.locator('.sidebar nav').getByRole('button', { name: '发现', exact: true }).click();
  const search = page.locator('.discover-search input');
  const pager = page.locator('.search-pagination');
  await search.fill('project');
  await page.locator('.trending-card').filter({ hasText: 'project-1' }).first().waitFor();
  assert.equal(await page.locator('.trending-card').count(), 30);
  await pager.getByRole('button', { name: '下一页', exact: true }).click();
  await page.locator('.trending-card strong').filter({ hasText: /^project-31$/ }).waitFor();
  await page.locator('.trending-card').filter({ hasText: 'project-31' }).click();
  await page.getByTestId('public-project-browser').waitFor();
  assert.equal(await page.locator('.public-browser-hero .public-readonly-label').count(), 0);
  await page.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  await page.locator('.trending-card strong').filter({ hasText: /^project-31$/ }).waitFor();
  assert.match(await pager.innerText(), /第 2 页/);
  await pager.getByRole('button', { name: '下一页', exact: true }).click();
  await page.locator('.trending-card strong').filter({ hasText: /^project-61$/ }).waitFor();
  assert.equal(await pager.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
  await search.fill('changed-query');
  await page.locator('.trending-card strong').filter({ hasText: /^project-1$/ }).waitFor();
  assert.match(await pager.innerText(), /第 1 页/);
  await page.getByRole('button', { name: '用户搜索', exact: true }).click();
  await page.locator('.user-search-card').first().waitFor();
  assert.equal(await page.locator('.user-search-card').count(), 12);
  await pager.getByRole('button', { name: '下一页', exact: true }).click();
  await page.locator('.user-search-identity strong').filter({ hasText: /^person-13$/ }).waitFor();
  await page.getByRole('button', { name: '查看 person-13 的主页', exact: true }).click();
  await page.locator('.profile-page').waitFor();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.locator('.user-search-identity strong').filter({ hasText: /^person-13$/ }).waitFor();
  assert.match(await pager.innerText(), /第 2 页/);
  await page.getByRole('button', { name: '项目搜索', exact: true }).click();
  await page.locator('.trending-card strong').filter({ hasText: /^project-1$/ }).waitFor();
  await page.locator('.trending-card').first().click();
  await page.locator('.public-browser-tabs').getByRole('button', { name: '历史版本', exact: true }).click();
  await page.locator('.public-list-row').filter({ hasText: 'Historical source snapshot' }).click();
  await page.getByRole('button', { name: '下载这个版本', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.workflowsDownloads), [['another-author', 'project-1', 'a'.repeat(40)]]);
  await page.getByRole('button', { name: '关闭通知', exact: true }).click();
  // Resolve A after B to prove a late request cannot change the selected download SHA.
  await app.evaluate(() => { globalThis.workflowsHoldDetails = true; });
  await page.getByRole('button', { name: '返回历史版本', exact: true }).click();
  await page.locator('.public-list-row').filter({ hasText: 'Historical source snapshot' }).click();
  await page.getByRole('button', { name: '返回历史版本', exact: true }).click();
  await page.locator('.public-list-row').filter({ hasText: 'Another historical snapshot' }).click();
  await app.evaluate(() => { globalThis.workflowsCommitResolvers['b'.repeat(40)](); });
  await page.waitForFunction(() => !document.querySelector('.public-browser-content .live-loading'));
  await app.evaluate(() => { globalThis.workflowsCommitResolvers['a'.repeat(40)](); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.public-browser-content h2').innerText(), 'Another historical snapshot');
  await page.getByRole('button', { name: '下载这个版本', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.workflowsDownloads.at(-1)), ['another-author', 'project-1', 'b'.repeat(40)]);
  await page.getByRole('button', { name: '关闭通知', exact: true }).click();
  await app.evaluate(() => { globalThis.workflowsHoldDetails = false; });
  await page.locator('.public-browser-tabs').getByRole('button', { name: '问题 1', exact: true }).click();
  await page.locator('.public-list-row').filter({ hasText: 'Links in a conversation' }).click();
  await page.getByRole('link', { name: 'Issue documentation', exact: true }).click();
  await page.getByRole('link', { name: 'Comment documentation', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.workflowsLinks), ['https://example.com/issue-guide', 'https://example.com/comment-guide']);
  assert.equal(await page.locator('.public-issue-detail details').count(), 1);
  assert.equal(await page.locator('.public-issue-detail .conversation > .message').count(), 2);
  for (const message of await page.locator('.public-issue-detail .conversation > .message').all()) assert.ok(await message.locator('.readme-markdown').count() > 0);
  await page.screenshot({ path: join(output, 'public-issue-links.png') });
  await app.evaluate(() => { globalThis.workflowsHoldDetails = true; });
  await page.getByRole('button', { name: '返回问题', exact: true }).click();
  await page.locator('.public-list-row').filter({ hasText: 'Links in a conversation' }).click();
  await page.getByRole('button', { name: '返回问题', exact: true }).click();
  await page.locator('.public-list-row').filter({ hasText: 'Another conversation' }).click();
  await app.evaluate(() => { globalThis.workflowsCommentResolvers[10](); });
  await page.getByText('Comment belongs to the second issue', { exact: true }).waitFor();
  await app.evaluate(() => { globalThis.workflowsCommentResolvers[8](); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByText('Comment belongs to the second issue', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Comment documentation', exact: true }).count(), 0);
  assert.deepEqual(await app.evaluate(() => globalThis.workflowsForbidden), []);
  assert.deepEqual(errors, []);
  console.log('Common workflows passed: search pages and returns, query reset, historical SHA download, issue links, late version/comment isolation.');
} finally { await app.close(); }
