import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: process.cwd() });
try {
  await app.evaluate(({ ipcMain }) => {
    const repo = { id: 77, name: 'wide-readme', full_name: 'tester/wide-readme', description: 'A test project', private: false, archived: false, default_branch: 'main', owner: { login: 'tester', avatar_url: '' }, open_issues_count: 0, updated_at: new Date().toISOString(), pushed_at: new Date().toISOString() };
    ipcMain.removeHandler('easyhub:auth-status');
    ipcMain.handle('easyhub:auth-status', () => ({ user: { login: 'tester', name: 'Tester', avatar_url: '', html_url: 'https://github.com/tester' }, clientId: 'test-client' }));
    ipcMain.removeHandler('easyhub:github');
    ipcMain.handle('easyhub:github', (_event, action) => {
      if (action === 'repos') return [repo];
      if (action === 'readme') return '# Wide README\n\n[Releases](https://github.com/tester/wide-readme/releases/tag/v1.0.0)\n\n| Screenshot A | Screenshot B | Screenshot C |\n|---|---|---|\n| ![A](https://example.com/a.png) | ![B](https://example.com/b.png) | ![C](https://example.com/c.png) |\n\n' + 'A'.repeat(150);
      if (action === 'releases') return [{ id: 1, tag_name: 'v1.0.0', name: 'Version one', body: 'Release notes for testers.', draft: false, prerelease: false, published_at: new Date().toISOString(), assets: [] }];
      if (action === 'issues' || action === 'commits') return [];
      if (action === 'trending' || action === 'searchPublicRepos') return [repo, { ...repo, id: 78, name: 'second' }, { ...repo, id: 79, name: 'third' }];
      if (action === 'searchUsers') return [1, 2, 3].map((id) => ({ id, login: `writer${id}`, avatar_url: '', html_url: `https://github.com/writer${id}`, type: 'User' }));
      if (action === 'topStarredRepos') return [];
      throw new Error(`Unexpected API action: ${action}`);
    });
    ipcMain.removeHandler('easyhub:translate-content');
    ipcMain.handle('easyhub:translate-content', (_event, input) => `译文：${input.text}`);
    ipcMain.removeHandler('easyhub:cancel-translation');
    ipcMain.handle('easyhub:cancel-translation', () => undefined);
  });
  const page = await app.firstWindow();
  await page.evaluate(() => { window.localStorage.removeItem('easyhub:auto-translate'); window.localStorage.removeItem('easyhub:translation-target'); });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await page.locator('.sidebar-nav button').filter({ hasText: '我的项目' }).click();
  await page.getByText('wide-readme').first().click();
  await page.locator('.detail-grid .readme-markdown').first().waitFor();
  const ownReadme = page.locator('.detail-grid .translatable-content').first();
  await page.getByRole('button', { name: '开启翻译' }).click();
  await ownReadme.locator('.translation-paragraph').first().getByText('译文：', { exact: false }).waitFor();
  await page.getByRole('button', { name: '关闭翻译' }).click();
  for (const width of [1600, 1250, 1100, 900, 700, 600]) {
    await page.setViewportSize({ width, height: 800 });
    const sizes = await page.evaluate(() => {
      const primary = document.querySelector('.detail-primary .panel').getBoundingClientRect();
      const side = document.querySelector('.detail-side .panel').getBoundingClientRect();
      const grid = document.querySelector('.detail-grid').getBoundingClientRect();
      const main = document.querySelector('.main-column').getBoundingClientRect();
      return { primary: { left: primary.left, right: primary.right, top: primary.top, bottom: primary.bottom }, side: { left: side.left, right: side.right, top: side.top, bottom: side.bottom }, grid: { right: grid.right }, main: { left: main.left, right: main.right }, pageScrollWidth: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    const overlaps = sizes.primary.left < sizes.side.right && sizes.primary.right > sizes.side.left && sizes.primary.top < sizes.side.bottom && sizes.primary.bottom > sizes.side.top;
    assert.equal(overlaps, false, `Project cards overlap at ${width}px: ${JSON.stringify(sizes)}`);
    assert.ok(sizes.primary.right <= sizes.grid.right + 1, `README panel escapes its grid at ${width}px: ${JSON.stringify(sizes)}`);
    assert.ok(sizes.main.right <= width + 1, `Main column exceeds viewport at ${width}px: ${JSON.stringify(sizes)}`);
    if (width === 700) await page.screenshot({ path: 'out/responsive-detail-smoke.png' });
  }
  assert.equal(await page.getByRole('button', { name: '开启翻译' }).isVisible(), true, 'The translation switch should remain visible in a narrow window');
  await page.getByRole('link', { name: 'Releases' }).click();
  await page.getByRole('heading', { name: '版本下载' }).waitFor();
  await page.getByText('README 提到的版本').waitFor();
  const ownRelease = page.locator('.release-download-card .translatable-content').first();
  await page.getByRole('button', { name: '开启翻译' }).click();
  await ownRelease.getByText('译文：Release notes for testers.', { exact: false }).waitFor();
  await page.getByRole('button', { name: '返回项目' }).click();
  await page.getByRole('button', { name: '下载项目', exact: true }).click();
  await page.getByRole('heading', { name: '版本下载' }).waitFor();
  await page.getByRole('button', { name: '下载源码 ZIP' }).waitFor();
  await page.screenshot({ path: 'out/release-downloads-smoke.png' });
  await page.locator('.sidebar-nav button').filter({ hasText: '发现' }).click();
  await page.locator('.discover-search input').fill('wide');
  await page.locator('.search-result-grid .trending-card').first().waitFor();
  await page.locator('.search-display-switch button').filter({ hasText: '精简' }).click();
  await page.setViewportSize({ width: 1600, height: 800 });
  for (const label of ['精简', '详细']) {
    await page.locator('.search-display-switch button').filter({ hasText: label }).click();
    const boxes = await page.locator('.search-result-grid .trending-card').evaluateAll((cards) => cards.slice(0, 2).map((card) => card.getBoundingClientRect().top));
    assert.equal(boxes[0], boxes[1], `${label} search results should form columns`);
  }
  await page.screenshot({ path: 'out/search-grid-smoke.png' });
  await page.locator('.discover-scopes button').filter({ hasText: '用户搜索' }).click();
  await page.locator('.user-search-card').first().waitFor();
  for (const label of ['精简', '详细']) {
    await page.locator('.search-display-switch button').filter({ hasText: label }).click();
    const boxes = await page.locator('.user-search-card').evaluateAll((cards) => cards.slice(0, 2).map((card) => card.getBoundingClientRect().top));
    assert.equal(boxes[0], boxes[1], `${label} user results should form columns`);
  }
  process.stdout.write('Responsive detail, download navigation, and search grid smoke test passed.\n');
} finally { await app.close(); }
