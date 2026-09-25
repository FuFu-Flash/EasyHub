import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: process.cwd() });
try {
  await app.evaluate(({ ipcMain }) => {
    const avatar = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#2874d5"/></svg>').toString('base64')}`;
    const project = { id: 901, name: 'example', full_name: 'writer/example', description: 'A public example', private: false, archived: false, stargazers_count: 321, language: 'TypeScript', pushed_at: new Date().toISOString(), updated_at: new Date().toISOString(), default_branch: 'main', owner: { login: 'writer', avatar_url: '' }, open_issues_count: 0 };
    ipcMain.removeHandler('easyhub:auth-status');
    ipcMain.handle('easyhub:auth-status', () => ({ user: { login: 'tester', name: 'Test User', avatar_url: avatar, html_url: 'https://github.com/tester' }, clientId: 'test-client' }));
    ipcMain.removeHandler('easyhub:github');
    ipcMain.handle('easyhub:github', (_event, action, ...args) => {
      if (action === 'repos') return [];
      if (action === 'profile') return { login: args[0], name: args[0] === 'writer' ? 'Project Writer' : 'Test User', avatar_url: avatar, html_url: `https://github.com/${args[0]}`, followers: 10, following: 2, public_repos: 3, bio: 'Writing software' };
      if (action === 'contributions') return { total: 2, years: [2026, 2025], weeks: [{ contributionDays: [{ date: '2026-09-25', contributionCount: 2, color: '#40c463' }] }], repositories: [{ fullName: 'writer/example', isPrivate: false, count: 2, kind: '更新' }] };
      if (action === 'trending') return { items: [project], page: 1, hasNextPage: false };
      if (action === 'searchUsers') return [{ id: 44, login: 'writer', avatar_url: avatar, html_url: 'https://github.com/writer', type: 'User' }];
      if (action === 'topStarredRepos') return [project];
      if (action === 'publicRepo') return project;
      if (action === 'readme') return '# Public example';
      if (action === 'issues' || action === 'commits') return [];
      throw new Error(`Unexpected API action: ${action}`);
    });
  });
  const page = await app.firstWindow();
  await page.evaluate(() => window.localStorage.setItem('easyhub:search-display-mode', 'compact'));
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await page.locator('.topbar-profile').click();
  await page.locator('.profile-hero').waitFor();
  assert.equal(await page.locator('.profile-avatar').count(), 1);
  await page.screenshot({ path: 'out/profile-smoke.png' });
  await page.locator('.contribution-cell').first().click();
  await page.getByText('2026-09-25 的项目与社交活动').waitFor();
  await page.locator('.profile-repo-row').first().click();
  await page.getByTestId('public-project-browser').waitFor();
  await page.locator('.sidebar-nav button').filter({ hasText: '发现' }).click();
  await page.getByText('EasyHub 热门', { exact: true }).waitFor();
  await page.screenshot({ path: 'out/discover-smoke.png' });
  await page.locator('.trending-card').first().click();
  await page.getByTestId('public-project-browser').waitFor();
  assert.equal(await page.getByTestId('public-project-browser').getByText('发布更新').count(), 0);
  await page.locator('.sidebar-nav button').filter({ hasText: '发现' }).click();
  await page.locator('.discover-scopes button').filter({ hasText: '用户' }).click();
  await page.locator('.discover-search input').fill('writer');
  await page.locator('.user-search-card').waitFor();
  assert.equal(await page.locator('.user-search-avatar img').count(), 1);
  assert.equal(await page.locator('.user-search-project').count(), 0);
  await page.locator('.search-display-switch button').filter({ hasText: '详细' }).click();
  await page.locator('.user-search-project').waitFor();
  await page.screenshot({ path: 'out/user-search-smoke.png' });
  await page.locator('.user-search-profile').click();
  await page.getByText('Project Writer').waitFor();
  await page.locator('.profile-repo-row').first().click();
  await page.getByTestId('public-project-browser').waitFor();
  await page.screenshot({ path: 'out/profile-discover-smoke.png' });
  process.stdout.write('Profile and discovery UI smoke test passed.\n');
} finally { await app.close(); }
