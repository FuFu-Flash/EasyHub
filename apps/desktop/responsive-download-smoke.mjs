import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const testUserData = await mkdtemp(join(tmpdir(), 'easyhub-responsive-smoke-'));
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, EASYHUB_TEST_MODE: '1', EASYHUB_TEST_USER_DATA: testUserData },
}).catch(async (error) => { await rm(testUserData, { recursive: true, force: true }); throw error; });
try {
  await app.evaluate(({ ipcMain }) => {
    const repo = { id: 77, name: 'wide-readme', full_name: 'tester/wide-readme', description: 'A test project', private: false, archived: false, default_branch: 'main', owner: { login: 'tester', avatar_url: '' }, open_issues_count: 0, updated_at: new Date().toISOString(), pushed_at: new Date().toISOString() };
    ipcMain.removeHandler('easyhub:auth-status');
    ipcMain.handle('easyhub:auth-status', () => ({ user: { login: 'tester', name: 'Tester', avatar_url: '', html_url: 'https://github.com/tester' }, clientId: 'test-client' }));
    ipcMain.removeHandler('easyhub:github');
    ipcMain.handle('easyhub:github', (_event, action) => {
      if (action === 'repos') return [repo];
      if (action === 'readme') return '# Wide README\n\n[Releases](https://github.com/tester/wide-readme/releases/tag/v1.0.0)\n\n| Screenshot A | Screenshot B | Screenshot C |\n|---|---|---|\n| ![A](https://example.com/a.png) | ![B](https://example.com/b.png) | ![C](https://example.com/c.png) |\n\n' + 'A'.repeat(150);
      if (action === 'releases' || action === 'releasesPage') {
        const items = [{ id: 1, tag_name: 'v1.0.0', name: 'Version one', body: 'Release notes for testers.', draft: false, prerelease: false, published_at: new Date().toISOString(), assets: [] }];
        return action === 'releasesPage' ? { items, nextPage: null } : items;
      }
      if (action === 'issuesPage') return { items: [], nextPage: null };
      if (action === 'issues' || action === 'commits') return [];
      if (action === 'trending') return { items: [repo, { ...repo, id: 78, name: 'second' }, { ...repo, id: 79, name: 'third' }], page: 1, hasNextPage: false };
      if (action === 'searchPublicRepos') return [repo, { ...repo, id: 78, name: 'second' }, { ...repo, id: 79, name: 'third' }];
      if (action === 'searchPublicReposPage') return { items: [repo, { ...repo, id: 78, name: 'second' }, { ...repo, id: 79, name: 'third' }], page: 1, totalCount: 3, hasNextPage: false, incompleteResults: false };
      if (action === 'searchUsers') return [1, 2, 3].map((id) => ({ id, login: `writer${id}`, avatar_url: '', html_url: `https://github.com/writer${id}`, type: 'User' }));
      if (action === 'searchUsersPage') return { items: [1, 2, 3].map((id) => ({ id, login: `writer${id}`, avatar_url: '', html_url: `https://github.com/writer${id}`, type: 'User' })), page: 1, totalCount: 3, hasNextPage: false, incompleteResults: false };
      if (action === 'topStarredRepos') return [];
      throw new Error(`Unexpected API action: ${action}`);
    });
    ipcMain.removeHandler('easyhub:translate-content');
    ipcMain.handle('easyhub:translate-content', (_event, input) => `译文：${input.text}`);
    ipcMain.removeHandler('easyhub:cancel-translation');
    ipcMain.handle('easyhub:cancel-translation', () => undefined);
  });
  const page = await app.firstWindow();
  // All repository actions use the local IPC fixture; remote README images
  // must not make this layout-only regression test contact external hosts.
  await page.route(/^https?:\/\//, (route) => route.abort());
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const settleLayout = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function assertScrollCueDoesNotCoverControls(context) {
    const covered = await page.evaluate(() => {
      const cue = document.querySelector('.scroll-down-cue');
      if (!cue) return [];
      const cueBox = cue.getBoundingClientRect();
      return [...document.querySelectorAll('.page-content button, .page-content a, .page-content input, .page-content textarea, .page-content select')]
        .filter((control) => {
          const box = control.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0
            && box.left < cueBox.right && box.right > cueBox.left && box.top < cueBox.bottom && box.bottom > cueBox.top;
        })
        .map((control) => (control.textContent || control.getAttribute('aria-label') || control.tagName).trim());
    });
    assert.deepEqual(covered, [], `Scroll hint covers controls in ${context}: ${covered.join(', ')}`);
  }
  await page.evaluate(() => { window.localStorage.removeItem('easyhub:auto-translate'); window.localStorage.removeItem('easyhub:translation-target'); });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await page.locator('.sidebar-nav button').filter({ hasText: '我的项目' }).click();
  await page.locator('.cloud-row').filter({ hasText: 'wide-readme' }).getByRole('button', { name: '查看', exact: true }).click();
  await page.locator('.detail-grid .readme-markdown').first().waitFor();
  const ownReadme = page.locator('.detail-grid .translatable-content').first();
  await page.getByRole('button', { name: '开启翻译' }).click();
  await ownReadme.locator('.translation-paragraph').first().getByText('译文：', { exact: false }).waitFor();
  await page.getByRole('button', { name: '关闭翻译' }).click();
  for (const width of [1600, 1250, 1100, 900, 700, 600]) {
    await page.setViewportSize({ width, height: 800 });
    await settleLayout();
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
    if (width <= 700) {
      const actionButtons = await page.locator('.detail-actions button').evaluateAll((buttons) => buttons.map((button) => ({ label: button.textContent.trim(), height: button.getBoundingClientRect().height })));
      assert.ok(actionButtons.length >= 3, 'The project detail actions must be present for the size check');
      for (const button of actionButtons) assert.ok(button.height >= 36 && button.height <= 68, `${button.label} has an unusable ${button.height}px height at ${width}px`);
      await page.getByRole('button', { name: '向下滚动', exact: true }).waitFor();
    }
    await assertScrollCueDoesNotCoverControls(`${width}px project detail`);
    if (width === 700) await page.screenshot({ path: 'out/responsive-detail-smoke.png' });
    if (width === 600) await page.screenshot({ path: 'out/responsive-detail-600-smoke.png' });
  }
  const scrollBeforeHint = await page.locator('.main-column').evaluate((area) => area.scrollTop);
  await page.getByRole('button', { name: '向下滚动', exact: true }).click();
  await page.waitForFunction((before) => document.querySelector('.main-column').scrollTop > before + 20, scrollBeforeHint);
  await page.locator('.main-column').evaluate((area) => area.scrollTo({ top: 0, behavior: 'instant' }));
  assert.equal(await page.getByRole('button', { name: '开启翻译' }).isVisible(), true, 'The translation switch should remain visible in a narrow window');
  await page.getByRole('link', { name: 'Releases' }).click();
  await page.getByRole('heading', { name: '下载发行版或源码' }).waitFor();
  await page.getByText('README 提到的版本').waitFor();
  await page.getByTestId('release-downloads').getByRole('button', { name: '展开完整说明', exact: true }).first().click();
  const ownRelease = page.locator('.release-download-card .translatable-content').first();
  await page.getByRole('button', { name: '开启翻译' }).click();
  await ownRelease.getByText('译文：Release notes for testers.', { exact: false }).waitFor();
  await page.getByRole('button', { name: '返回项目' }).click();
  await page.getByRole('button', { name: '编辑发行版', exact: true }).click();
  await page.getByRole('heading', { name: '编辑发行版', exact: true }).waitFor();
  await page.getByTestId('release-edit-panel').waitFor();
  await page.getByRole('button', { name: '下载源码 ZIP' }).waitFor();
  const previewButton = page.getByRole('button', { name: '预览效果', exact: true });
  await previewButton.evaluate((button) => {
    const area = document.querySelector('.main-column');
    area.scrollTo({ top: area.scrollTop + button.getBoundingClientRect().top - (innerHeight - 65), behavior: 'instant' });
  });
  await settleLayout();
  await page.getByRole('button', { name: '向下滚动', exact: true }).waitFor();
  await assertScrollCueDoesNotCoverControls('release editor footer');
  await previewButton.click();
  await page.locator('.release-edit-preview').waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
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
  process.stdout.write('Responsive detail button sizes, unobstructed scroll hint, download navigation, and search grid smoke test passed.\n');
} finally { await app.close(); await rm(testUserData, { recursive: true, force: true }); }
