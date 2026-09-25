import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: process.cwd() });
try {
  await app.evaluate(({ ipcMain }) => {
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
} finally { await app.close(); }
