import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(desktopDirectory, 'out', 'release-detail-layout-smoke');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'isolated-'));
const profileDirectory = join(runDirectory, 'profile');
await mkdir(profileDirectory);
const executableArgument = process.argv.find((value) => value.startsWith('--executable='));
const executable = executableArgument?.slice('--executable='.length)
  ?? (process.argv.includes('--packaged') ? join(desktopDirectory, 'release', 'win-unpacked', 'EasyHub.exe') : null);
if (executableArgument && (!executable || !isAbsolute(executable))) throw new Error('--executable requires an absolute path.');
const launcher = join(runDirectory, 'launch.cjs');
if (!executable) await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profileDirectory)});
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Isolated release layout fixture</title>';
globalThis.releaseLayoutRegister = ipcMain.handle.bind(ipcMain);
globalThis.releaseLayoutUnmocked = [];
ipcMain.handle = (channel, handler) => globalThis.releaseLayoutRegister(channel, channel.startsWith('easyhub:') ? () => {
  globalThis.releaseLayoutUnmocked.push(channel);
  throw new Error('Unmocked isolated release layout IPC: ' + channel);
} : handler);
require(${JSON.stringify(join(desktopDirectory, 'out', 'main', 'index.js'))});
`, 'utf8');

const app = await electron.launch({ executablePath: executable || electronPath,
  args: executable ? ['--user-data-dir=' + profileDirectory] : [launcher], cwd: desktopDirectory,
  env: { ...process.env, EASYHUB_PROXY_APP_ONLY_TEST: '1' } });
const measurements = [];
const failures = [];
const pageErrors = [];
let isolation;
const started = Date.now();
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profileDirectory);
  await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
    const renderer = BrowserWindow.getAllWindows()[0].webContents;
    const fixture = globalThis.releaseLayoutFixture = { forbidden: [], network: [], reads: [] };
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      fixture.network.push(details.url); callback({ cancel: true });
    });
    const register = globalThis.releaseLayoutRegister ?? ipcMain.handle.bind(ipcMain);
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      register(channel, (event, ...args) => {
        if (event.sender !== renderer) throw new Error('Fixture bridge called from another renderer');
        return handler(...args);
      });
    };
    const now = new Date().toISOString();
    const repo = { id: 941, name: 'release-layout-project', full_name: 'release-layout-fixture/release-layout-project',
      owner: { login: 'release-layout-fixture', avatar_url: '' }, private: false, archived: false, default_branch: 'main',
      description: 'Check long release names and downloadable file names in the live workspace.',
      updated_at: now, pushed_at: now, permissions: { pull: true, push: true, admin: true }, open_issues_count: 0 };
    const release = { id: 942, tag_name: 'v1.2.1-beta-build-with-long-qualifiers',
      name: 'EasyHub Windows installer and portable release ' + 'BuildQualifier'.repeat(5),
      body: '# Release notes\n\nThe title and every uploaded filename must remain fully readable.',
      prerelease: false, draft: false, published_at: now,
      assets: [{ id: 943, name: 'EasyHub_Windows_Installer_' + 'x'.repeat(200) + '.exe',
        label: 'Windows installer ' + 'LongBinaryQualifier'.repeat(5), state: 'uploaded', size: 89000000, download_count: 14 }] };
    assertNameLengths();
    function assertNameLengths() {
      if (release.name.length > 120 || release.assets[0].name.length > 255) throw new Error('Fixture exceeds application/file name limits.');
    }
    mock('easyhub:auth-status', () => ({ user: { login: repo.owner.login, name: 'Release Layout Fixture', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false }));
    mock('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    mock('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', engineVersion: '12.1.2' }));
    mock('easyhub:github', (action, ...args) => {
      fixture.reads.push(action);
      if (action === 'repos') return args[0] === 1 ? [repo] : [];
      if (action === 'activityCounts') return { [repo.id]: { issues: 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 } };
      if (action === 'readme') return '# Release layout fixture\n\nProject introduction.';
      if (action === 'issuesPage') return { items: [], nextPage: null };
      if (action === 'isStarred') return false;
      if (action === 'commits' || action === 'comments' || action === 'releases' || action === 'pullRequests' || action === 'pullRequestsPage') return [];
      if (action === 'releasesPage') return { items: [release], nextPage: null };
      if (action === 'commentsPage') return { items: [], nextPage: null };
      fixture.forbidden.push('github:' + action);
      throw new Error('Unexpected release layout GitHub action: ' + action);
    });
    for (const channel of ['easyhub:auth-start', 'easyhub:auth-poll', 'easyhub:auth-logout', 'easyhub:open-external-link',
      'easyhub:ai-review-pull', 'easyhub:binary-ai-review', 'easyhub:ai-test-connection', 'easyhub:ai-save-settings',
      'easyhub:translate-content', 'easyhub:download-archive', 'easyhub:download-release-asset', 'easyhub:choose-folder',
      'easyhub:local-publish', 'easyhub:local-sync', 'easyhub:release-choose-files', 'easyhub:release-publish',
      'easyhub:release-edit', 'easyhub:release-add-assets', 'easyhub:release-remove-asset',
      'easyhub:github-proxy-enable', 'easyhub:github-proxy-disable']) {
      mock(channel, () => { fixture.forbidden.push(channel); throw new Error('External/write actions are blocked in the release layout fixture.'); });
    }
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (!executable) await app.evaluate(async ({ BrowserWindow }, renderer) => {
    await BrowserWindow.getAllWindows()[0].loadFile(renderer);
  }, join(desktopDirectory, 'out', 'renderer', 'index.html'));
  const inspect = async (label) => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const value = await page.evaluate(() => {
      const card = document.querySelector('.release-download-card:not(.release-source-card)');
      if (!card) throw new Error('Release card is missing');
      const title = card.querySelector('.release-download-heading h2');
      const asset = card.querySelector('.binary-release-asset .release-asset');
      const filename = asset.querySelector('strong');
      const assetDescription = asset.querySelector('small');
      const filenameGroup = filename.parentElement;
      const icons = [...asset.querySelectorAll('svg')];
      const box = (element) => { const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }; };
      const text = (element) => {
        const range = document.createRange(); range.selectNodeContents(element);
        return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({ x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom }));
      };
      const styles = (element) => { const css = getComputedStyle(element);
        return { display: css.display, minWidth: css.minWidth, width: css.width, gridTemplateColumns: css.gridTemplateColumns,
          overflowWrap: css.overflowWrap, overflow: css.overflow, textOverflow: css.textOverflow, lineClamp: css.webkitLineClamp, whiteSpace: css.whiteSpace }; };
      const editor = card.querySelector('.release-edit-panel');
      const escapees = [...card.querySelectorAll('h2,h3,button,input,textarea,.release-edit-asset,.release-edit-url')]
        .filter((element) => { const rect = element.getBoundingClientRect(); const parent = card.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (rect.x < parent.x - 1 || rect.right > parent.right + 1); })
        .map((element) => ({ selector: element.className || element.tagName, box: box(element) }));
      return { viewport: { width: innerWidth, height: innerHeight }, density: document.querySelector('.app-shell').getAttribute('data-layout'),
        card: box(card), title: box(title), titleText: title.textContent, titleFragments: text(title), titleStyle: styles(title),
        asset: box(asset), filename: box(filename), filenameGroup: box(filenameGroup), filenameText: filename.textContent,
        filenameFragments: text(filename), filenameStyle: styles(filename), filenameGroupStyle: styles(filenameGroup),
        assetDescription: box(assetDescription), assetDescriptionFragments: text(assetDescription), assetDescriptionStyle: styles(assetDescription),
        icons: icons.map(box), editor: editor ? box(editor) : null, escapees };
    });
    measurements.push({ label, ...value });
    const check = (condition, reason) => { if (!condition) failures.push({ label, reason, measurement: value }); };
    check(value.title.x >= value.card.x - 1 && value.title.right <= value.card.right + 1,
      'Release title box must stay inside its card instead of widening the page.');
    check(value.titleFragments.every((fragment) => fragment.x >= value.title.x - 1 && fragment.right <= value.card.right + 1),
      'Every release title line must wrap within its card.');
    check(value.filenameFragments.every((fragment) => fragment.x >= value.filenameGroup.x - 1 && fragment.right <= value.filenameGroup.right + 1),
      'Every filename line must wrap within its text column.');
    check(value.assetDescriptionFragments.every((fragment) => fragment.x >= value.filenameGroup.x - 1 && fragment.right <= value.filenameGroup.right + 1),
      'Asset descriptions must wrap within their text column and keep the download icon clear.');
    const downloadIcon = value.icons.at(-1);
    check(downloadIcon && value.filenameGroup.right <= downloadIcon.x + 1,
      'File text must not overlap the download icon.');
    check(value.icons.every((icon) => icon.width >= 16 && icon.height >= 16), 'Download icons must keep their intended size.');
    check(value.filenameStyle.textOverflow !== 'ellipsis' && !/^\d+$/u.test(value.filenameStyle.lineClamp)
      && value.filenameGroupStyle.textOverflow !== 'ellipsis' && !/^\d+$/u.test(value.filenameGroupStyle.lineClamp)
      && value.titleStyle.textOverflow !== 'ellipsis' && !/^\d+$/u.test(value.titleStyle.lineClamp),
      'Full titles and filenames must remain readable, without ellipsis or line-clamp fixes.');
    check(value.filenameText === 'EasyHub_Windows_Installer_' + 'x'.repeat(200) + '.exe'
      && value.titleText === 'EasyHub Windows installer and portable release ' + 'BuildQualifier'.repeat(5),
      'The complete original filename and release title must be rendered.');
    check(value.escapees.length === 0, 'Release editor controls must stay within the card.');
    await page.screenshot({ path: join(outputDirectory, label + '.png') });
  };
  const languages = [{ code: 'zh', widths: [1060, 1200, 1440, 1920] }, { code: 'en', widths: [1060, 1440] }];
  for (const { code, widths } of languages) {
    for (const width of widths) {
      for (const density of ['comfortable', 'compact']) {
        await page.setViewportSize({ width, height: width === 1060 ? 700 : 900 });
        await page.evaluate(({ code, density }) => {
          localStorage.clear();
          localStorage.setItem('easyhub:language', code);
          localStorage.setItem('easyhub:auto-translate', 'false');
          localStorage.setItem('easyhub:layout-preference', density);
        }, { code, density });
        await page.reload();
        await page.locator('.live-connected').waitFor();
        // Choose through the actual setting so storage-key changes cannot hide a density failure.
        await page.locator('.sidebar-nav').getByRole('button', { name: code === 'en' ? 'Settings' : '设置', exact: true }).click();
        await page.locator('.layout-settings-panel').getByRole('button', { name: code === 'en' ? density === 'compact' ? 'Compact' : 'Comfortable' : density === 'compact' ? '紧凑' : '舒适', exact: true }).click();
        await page.reload();
        await page.locator('.live-connected').waitFor();
        assert.equal(await page.locator('.app-shell').getAttribute('data-layout'), density);
        await page.locator('.sidebar-nav').getByRole('button', { name: code === 'en' ? 'My Projects' : '我的项目', exact: true }).click();
        await page.getByRole('button', { name: code === 'en' ? /Cloud Projects/u : /我的云端项目/u }).click();
        await page.locator('.cloud-row').first().getByRole('button', { name: code === 'en' ? 'View' : '查看', exact: true }).click();
        await page.getByRole('button', { name: code === 'en' ? 'Edit Releases' : '编辑发行版', exact: true }).click();
        await page.locator('.release-edit-panel').waitFor();
        const prefix = code + '-' + width + '-' + density;
        await inspect(prefix + '-editor');
        await page.locator('.release-edit-panel').getByRole('button', { name: code === 'en' ? 'Insert link' : '插入链接', exact: true }).click();
        await inspect(prefix + '-link');
        await page.locator('.release-edit-panel').getByRole('button', { name: code === 'en' ? 'Remove' : '移除', exact: true }).click();
        await inspect(prefix + '-remove-confirm');
      }
    }
  }
  assert.deepEqual(pageErrors, [], 'Live renderer must not have uncaught errors.');
  isolation = await app.evaluate(() => ({ ...globalThis.releaseLayoutFixture, unmocked: globalThis.releaseLayoutUnmocked ?? [] }));
  assert.deepEqual(isolation.forbidden, [], 'Layout tests must not call GitHub writes, AI, downloads or OS settings.');
  assert.deepEqual(isolation.network, [], 'Layout tests must stay offline.');
  assert.deepEqual(isolation.unmocked, [], 'Every IPC read must be isolated.');
  process.stdout.write(JSON.stringify({ measurements: measurements.length, failures: failures.map(({ label, reason }) => ({ label, reason })) }, null, 2) + '\n');
  assert.equal(failures.length, 0, 'Release title / file layout must fit: ' + failures.slice(0, 8).map(({ label, reason }) => label + ': ' + reason).join('\n'));
  process.stdout.write('PASS: ' + measurements.length + ' release editor states, full titles and filenames, four window widths and two languages (' + ((Date.now() - started) / 1000).toFixed(1) + 's).\n');
} finally {
  const report = JSON.stringify({ executable: executable || electronPath, profileDirectory, measurements, failures, pageErrors, isolation }, null, 2) + '\n';
  await writeFile(join(outputDirectory, 'measurements.json'), report);
  await writeFile(join(runDirectory, 'measurements.json'), report);
  await app.close();
}
