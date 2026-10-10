import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchUpstreamFixture } from './upstream-smoke-runtime.mjs';

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(desktopDirectory, 'out', 'layout-preferences-smoke');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'isolated-'));
const profileDirectory = join(runDirectory, 'profile');
await mkdir(profileDirectory);
const started = Date.now();
const { app, executable, renderer } = await launchUpstreamFixture(desktopDirectory, {
  profile: profileDirectory, launcher: join(runDirectory, 'launch.cjs'),
  registerName: 'layoutRegisterMock', rejectedName: 'layoutRejectedIpc', title: 'Isolated layout fixture'
});
const measurements = [];
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profileDirectory);
  await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
    const renderer = BrowserWindow.getAllWindows()[0].webContents;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const register = globalThis.layoutRegisterMock ?? ipcMain.handle.bind(ipcMain);
    const fixture = globalThis.layoutFixture = { forbidden: [], reads: [] };
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      register(channel, (event, ...args) => {
        if (event.sender !== renderer) throw new Error('Fixture bridge called from another renderer');
        return handler(...args);
      });
    };
    const now = new Date().toISOString();
    const repository = (id, name) => ({ id, name, full_name: `layout-fixture/${name}`, description: 'A project description that remains readable in either layout.',
      private: false, archived: false, owner: { login: 'layout-fixture', avatar_url: '' }, default_branch: 'main', updated_at: now, pushed_at: now,
      permissions: { pull: true, push: true, admin: true }, open_issues_count: 1, stargazers_count: 3, language: 'TypeScript' });
    const repos = Array.from({ length: 10 }, (_, index) => repository(4201 + index,
      index === 0 ? 'layout-project-with-a-readable-name' : `another-layout-project-${index}`));
    const issue = { id: 42011, number: 1, title: 'Fixture issue with a readable title', body: 'A read-only fixture discussion.', state: 'open',
      created_at: now, user: { login: 'fixture-author' }, comments: 0 };
    mock('easyhub:auth-status', () => ({ user: { login: 'layout-fixture', name: 'Layout Fixture', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false }));
    mock('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    mock('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', engineVersion: '12.1.2' }));
    mock('easyhub:github', (action, ...args) => {
      fixture.reads.push(action);
      if (action === 'repos') return args[0] === 1 ? repos : [];
      if (action === 'searchPublicReposPage') return { items: repos.slice(0, 1), totalCount: 31, hasNextPage: true };
      if (action === 'activityCounts') return { 4201: { issues: 1, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }, 4202: { issues: 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 } };
      if (action === 'readme') return '# Layout fixture\n\nProject introductions and controls remain usable as the window changes size.';
      if (action === 'issuesPage') return { items: args[1] === repos[0].name ? [issue] : [], nextPage: null };
      if (action === 'isStarred') return false;
      if (action === 'commits' || action === 'comments' || action === 'releases' || action === 'pullRequests' || action === 'pullRequestsPage') return [];
      if (action === 'releasesPage' || action === 'commentsPage') return { items: [], nextPage: null };
      fixture.forbidden.push('github:' + action);
      throw new Error('Unexpected mock GitHub action: ' + action);
    });
    for (const channel of ['easyhub:auth-start', 'easyhub:auth-poll', 'easyhub:auth-logout', 'easyhub:open-external-link', 'easyhub:open-license',
      'easyhub:ai-review-pull', 'easyhub:binary-ai-review', 'easyhub:ai-test-connection', 'easyhub:ai-save-settings', 'easyhub:ai-forget-key',
      'easyhub:translate-content', 'easyhub:download-archive', 'easyhub:download-release-asset', 'easyhub:choose-folder',
      'easyhub:local-publish', 'easyhub:local-sync', 'easyhub:publish-release', 'easyhub:github-proxy-enable', 'easyhub:github-proxy-disable']) {
      mock(channel, () => { fixture.forbidden.push(channel); throw new Error('External and write actions are blocked by this layout fixture.'); });
    }
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, renderer) => { await BrowserWindow.getAllWindows()[0].loadFile(renderer); }, renderer);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('easyhub:language', 'zh'); localStorage.setItem('easyhub:auto-translate', 'false'); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  const shell = page.locator('.app-shell');
  const layoutPanel = page.locator('.layout-settings-panel');
  let language = 'zh';
  const names = () => language === 'en'
    ? { home: 'Home', settings: 'Settings', projects: 'My Projects', issues: 'Issues', group: 'Interface layout', auto: 'Automatic', comfortable: 'Comfortable', compact: 'Compact' }
    : { home: '首页', settings: '设置', projects: '我的项目', issues: '问题', group: '界面布局', auto: '自动适配', comfortable: '舒适', compact: '紧凑' };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const waitLayout = async (preference, density) => {
    await page.waitForFunction(({ preference, density }) => {
      const element = document.querySelector('.app-shell');
      return element?.getAttribute('data-layout-preference') === preference && element?.getAttribute('data-layout') === density;
    }, { preference, density });
    await settle();
  };
  const reachable = async (locator, label) => {
    await locator.scrollIntoViewIfNeeded();
    assert.equal(await locator.isEnabled(), true, label + ' should be enabled');
    const result = await locator.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return bounds.width > 0 && bounds.height > 0 && (target === element || element.contains(target));
    });
    assert.equal(result, true, label + ' should be reachable by pointer');
  };
  const openSettings = async () => {
    await page.locator('.sidebar-nav').getByRole('button', { name: names().settings, exact: true }).click();
    await layoutPanel.getByRole('heading', { name: names().group, exact: true }).waitFor();
  };
  const choose = async (preference, density) => {
    await openSettings();
    const button = layoutPanel.getByRole('button', { name: names()[preference], exact: true });
    await reachable(button, preference + ' layout option');
    await button.click();
    await waitLayout(preference, density);
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
  };
  const recordGeometry = async (label) => {
    const measurement = await page.evaluate(() => {
      const content = document.querySelector('.page-content');
      const column = document.querySelector('.main-column');
      const sidebar = document.querySelector('.sidebar');
      const navigation = document.querySelector('.sidebar-nav button');
      const contentStyle = getComputedStyle(content);
      const cloudRows = [...document.querySelectorAll('.cloud-row')];
      const firstRow = cloudRows[0];
      const title = document.querySelector('.page-header h1');
      const primaryButton = document.querySelector('.page-header .button');
      const topbarHeight = document.querySelector('.topbar').getBoundingClientRect().height;
      return { viewport: { width: innerWidth, height: innerHeight },
        preference: document.querySelector('.app-shell').getAttribute('data-layout-preference'),
        density: document.querySelector('.app-shell').getAttribute('data-layout'),
        sidebarWidth: sidebar.getBoundingClientRect().width, navigationHeight: navigation.getBoundingClientRect().height,
        topbarHeight, headingFontSize: title ? parseFloat(getComputedStyle(title).fontSize) : null,
        primaryButtonHeight: primaryButton?.getBoundingClientRect().height ?? null,
        projectRowHeight: firstRow?.getBoundingClientRect().height ?? null,
        visibleProjectRows: cloudRows.filter(row => {
          const bounds = row.getBoundingClientRect();
          return bounds.top >= topbarHeight && bounds.bottom <= innerHeight;
        }).length,
        contentPadding: parseFloat(contentStyle.paddingLeft), contentWidth: content.getBoundingClientRect().width,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        columnOverflow: column.scrollWidth - column.clientWidth, contentOverflow: content.scrollWidth - content.clientWidth };
    });
    assert.ok(measurement.pageOverflow <= 1 && measurement.columnOverflow <= 1 && measurement.contentOverflow <= 1,
      label + ' must avoid horizontal page/content overflow: ' + JSON.stringify(measurement));
    measurements.push({ label, ...measurement });
    await page.screenshot({ path: join(outputDirectory, label + '.png') });
    return measurement;
  };
  const checkFooter = async (label) => {
    await settle();
    const geometry = await page.locator('.home-shortcuts').evaluate(footer => {
      const column = document.querySelector('.main-column');
      const page = document.querySelector('.page-content');
      const bounds = footer.getBoundingClientRect();
      const previous = footer.previousElementSibling;
      return { bottom: bounds.bottom + column.scrollTop, expectedBottom: column.scrollHeight - parseFloat(getComputedStyle(page).paddingBottom),
        followsContent: !previous || bounds.top >= previous.getBoundingClientRect().bottom - 1,
        last: footer.nextElementSibling === null };
    });
    assert.ok(Math.abs(geometry.bottom - geometry.expectedBottom) <= 2, label + ': footer should end at the page bottom inset: ' + JSON.stringify(geometry));
    assert.ok(geometry.followsContent && geometry.last, label + ': entries must follow content and pagination without overlay');
    for (const button of await page.locator('.home-shortcuts button').all()) await reachable(button, label + ' footer entry');
  };
  const checkViews = async (label, preference, density) => {
    await waitLayout(preference, density);
    await page.locator('.sidebar-nav').getByRole('button', { name: names().home, exact: true }).click();
    await page.locator('.v2-home-heading').waitFor();
    await recordGeometry(label + '-home');
    await checkFooter(label + '-home');
    await page.locator('.sidebar-nav').getByRole('button', { name: names().projects, exact: true }).click();
    await page.getByRole('button', { name: /我的云端项目/ }).click();
    const projectButton = page.locator('.cloud-row').filter({ hasText: 'layout-project-with-a-readable-name' }).getByRole('button', { name: '查看', exact: true });
    await projectButton.waitFor();
    await reachable(projectButton, 'Project details');
    await recordGeometry(label + '-projects');
    await checkFooter(label + '-long-projects');
    await page.getByRole('textbox', { name: '筛选项目', exact: true }).fill('layout-project-with-a-readable-name');
    await checkFooter(label + '-short-projects');
    await page.getByRole('textbox', { name: '筛选项目', exact: true }).fill('no-matching-local-project');
    await checkFooter(label + '-empty-projects');
    await page.getByRole('textbox', { name: '筛选项目', exact: true }).fill('');
    await projectButton.click();
    await page.getByRole('heading', { name: 'layout-project-with-a-readable-name', exact: true }).waitFor();
    await reachable(page.getByRole('button', { name: '查看问题', exact: true }), 'Project issues');
    await recordGeometry(label + '-project-details');
    await page.getByRole('button', { name: '查看问题', exact: true }).click();
    const issueButton = page.locator('.issue-row').filter({ hasText: 'Fixture issue with a readable title' });
    await issueButton.waitFor();
    await reachable(issueButton, 'Issue row');
    await recordGeometry(label + '-issues');
    await openSettings();
    for (const preference of ['auto', 'comfortable', 'compact']) await reachable(layoutPanel.getByRole('button', { name: names()[preference], exact: true }), preference + ' setting');
    await recordGeometry(label + '-settings');
  };

  await waitLayout('auto', 'comfortable');
  await openSettings();
  assert.equal(await layoutPanel.getByRole('button', { name: names().auto, exact: true }).getAttribute('aria-pressed'), 'true', 'Automatic layout is the initial choice');
  const comfortable = await recordGeometry('default-auto-wide');
  await choose('compact', 'compact');
  const compact = await recordGeometry('manual-compact-wide');
  assert.equal(compact.topbarHeight, 56, 'Compact must reduce the fixed topbar as well as page spacing');
  assert.equal(compact.navigationHeight, 36, 'Compact navigation should use dense desktop control sizes');
  assert.equal(compact.sidebarWidth, 168);
  assert.equal(comfortable.topbarHeight, 72, 'Comfortable topbar must retain its established size');
  assert.equal(comfortable.navigationHeight, 48);
  assert.equal(comfortable.sidebarWidth, 238);
  await checkViews('manual-compact-wide', 'compact', 'compact');
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await waitLayout('compact', 'compact');
  await openSettings();
  assert.equal(await layoutPanel.getByRole('button', { name: names().compact, exact: true }).getAttribute('aria-pressed'), 'true', 'Compact selection must survive reload');

  await page.setViewportSize({ width: 1060, height: 700 });
  await choose('comfortable', 'comfortable');
  await checkViews('manual-comfortable-small', 'comfortable', 'comfortable');
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await waitLayout('comfortable', 'comfortable');
  await openSettings();
  assert.equal(await layoutPanel.getByRole('button', { name: names().comfortable, exact: true }).getAttribute('aria-pressed'), 'true', 'Comfortable selection must survive reload even in a small window');
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitLayout('comfortable', 'comfortable');
  await choose('auto', 'comfortable');
  await checkViews('auto-wide', 'auto', 'comfortable');
  await page.setViewportSize({ width: 1060, height: 700 });
  await checkViews('auto-small', 'auto', 'compact');
  const comfortableRows = measurements.find(item => item.label === 'manual-comfortable-small-projects');
  const compactRows = measurements.find(item => item.label === 'auto-small-projects');
  assert.ok(compactRows.visibleProjectRows >= comfortableRows.visibleProjectRows + 2,
    'At 1060 × 700, Compact must show at least two additional complete project rows');
  assert.ok(compactRows.projectRowHeight <= comfortableRows.projectRowHeight * 0.8,
    'Compact project rows must be materially smaller than Comfortable rows');
  assert.equal(compactRows.primaryButtonHeight, 32, 'Compact primary controls remain a usable 32 px high');
  assert.equal(compactRows.headingFontSize, 22);
  await page.setViewportSize({ width: 800, height: 620 });
  await checkViews('auto-minimum', 'auto', 'compact');
  // Exercise width and height separately: Automatic should react to either constraint.
  await page.setViewportSize({ width: 1440, height: 700 });
  await waitLayout('auto', 'compact');
  await recordGeometry('auto-short');
  await page.setViewportSize({ width: 1060, height: 900 });
  await waitLayout('auto', 'compact');
  await recordGeometry('auto-narrow');
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitLayout('auto', 'comfortable');
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await waitLayout('auto', 'comfortable');
  await openSettings();
  await page.getByRole('button', { name: '选择语言', exact: true }).click();
  await page.locator('.language-menu').getByRole('button', { name: 'English', exact: true }).click();
  language = 'en';
  await layoutPanel.getByRole('heading', { name: names().group, exact: true }).waitFor();
  for (const preference of ['auto', 'comfortable', 'compact']) await reachable(layoutPanel.getByRole('button', { name: names()[preference], exact: true }), 'English ' + preference + ' option');
  await choose('compact', 'compact');
  await recordGeometry('english-compact-settings');
  await page.locator('.sidebar-nav').getByRole('button', { name: names().projects, exact: true }).click();
  await page.getByRole('button', { name: 'All Public Projects', exact: true }).click();
  await page.locator('.search-box input').fill('layout');
  await page.locator('.search-pagination .trending-pagination').waitFor();
  await checkFooter('english-public-search-pagination');
  assert.equal(await shell.getAttribute('data-layout-preference'), 'compact');
  assert.deepEqual(errors, []);
  assert.deepEqual(await app.evaluate(() => globalThis.layoutFixture.forbidden), []);
  assert.deepEqual(await app.evaluate(() => globalThis.layoutRejectedIpc ?? []), []);
  await writeFile(join(outputDirectory, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  process.stdout.write('PASS: live renderer layout switching, persistence, automatic window adaptation, projects/issues/settings fit and reachable controls (' + ((Date.now() - started) / 1000).toFixed(1) + 's).\n');
} finally {
  if (measurements.length) await writeFile(join(outputDirectory, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  await app.close();
}
