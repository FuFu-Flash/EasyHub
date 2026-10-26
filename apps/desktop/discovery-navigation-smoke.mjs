import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const desktop = dirname(fileURLToPath(import.meta.url));
const product = process.argv.includes('--packaged') ? join(desktop,'release/windows/win-unpacked/resources/app.asar') : desktop;
const profile = await mkdtemp(join(tmpdir(),'easyhub-discovery-navigation-'));
const bootstrap = join(profile,'bootstrap.cjs');
await writeFile(bootstrap, `const{app}=require('electron');app.setPath('userData',${JSON.stringify(join(profile,'data'))});process.env.EASYHUB_PROXY_APP_ONLY_TEST='1';process.env.ELECTRON_RENDERER_URL='data:text/html,Discovery fixture';require(${JSON.stringify(join(product,'out/main/index.js'))});`);
const env = { ...process.env, NODE_OPTIONS: '' }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath, args: [bootstrap], cwd: desktop, env });
try {
  await app.evaluate(({ ipcMain, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
    for (const channel of ['easyhub:local-list','easyhub:downloads-list']) { ipcMain.removeHandler(channel); ipcMain.handle(channel,()=>[]); }
    const projects = Array.from({ length: 65 }, (_, index) => ({
      id: index + 1, name: `sample-${index + 1}`, full_name: `writer/sample-${index + 1}`,
      description: `Public sample ${index + 1}`, private: false, archived: false,
      stargazers_count: 500 - index, language: 'TypeScript',
      pushed_at: new Date().toISOString(), updated_at: new Date().toISOString(), default_branch: 'main',
      owner: { login: 'writer', avatar_url: '' }, open_issues_count: 0,
    }));
    ipcMain.removeHandler('easyhub:auth-status');
    ipcMain.handle('easyhub:auth-status', () => ({ user: { login: 'tester', name: 'Test User', avatar_url: '', html_url: 'https://github.com/tester' }, clientId: 'test-client' }));
    ipcMain.removeHandler('easyhub:github');
    ipcMain.handle('easyhub:github', (_event, action, ...args) => {
      if (action === 'repos') return [];
      if (action === 'activityCounts') return Object.fromEntries((args[0] ?? []).map(repo=>[repo.id,{issues:0,closedIssues:0,pullRequests:0,closedPullRequests:0}]));
      if (action === 'trending') {
        const page = args[1] ?? 1;
        return { items: projects.slice((page - 1) * 30, page * 30), page, hasNextPage: page * 30 < projects.length };
      }
      if (action === 'publicRepo') return projects.find((project) => project.name === args[1]);
      if (action === 'readme') return '# Public sample';
      if (action === 'issues' || action === 'commits') return [];
      throw new Error(`Unexpected API action: ${action}`);
    });
  });
  const page = await app.firstWindow();
  await page.goto('file:///'+join(product,'out/renderer/index.html').replaceAll('\\','/'));
  await page.locator('.live-connected').waitFor();
  await page.locator('.sidebar-nav button').filter({ hasText: '发现' }).click();
  await page.locator('.trending-card').nth(25).scrollIntoViewIfNeeded();
  const before = await page.locator('.main-column').evaluate((node) => node.scrollTop);
  assert.ok(before > 500, 'The discovery list did not scroll far enough to test restoration.');
  await page.locator('.trending-card').nth(25).click();
  const during = await page.locator('.main-column').evaluate((node) => node.scrollTop);
  await page.getByTestId('public-project-browser').getByRole('button', { name: '返回搜索结果' }).click();
  await page.locator('.trending-card').nth(25).waitFor();
  const after = await page.locator('.main-column').evaluate((node) => node.scrollTop);
  assert.ok(Math.abs(after - before) < 80, `Discovery position was lost: before=${before}, during=${during}, after=${after}`);
  await page.locator('.sidebar-nav button').filter({ hasText: '首页' }).click();
  await page.locator('.sidebar-nav button').filter({ hasText: '发现' }).click();
  await page.locator('.trending-card').nth(25).waitFor();
  const afterSidebar = await page.locator('.main-column').evaluate((node) => node.scrollTop);
  assert.ok(Math.abs(afterSidebar - before) < 80, `Discovery position was lost through the sidebar: before=${before}, after=${afterSidebar}`);
  await page.getByRole('button', { name: '下一页' }).click();
  await page.getByText('#31', { exact: true }).waitFor();
  assert.equal(await page.locator('.trending-card').count(), 30);
  await page.getByRole('button', { name: '下一页' }).click();
  await page.getByText('#61', { exact: true }).waitFor();
  assert.equal(await page.locator('.trending-card').count(), 5);
  assert.equal(await page.getByRole('button', { name: '下一页' }).isDisabled(), true);
  await page.locator('.trending-card').first().click();
  await page.getByTestId('public-project-browser').getByRole('button', { name: '返回搜索结果' }).click();
  await page.getByText('#61', { exact: true }).waitFor();
  await page.getByRole('button', { name: '上一页' }).click();
  await page.getByText('#31', { exact: true }).waitFor();
  process.stdout.write('Discovery return position passed.\n');
} finally {
  await app.close();
  const target=resolve(profile);
  if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('easyhub-discovery-navigation-'))throw Error('Unexpected discovery fixture cleanup path');
  await rm(target,{recursive:true,force:true});
}
