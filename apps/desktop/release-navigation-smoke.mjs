import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchUpstreamFixture } from './upstream-smoke-runtime.mjs';
import { installDownloadFixture } from './download-fixture.mjs';

// Real built renderer with isolated IPC. Covers only stale favorites and a
// delayed publication failure crossing repository navigation. Network is denied.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out', 'release-navigation-smoke');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'isolated-'));
const { app, executable, renderer } = await launchUpstreamFixture(desktop, {
  profile: join(run, 'profile'), launcher: join(run, 'launch.cjs'),
  registerName: 'registerFixture', rejectedName: 'upstreamRejectedIPC', title: 'Release navigation fixture'
});
try {
  await app.evaluate(({ ipcMain, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const mock = (channel, handler) => { ipcMain.removeHandler(channel); globalThis.registerFixture(channel, (_event, ...args) => handler(...args)); };
    const now = new Date().toISOString();
    const repository = (id, name) => ({ id, name, full_name: 'tester/' + name, owner: { login: 'tester', avatar_url: '' }, description: name + ' documentation', private: false, default_branch: 'main', updated_at: now, open_issues_count: 0, permissions: { push: true, admin: true } });
    const a = repository(1, 'repository-a'); const b = repository(2, 'repository-b');
    const repos = [a, b]; const starred = new Set();
    const fixture = globalThis.releaseNavigationFixture = { starredReads: 0, starChanges: [], publishCalls: [], publishedB: null };
    mock('easyhub:auth-status', () => ({ user: { id: 1, login: 'tester', name: 'Tester', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:github', (action, ...args) => {
      if (action === 'repos') return repos;
      if (action === 'activityCounts') return { 1: { issues: 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }, 2: { issues: 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 } };
      if (action === 'readme') return '# ' + args[1] + '\n\nProject documentation.';
      if (action === 'issuesPage') return { items: [], nextPage: null };
      if (['issues', 'commits', 'comments', 'pulls'].includes(action)) return [];
      if (action === 'isStarred') return starred.has(args[1]);
      if (action === 'setStarred') { fixture.starChanges.push(args); if (args[2]) starred.add(args[1]); else starred.delete(args[1]); return undefined; }
      if (action === 'starredRepos') { fixture.starredReads++; return repos.filter(repo => starred.has(repo.name)); }
      if (action === 'releases') return args[1] === b.name && fixture.publishedB ? [fixture.publishedB] : [];
      if (action === 'releasesPage') return { items: args[1] === b.name && fixture.publishedB ? [fixture.publishedB] : [], nextPage: null };
      throw new Error('Unexpected action: ' + action);
    });
    mock('easyhub:release-publish', (input) => {
      fixture.publishCalls.push(input);
      if (input.repo === a.name) return new Promise(resolve => {
        fixture.failA = () => resolve({ status: 'failed', error: 'A_REPOSITORY_ONLY_PUBLICATION_FAILURE', completedAssetIds: [], remainingAssetIds: [], retryable: false,
          residualDraft: { id: 91, title: 'A residual draft', tagName: input.tagName, url: 'https://github.com/tester/repository-a/releases/edit/91' } });
      });
      if (input.repo !== b.name) throw new Error('Unexpected publication repo');
      fixture.publishedB = { id: 92, tag_name: input.tagName, name: input.title, body: input.body, draft: false, prerelease: false, published_at: now, assets: [], html_url: 'https://github.com/tester/repository-b/releases/tag/' + input.tagName };
      return fixture.publishedB;
    });
  });
  await installDownloadFixture(app, []);
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('easyhub:language', 'zh'); localStorage.setItem('easyhub:auto-translate', 'false'); });
  await app.evaluate(async ({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), renderer);
  await page.locator('.live-connected').waitFor();
  await page.setViewportSize({ width: 1060, height: 720 });
  const openStarred = async () => {
    await page.getByRole('button', { name: '账户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '我收藏的项目', exact: true }).click();
    await page.locator('.starred-projects-page').waitFor();
  };
  const openRepository = async name => {
    await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
    if (await page.locator('.detail-hero').isVisible()) await page.getByRole('button', { name: '所有项目', exact: true }).click();
    await page.locator('.cloud-row').filter({ has: page.getByRole('button', { name, exact: true }) }).getByRole('button', { name: '查看', exact: true }).click();
    await page.locator('.detail-hero').getByRole('heading', { name, exact: true }).waitFor();
  };

  await openStarred();
  await page.getByRole('heading', { name: '还没有收藏的项目', exact: true }).waitFor();
  await openRepository('repository-a');
  await page.getByRole('button', { name: '收藏项目', exact: true }).click();
  await page.getByRole('button', { name: '已收藏', exact: true }).waitFor();
  await openStarred();
  await page.locator('.starred-project-card').getByText('repository-a', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '还没有收藏的项目', exact: true }).count(), 0, 'Reopening favorites replaces its previous empty state');
  assert.equal(await app.evaluate(() => globalThis.releaseNavigationFixture.starredReads), 2, 'Every explicit account-menu entry refreshes favorites');
  assert.deepEqual(await app.evaluate(() => globalThis.releaseNavigationFixture.starChanges), [['tester', 'repository-a', true]]);

  await openRepository('repository-a');
  await page.getByRole('button', { name: '发布新版本', exact: true }).click();
  await page.getByRole('textbox', { name: '版本名称', exact: true }).fill('Repository A release');
  await page.getByRole('textbox', { name: '版本介绍', exact: true }).fill('A release awaiting publication.');
  await page.getByRole('button', { name: '预览发布效果', exact: true }).click();
  await page.getByRole('button', { name: '确认发布新版本', exact: true }).click();
  await page.getByRole('button', { name: '正在发布…', exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.releaseNavigationFixture.publishCalls.length), 1);
  await page.locator('.sidebar-nav').getByRole('button', { name: '首页', exact: true }).click();
  await page.locator('.home-project-row').filter({ has: page.getByRole('button', { name: /repository-b/ }) }).getByRole('button', { name: '打开项目', exact: true }).click();
  await page.locator('.detail-hero').getByRole('heading', { name: 'repository-b', exact: true }).waitFor();
  await page.getByRole('button', { name: '发布新版本', exact: true }).click();
  await page.getByRole('textbox', { name: '版本名称', exact: true }).fill('Repository B independent release');
  await page.getByRole('textbox', { name: '版本介绍', exact: true }).fill('B description must remain independent.');
  await page.getByRole('button', { name: '预览发布效果', exact: true }).click();
  await app.evaluate(() => globalThis.releaseNavigationFixture.failA());
  const publishB = page.getByRole('button', { name: '确认发布新版本', exact: true });
  await publishB.waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent?.includes('确认发布新版本'))?.disabled);
  assert.equal(await publishB.isEnabled(), true, 'A failure cannot disable B publication');
  assert.equal(await page.locator('[data-testid="release-recovery"]').count(), 0, 'A recovery/draft card is never shown on B');
  assert.equal(await page.getByText('A_REPOSITORY_ONLY_PUBLICATION_FAILURE', { exact: true }).count(), 0, 'A failure text is not attached to B');
  assert.equal(await page.locator('.release-preview-stage').getByText('Repository B independent release', { exact: true }).count(), 1, 'B title remains intact');
  await publishB.click();
  await page.getByTestId('release-downloads').waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.releaseNavigationFixture.publishCalls.map(input => ({ repo: input.repo, title: input.title, body: input.body }))), [
    { repo: 'repository-a', title: 'Repository A release', body: 'A release awaiting publication.' },
    { repo: 'repository-b', title: 'Repository B independent release', body: 'B description must remain independent.' },
  ], 'B publication uses its own repository and text after A fails');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, 'repository-b-published.png') });
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, builtRenderer: true, networkDenied: true, coverage: ['empty favorites refresh after starring', 'deferred release failure isolated across repository navigation'] }, null, 2));
  process.stdout.write('Built live UI passed: favorites refresh and publication failure isolation across repositories.\n');
} finally { await app.close(); }
