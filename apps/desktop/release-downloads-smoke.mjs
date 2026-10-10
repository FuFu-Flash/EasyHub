import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Mount the real component with a local bridge so the regression test cannot
// contact GitHub, download files, or modify a published release.
const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureModule = 'virtual:release-downloads-fixture';
const fixtureSource = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ReleaseDownloads } from '/src/components/ReleaseDownloads.tsx';
import { ReleaseEditor } from '/src/components/ReleaseEditor.tsx';
import { TranslationPreferencesContext } from '/src/components/TranslatableContent.tsx';
import '/src/styles.css';
import '/src/v2.css';

const query = new URLSearchParams(location.search);
const repo = {
  id: 1, name: 'long-notes', full_name: 'tester/long-notes', description: null,
  private: query.has('private'), owner: { login: 'tester' }, default_branch: 'main',
  updated_at: '2026-09-30T00:00:00Z', open_issues_count: 0,
};
const releases = Array.from({ length: 30 }, (_, index) => ({
  id: 100 + index, tag_name: 'v' + (30 - index), name: 'Release ' + (30 - index),
  body: '# Notes for v' + (30 - index) + '\\n\\n' + Array.from({ length: 160 }, (_, paragraph) =>
    'Paragraph ' + paragraph + ': A long explanation that must not push downloads below the viewport.').join('\\n\\n'),
  draft: false, prerelease: false, published_at: '2026-09-30T00:00:00Z',
  assets: [
    { id: 200 + index, name: 'installer-v' + (30 - index) + '.exe', label: null, size: 2048,
      content_type: 'application/octet-stream', download_count: 4, state: 'uploaded' },
    { id: 300 + index, name: 'unfinished.bin', label: null, size: 0,
      content_type: 'application/octet-stream', download_count: 0, state: 'new' },
  ],
}));
const metrics = window.releaseDownloadsTest = { downloads: [], translations: [], cancelled: [], edits: [], reads: [], uploads: [], removals: [] };
const selectedFiles = [{ id: '00000000-0000-0000-0000-000000000001', name: 'first.zip', size: 7, mimeType: 'application/zip' }, { id: '00000000-0000-0000-0000-000000000002', name: 'second.zip', size: 7, mimeType: 'application/zip' }];
const htmlBody = '<details><summary>English</summary>\\n\\nEnglish notes with [guide](docs/guide.md).\\n\\n</details>\\n\\n[Older release](https://github.com/tester/long-notes/releases/tag/older%2F0.1)\\n\\n<script>window.unsafeRelease = true</script><img src="x" onerror="window.unsafeRelease = true" />';
if (query.has('html')) releases[0].body = htmlBody;
const olderRelease = { ...releases[0], id: 99, tag_name: 'older/0.1', name: 'Older release' };
window.localStorage.setItem('easyhub:language', 'zh');
window.easyHub = {
  github: async (action, owner, name, argument) => {
    metrics.reads.push({ action, owner, name, argument });
    if (action === 'releaseByTag') return argument === olderRelease.tag_name ? olderRelease : null;
    if (!['releases', 'releasesPage'].includes(action)) throw new Error('Unexpected read: ' + action);
    if (query.has('error')) throw new Error('Fixture could not load releases');
    const result = (items, nextPage = null) => action === 'releasesPage' ? { items, nextPage } : items;
    if (query.has('loading')) return new Promise((resolve) => { metrics.resolveReleases = () => resolve(result(releases)); });
    if (query.has('empty')) return result([]);
    if (argument === 2) {
      if (query.has('retry') && !metrics.pageFailed) { metrics.pageFailed = true; throw new Error('Try loading this page again'); }
      return result([releases[29], olderRelease]);
    }
    return result([...releases, { ...releases[0], id: 900, tag_name: 'draft-only', draft: true }], 2);
  },
  openExternalLink: async (url) => { (metrics.links ??= []).push(url); },
  translateContent: async (request) => { metrics.translations.push(request); return 'Translated:\\n\\n' + request.text; },
  cancelTranslation: async (id) => { metrics.cancelled.push(id); },
  onReleaseProgress: () => () => {},
  chooseReleaseFiles: async () => selectedFiles,
  addReleaseAssets: async (request) => {
    metrics.uploads.push(request);
    if (query.has('uploadHold')) await new Promise((resolve) => { metrics.resolveUpload = resolve; });
    const release = releases.find((item) => item.id === request.releaseId);
    const append = (file) => { if (!release.assets.some((asset) => asset.name === file.name)) release.assets.push({ id: 700 + selectedFiles.indexOf(file), name: file.name, size: 7, state: 'uploaded', content_type: 'application/zip', download_count: 0 }); };
    if (query.has('uploadRetry') && metrics.uploads.length === 1) {
      append(selectedFiles[0]);
      return { status: 'failed', error: 'Second file failed. Retry unfinished files.', completedAssetIds: [selectedFiles[0].id], remainingAssetIds: [selectedFiles[1].id], retryable: true, release: { ...release } };
    }
    request.assetIds.map((id) => selectedFiles.find((file) => file.id === id)).forEach(append);
    return { ...release };
  },
  editRelease: async (request) => {
    metrics.edits.push(request);
    const release = releases.find((item) => item.id === request.releaseId);
    const updated = { ...release, name: request.title, body: request.body, prerelease: request.prerelease,
      upload_url: 'https://example.invalid/upload', html_url: 'https://example.invalid/release' };
    Object.assign(release, updated);
    return updated;
  },
};
createRoot(document.getElementById('root')).render(createElement(
  TranslationPreferencesContext.Provider,
  { value: { automatic: true, target: 'zh-CN' } },
  createElement('main', { style: { maxWidth: '1100px', margin: '0 auto' } },
    query.has('new') ? createElement(ReleaseEditor, {
      project: { name: 'Example', health: 'saved', releases: [] }, language: 'zh', busy: false,
      imageSources: {}, onRegisterInlineImage: () => {}, onPublish: () => {}, onBack: () => {},
      onOpenUpdate: () => {}, onOpenLink: (url) => { (metrics.links ??= []).push(url); },
      onChooseFiles: query.has('resume') ? async () => selectedFiles : undefined,
      failure: query.has('residual') ? { status: 'failed', error: '发布失败，且未能清理 GitHub 上的草稿。', completedAssetIds: [], remainingAssetIds: [], retryable: false,
        residualDraft: { id: 100, title: 'Example release', tagName: 'v0.01', url: 'https://github.com/tester/long-notes/releases', retainedForRetry: false } } : query.has('resume') ? {
        status: 'failed', error: 'Retry remaining files.', completedAssetIds: [selectedFiles[0].id], remainingAssetIds: [selectedFiles[1].id], retryable: true,
        residualDraft: { id: 100, title: 'Example release', tagName: 'v0.01', url: 'https://github.com/tester/long-notes/releases', retainedForRetry: true } } : undefined,
    }) : createElement(ReleaseDownloads, {
      repo, onBack: () => {}, onDownload: (request) => metrics.downloads.push(request),
      downloadBusy: query.has('busy'), offerAdd: query.has('offerAdd'), focusTag: query.get('focus') || undefined,
      canEdit: query.has('edit'), editOnOpen: query.has('edit'),
    }),
  ),
));
`;

const server = await createServer({
  configFile: false,
  root: join(desktopDirectory, 'src/renderer'),
  plugins: [react(), {
    name: 'release-downloads-test-fixture',
    resolveId(id) { if (id === fixtureModule) return '\0' + fixtureModule; },
    load(id) { if (id === '\0' + fixtureModule) return fixtureSource; },
    configureServer(viteServer) {
      viteServer.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/release-downloads-test')) return next();
        const html = await viteServer.transformIndexHtml(request.url,
          '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:release-downloads-fixture"></script></body></html>');
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(html);
      });
    },
  }],
  server: { host: '127.0.0.1', port: 0 },
});

let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/release-downloads-test`;
  const installedBrowser = process.env.EASYHUB_TEST_BROWSER ?? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((path) => existsSync(path));
  browser = await chromium.launch({ ...(installedBrowser ? { executablePath: installedBrowser } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === new URL(baseUrl).origin) return route.continue();
    return route.abort();
  });

  await page.goto(baseUrl + '?focus=v12&offerAdd');
  const downloads = page.getByTestId('release-downloads');
  const cards = downloads.locator('.release-download-card:not(.release-source-card)');
  await cards.last().waitFor();
  assert.equal(await cards.count(), 30, 'Draft releases must remain hidden');
  assert.equal(await cards.first().locator('.release-tag').innerText(), 'v12', 'README focus tag must remain first');
  assert.equal(await cards.first().getByText('README 提到的版本', { exact: true }).count(), 1);
  assert.equal(await downloads.locator('.release-description').count(), 0, 'Collapsed notes must not render markdown');
  assert.equal(await downloads.locator('.translatable-content').count(), 0, 'Collapsed notes must not mount translation');
  assert.equal(await page.evaluate(() => window.releaseDownloadsTest.translations.length), 0);
  assert.equal(await downloads.getByRole('button', { name: '展开完整说明', exact: true }).count(), 30);
  assert.equal(await downloads.getByRole('button', { name: /unfinished.bin/ }).count(), 0);
  const source = downloads.getByRole('button', { name: '下载源码 ZIP main', exact: true });
  const sourceBox = await source.boundingBox();
  assert.ok(sourceBox && sourceBox.y + sourceBox.height < 900, 'Default branch source must be reachable without scrolling through releases');
  const firstInstaller = cards.first().getByRole('button', { name: /^installer-v12.exe/ });
  const installerBox = await firstInstaller.boundingBox();
  assert.ok(installerBox && installerBox.y + installerBox.height < 900, 'Release assets must appear near the header with long notes');

  await source.click();
  await firstInstaller.click();
  await cards.first().getByRole('button', { name: '项目源码 ZIP v12 的完整源码', exact: true }).click();
  const requests = await page.evaluate(() => window.releaseDownloadsTest.downloads);
  assert.deepEqual(requests.map(({ kind, ref, assetId, fileName, offerAdd }) => ({ kind, ref, assetId, fileName, offerAdd })), [
    { kind: 'archive', ref: 'main', assetId: undefined, fileName: 'long-notes-main.zip', offerAdd: true },
    { kind: 'archive', ref: 'v12', assetId: 218, fileName: 'installer-v12.exe', offerAdd: true },
    { kind: 'archive', ref: 'v12', assetId: undefined, fileName: 'long-notes-v12.zip', offerAdd: true },
  ]);

  const toggle = cards.first().getByRole('button', { name: '展开完整说明', exact: true });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  const controlledId = await toggle.getAttribute('aria-controls');
  assert.ok(controlledId);
  assert.equal(await page.locator(`[id="${controlledId}"]`).count(), 1);
  await toggle.focus();
  await page.keyboard.press('Enter');
  const collapse = cards.first().getByRole('button', { name: '收起说明', exact: true });
  assert.equal(await collapse.getAttribute('aria-expanded'), 'true');
  await cards.first().getByText('Translated:', { exact: true }).waitFor();
  assert.equal(await downloads.locator('.release-description').count(), 1);
  const translated = await page.evaluate(() => window.releaseDownloadsTest.translations);
  assert.equal(translated.length, 1, 'Only the expanded release should translate');
  assert.ok(translated[0].text.startsWith('# Notes for v12'));
  assert.equal(await cards.first().evaluate((card) => Boolean(card.querySelector('.release-assets')
    .compareDocumentPosition(card.querySelector('.release-description-content')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  await collapse.click();
  assert.equal(await downloads.locator('.release-description').count(), 0);
  assert.equal(await downloads.locator('.translatable-content').count(), 0);

  await page.setViewportSize({ width: 700, height: 900 });
  await source.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Download layout must fit a narrow window');
  const outputDirectory = join(desktopDirectory, 'out', 'release-downloads-test');
  await mkdir(outputDirectory, { recursive: true });
  await page.screenshot({ path: join(outputDirectory, 'collapsed-notes.png') });

  await page.goto(baseUrl + '?edit');
  const editor = page.getByTestId('release-edit-panel');
  await editor.waitFor();
  await editor.getByLabel('版本名称', { exact: true }).fill('Edited release');
  await editor.locator('textarea').fill('# Edited notes');
  await editor.getByRole('button', { name: '保存版本介绍', exact: true }).click();
  await editor.getByText('版本介绍已更新。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.releaseDownloadsTest.edits[0].releaseId), 100);
  await editor.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await cards.first().getByRole('heading', { name: 'Edited release', exact: true }).waitFor();
  assert.equal(await editor.count(), 0);
  await cards.first().getByRole('button', { name: '编辑发行版', exact: true }).click();
  assert.equal(await editor.locator('textarea').inputValue(), '# Edited notes');
  assert.equal(await downloads.locator('.release-description').count(), 0, 'Editing must not expand release notes');
  await editor.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await cards.first().getByRole('button', { name: '展开完整说明', exact: true }).focus();
  await page.keyboard.press('Space');
  await cards.first().getByText('Translated:', { exact: true }).waitFor();
  assert.equal(await downloads.locator('.release-description').count(), 1);
  await cards.first().getByRole('button', { name: '收起说明', exact: true }).focus();
  await page.keyboard.press('Space');
  assert.equal(await downloads.locator('.release-description').count(), 0);

  await page.goto(baseUrl + '?private');
  await cards.last().waitFor();
  await cards.first().getByRole('button', { name: '展开完整说明', exact: true }).click();
  await cards.first().getByRole('heading', { name: 'Notes for v30', exact: true }).waitFor();
  assert.equal(await downloads.locator('.translatable-content').count(), 0, 'Private repository descriptions must keep their existing translation policy');
  assert.equal(await page.evaluate(() => window.releaseDownloadsTest.translations.length), 0);

  await page.goto(baseUrl + '?busy');
  await cards.last().waitFor();
  assert.equal(await downloads.locator('.release-asset:not(:disabled)').count(), 0);
  await cards.first().getByRole('button', { name: '展开完整说明', exact: true }).click();
  assert.equal(await cards.first().getByRole('button', { name: '收起说明', exact: true }).isEnabled(), true);

  await page.goto(baseUrl + '?loading');
  await downloads.locator('.live-loading').waitFor();
  assert.equal(await source.isEnabled(), true, 'Default branch source must be available while releases load');
  assert.equal(await cards.count(), 0);
  await page.evaluate(() => window.releaseDownloadsTest.resolveReleases());
  await cards.last().waitFor();

  await page.goto(baseUrl + '?error');
  await downloads.getByRole('alert').waitFor();
  assert.equal(await source.isEnabled(), true, 'Default branch source must remain available if release retrieval fails');
  await page.goto(baseUrl + '?empty');
  await downloads.getByText('这个项目还没有发布可下载的新版本，你仍可以下载项目源码。', { exact: true }).waitFor();
  assert.equal(await source.isEnabled(), true);
  assert.equal(await cards.count(), 0);
  const regressions = [];
  await page.goto(baseUrl + '?new');
  await page.getByRole('textbox', { name: '版本名称', exact: true }).fill('My custom release title');
  await page.getByRole('button', { name: 'Alpha 测试版', exact: true }).click();
  if (await page.getByRole('textbox', { name: '版本名称', exact: true }).inputValue() !== 'My custom release title') regressions.push('Channel changes overwrite custom titles');
  await page.getByRole('textbox', { name: '版本号', exact: true }).fill('alpha9.1');
  assert.equal(await page.getByRole('textbox', { name: '版本名称', exact: true }).inputValue(), 'My custom release title');
  await page.goto(baseUrl + '?new');
  await page.getByRole('button', { name: 'Alpha 测试版', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '版本名称', exact: true }).inputValue(), 'Example alpha0.1');
  await page.getByRole('textbox', { name: '版本号', exact: true }).fill('alpha9.1');
  assert.equal(await page.getByRole('textbox', { name: '版本名称', exact: true }).inputValue(), 'Example alpha9.1');
  await page.getByRole('textbox', { name: '版本介绍', exact: true }).fill('<details><summary>English</summary>Safe release preview</details><script>window.unsafeRelease=true</script>');
  await page.getByRole('button', { name: '预览发布效果', exact: true }).click();
  assert.equal(await page.locator('.release-markdown details').count(), 1);
  assert.equal(await page.locator('.release-markdown script').count(), 0);
  await page.goto(baseUrl + '?html&private&edit');
  await cards.first().getByRole('button', { name: '展开完整说明', exact: true }).click();
  if (await cards.first().locator('.release-description details').count() !== 1) regressions.push('Published release HTML details are discarded');
  await editor.getByRole('button', { name: '预览效果', exact: true }).click();
  if (await editor.locator('.release-edit-preview details').count() !== 1) regressions.push('Release edit preview HTML details are discarded');
  const details = cards.first().locator('.release-description-content details');
  assert.equal(await details.getAttribute('open'), null);
  await details.locator('summary').click();
  assert.notEqual(await details.getAttribute('open'), null);
  await details.getByRole('link', { name: 'guide', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.releaseDownloadsTest.links), ['https://github.com/tester/long-notes/blob/main/docs/guide.md']);
  assert.equal(await page.evaluate(() => Boolean(window.unsafeRelease)), false);
  assert.equal(await downloads.locator('script, [onerror]').count(), 0);
  await page.screenshot({ path: join(outputDirectory, 'release-html-details.png'), fullPage: true });
  await editor.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await cards.first().getByRole('link', { name: 'Older release', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.release-download-card:not(.release-source-card) .release-tag')?.textContent === 'older/0.1');
  assert.deepEqual(await page.evaluate(() => window.releaseDownloadsTest.links), ['https://github.com/tester/long-notes/blob/main/docs/guide.md']);
  await page.goto(baseUrl + '?focus=older%2F0.1');
  await cards.last().waitFor();
  await page.waitForTimeout(100);
  if (await cards.first().locator('.release-tag').innerText() !== 'older/0.1') regressions.push('Older linked release cannot be opened');
  if (await downloads.getByRole('button', { name: '加载更多版本', exact: true }).count() !== 1) regressions.push('Older releases have no pagination');
  await downloads.getByRole('button', { name: '加载更多版本', exact: true }).click();
  await page.waitForFunction(() => window.releaseDownloadsTest.reads.some((item) => item.action === 'releasesPage' && item.argument === 2));
  assert.equal(await cards.count(), 31, 'Overlapping page boundary and focused release must remain unique');
  assert.equal(await downloads.getByRole('button', { name: '加载更多版本', exact: true }).count(), 0);
  await cards.first().getByRole('button', { name: '项目源码 ZIP older/0.1 的完整源码', exact: true }).click();
  assert.equal(await page.evaluate(() => window.releaseDownloadsTest.downloads[0].ref), 'older/0.1');
  await page.goto(baseUrl + '?retry');
  await downloads.getByRole('button', { name: '加载更多版本', exact: true }).click();
  await downloads.getByRole('alert').waitFor();
  assert.equal(await cards.count(), 30, 'Pagination errors must keep loaded releases');
  await downloads.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.release-download-card:not(.release-source-card)').length === 31);
  assert.equal(await downloads.getByRole('alert').count(), 0);
  await page.goto(baseUrl + '?edit&uploadRetry');
  await editor.waitFor();
  await editor.getByRole('button', { name: '选择文件', exact: true }).click();
  await editor.getByRole('button', { name: '上传 2 个文件', exact: true }).click();
  await editor.getByRole('button', { name: '重试 1 个未完成文件', exact: true }).waitFor();
  assert.deepEqual(await editor.locator('.release-edit-assets > .release-edit-asset').evaluateAll((rows) => rows.filter((row) => row.textContent.includes('取消选择')).map((row) => row.querySelector('span').textContent)), ['second.zip']);
  await editor.getByRole('button', { name: '重试 1 个未完成文件', exact: true }).click();
  await editor.getByText('文件已添加到这个版本。', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.releaseDownloadsTest.uploads.map((request) => request.assetIds)), [
    ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
    ['00000000-0000-0000-0000-000000000002'],
  ]);
  await page.goto(baseUrl + '?edit&uploadHold');
  await editor.waitFor();
  await editor.getByRole('button', { name: '选择文件', exact: true }).click();
  await editor.getByRole('button', { name: '上传 2 个文件', exact: true }).evaluate((button) => { button.click(); button.click(); });
  await page.waitForFunction(() => Boolean(window.releaseDownloadsTest.resolveUpload));
  assert.equal(await page.evaluate(() => window.releaseDownloadsTest.uploads.length), 1, 'Repeated clicks must not create concurrent uploads');
  assert.equal(await editor.getByRole('button', { name: '保存版本介绍', exact: true }).isEnabled(), false);
  assert.equal(await editor.getByRole('button', { name: '关闭编辑', exact: true }).isEnabled(), false);
  assert.equal(await cards.first().getByRole('button', { name: '收起编辑', exact: true }).isEnabled(), false);
  await page.evaluate(() => window.releaseDownloadsTest.resolveUpload());
  await editor.getByText('文件已添加到这个版本。', { exact: true }).waitFor();
  await page.goto(baseUrl + '?new&residual');
  await page.getByRole('textbox', { name: '版本介绍', exact: true }).fill('Release notes');
  await page.getByRole('button', { name: '预览发布效果', exact: true }).click();
  await page.getByTestId('release-recovery').waitFor();
  assert.match(await page.getByTestId('release-recovery').innerText(), /Example release · v0.01/);
  assert.equal(await page.getByRole('button', { name: '确认发布新版本', exact: true }).isEnabled(), false, 'An uncleaned draft must not trigger another publication');
  await page.getByRole('button', { name: '查看 GitHub 草稿', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.releaseDownloadsTest.links), ['https://github.com/tester/long-notes/releases']);
  await page.goto(baseUrl + '?new&resume');
  await page.getByRole('button', { name: '添加文件', exact: false }).click();
  await page.getByRole('button', { name: '移除 first.zip', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '移除 first.zip', exact: true }).isEnabled(), false, 'Confirmed draft attachments must stay selected during resume');
  assert.equal(await page.getByRole('button', { name: '移除 second.zip', exact: true }).isEnabled(), true, 'Unfinished files can still be edited');
  assert.equal(await page.getByRole('textbox', { name: '版本号', exact: true }).isEnabled(), false, 'Resume must keep the original draft version');
  assert.equal(await page.getByRole('button', { name: 'Alpha 测试版', exact: true }).isEnabled(), false);
  assert.deepEqual(regressions, [], 'Release feature regressions');
  assert.deepEqual(errors, []);
  console.log('Release download component regression checks passed.');
} finally {
  await browser?.close();
  await server.close();
}
