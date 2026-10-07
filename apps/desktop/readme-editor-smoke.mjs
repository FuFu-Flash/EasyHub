import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { smokeEnvironment, smokeExecutable, smokeRenderer } from './smoke-runtime.mjs';

const desktop = dirname(fileURLToPath(import.meta.url));
const executable = smokeExecutable(desktop);
const packaged = process.argv.includes('--packaged');
const mode = packaged ? 'packaged' : executable ? 'executable' : 'dev';
const isMac = process.platform === 'darwin';
const output = join(desktop, 'out', 'readme-editor');
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(join(output, 'isolated-'));
const profile = join(fixture, 'profile');
const folder = join(fixture, 'html-preview');
await mkdir(profile);
await mkdir(folder);
const imageServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'image/png' });
  response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'));
});
await new Promise((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
const imageUrl = `http://127.0.0.1:${imageServer.address().port}/preview.png`;
const original = `<div align="center">
<img src="docs/logo.png" width="72" height="72" alt="Preview logo">
<h1>HTML preview fixture</h1>
<p>首页</p>
</div>

<details>
<summary>More information</summary>

## Installation

**Mixed Markdown** and <em>inline HTML</em>.

</details>

<table><tr><th>File</th><th>Download</th></tr><tr><td>app.exe</td><td><a href="https://example.invalid/guide">Guide</a></td></tr></table>

\`\`\`html
<script>example code only</script>
\`\`\`

<script>window.htmlPreviewExecuted = true</script>
<img src="${imageUrl}" alt="Local screenshot" onerror="window.htmlPreviewExecuted = true">
<a href="javascript:alert(1)" onclick="window.htmlPreviewExecuted = true">Unsafe link</a>
<iframe src="https://example.invalid/embedded"></iframe>
`;
await writeFile(join(folder, 'README.md'), original, 'utf8');
let application;
try {
  application = await electron.launch({
    executablePath: executable || electronPath,
    args: executable ? [] : [desktop],
    cwd: desktop,
    env: { ...smokeEnvironment(profile), ELECTRON_RENDERER_URL: 'data:text/html,<title>README editor fixture</title>' },
  });
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
  const applicationInfo = await application.evaluate(({ app }) => ({ isPackaged: app.isPackaged, version: app.getVersion() }));
  if (packaged) assert.equal(applicationInfo.isPackaged, true, '--packaged must launch an actual application bundle');
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await application.evaluate(({ BrowserWindow, ipcMain, session }, { folder, original, imageUrl }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const now = new Date().toISOString();
    const fixtureState = globalThis.easyHubReadmePreviewFixture = { saves: [], external: [], forbidden: [], network: [] };
    const repo = { id: 801, name: 'html-preview', full_name: 'fixture-user/html-preview', description: 'README editor fixture',
      private: true, archived: false, fork: false, default_branch: 'main', updated_at: now, pushed_at: now,
      owner: { login: 'fixture-user', avatar_url: '' }, permissions: { pull: true, push: true, admin: true },
      open_issues_count: 0, stargazers_count: 0 };
    const links = [{ id: 'html-preview-local', repositoryId: repo.id, owner: repo.owner.login, name: repo.name, localPath: folder, lastOpenedAt: now }];
    const replace = (channel, handler) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (event, ...args) => {
        assertSender(event.sender);
        return handler(...args);
      });
    };
    function assertSender(sender) { if (sender !== window.webContents) throw new Error('Invalid fixture sender'); }
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      if (details.url.startsWith(imageUrl)) return callback({ cancel: false });
      if (details.url === 'https://raw.githubusercontent.com/fixture-user/html-preview/main/docs/logo.png') return callback({ redirectURL: imageUrl });
      fixtureState.network.push(details.url);
      callback({ cancel: true });
    });
    for (const channel of ['easyhub:auth-start', 'easyhub:auth-start-delete', 'easyhub:auth-poll', 'easyhub:auth-logout',
      'easyhub:choose-folder', 'easyhub:local-inspect', 'easyhub:local-connect', 'easyhub:local-create', 'easyhub:local-download',
      'easyhub:local-publish', 'easyhub:local-sync', 'easyhub:local-open-folder', 'easyhub:hosts-set-enabled', 'easyhub:hosts-refresh',
      'easyhub:github-proxy-set-enabled', 'easyhub:github-proxy-refresh',
      'easyhub:ai-save-settings', 'easyhub:ai-forget-key', 'easyhub:ai-test-connection', 'easyhub:ai-review-pull',
      'easyhub:release-publish', 'easyhub:release-edit', 'easyhub:release-add-assets', 'easyhub:release-remove-asset']) {
      replace(channel, () => { fixtureState.forbidden.push(channel); throw new Error('Forbidden external action in README editor fixture'); });
    }
    replace('easyhub:auth-status', () => ({ user: { login: 'fixture-user', name: 'Fixture User', avatar_url: '', html_url: 'https://example.invalid/user' }, clientId: 'fixture' }));
    replace('easyhub:ai-settings', () => ({ enabled: false, hasKey: false, baseUrl: '', model: '' }));
    replace('easyhub:hosts-status', () => ({ enabled: false, updatedAt: null, source: 'fixture' }));
    replace('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    replace('easyhub:local-list', () => links);
    replace('easyhub:local-discovery-roots', () => []);
    replace('easyhub:local-status', () => ({ files: [], needsReview: false }));
    replace('easyhub:local-check-sync', () => ({ state: 'current', files: [] }));
    replace('easyhub:local-read-introduction', () => process.getBuiltinModule('node:fs/promises').readFile(`${folder}/README.md`, 'utf8'));
    replace('easyhub:local-save-introduction', async (id, expected, content) => {
      const fs = process.getBuiltinModule('node:fs/promises');
      if (id !== links[0].id || expected !== await fs.readFile(`${folder}/README.md`, 'utf8')) throw new Error('Invalid isolated README save');
      fixtureState.saves.push(content);
      await fs.writeFile(`${folder}/README.md`, content, 'utf8');
    });
    replace('easyhub:open-external-link', (url) => fixtureState.external.push(url));
    replace('easyhub:github-cancel', () => undefined);
    replace('easyhub:cancel-translation', () => undefined);
    replace('easyhub:translate-content', () => { fixtureState.forbidden.push('translate-content'); throw new Error('Editor content must remain original'); });
    replace('easyhub:github', (action, ...args) => {
      if (action === 'repos') return args[0] === 1 ? [repo] : [];
      if (action === 'activityCounts') return { [repo.id]: { issues: 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 } };
      if (action === 'readme') return original;
      if (action === 'commits') return [];
      if (action === 'issuesPage') return { items: [], nextPage: null };
      if (action === 'isStarred') return false;
      fixtureState.forbidden.push(`github:${action}`);
      throw new Error('Unexpected GitHub action in README editor fixture');
    });
  }, { folder, original, imageUrl });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await application.evaluate(async ({ BrowserWindow }, renderer) => {
    await BrowserWindow.getAllWindows()[0].loadFile(renderer);
  }, smokeRenderer(desktop, executable));
  await page.locator('.live-connected').waitFor();
  if (isMac) {
    await page.locator('.topbar-reference .native-window-controls').waitFor();
    assert.equal(await page.locator('.topbar-reference .window-dot').count(), 0, 'macOS must keep system-owned traffic lights');
  }

  const macCompatibility = { nativeTrafficLightSpacer: isMac, nativeUndoRedo: false, modalNavigationGuard: false };
  async function waitForMacMenu(modalOpen) {
    const deadline = Date.now() + 15000;
    let snapshot;
    do {
      snapshot = await application.evaluate(({ Menu }) => {
        const flatten = (menu) => menu.items.flatMap((item) => [{ id: item.id, role: item.role?.toLowerCase(),
          enabled: item.enabled, accelerator: item.accelerator }, ...(item.submenu ? flatten(item.submenu) : [])]);
        const menu = Menu.getApplicationMenu();
        if (!menu) throw new Error('The native macOS application menu is missing');
        return flatten(menu);
      });
      const home = snapshot.find((item) => item.id === 'easyhub-home');
      const refresh = snapshot.find((item) => item.id === 'easyhub-refresh');
      if (home?.enabled === !modalOpen && refresh?.enabled === !modalOpen) return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 40));
    } while (Date.now() < deadline);
    assert.fail(`The native menu did not reflect editor modal state: ${JSON.stringify(snapshot)}`);
  }
  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: /我的云端项目/ }).click();
  await page.locator('.cloud-row').filter({ hasText: 'html-preview' }).locator('.plain-heading').click();
  await page.getByRole('button', { name: '编辑介绍', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑项目介绍' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '边写边看', exact: true }).waitFor({ timeout: 3000 });
  const source = dialog.getByRole('textbox', { name: '项目介绍内容' });
  assert.equal(await source.inputValue(), original);
  if (isMac) {
    const menu = await waitForMacMenu(true);
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectall']) {
      assert.ok(menu.some((item) => item.role === role), `Missing native editing role: ${role}`);
    }
    const normalizeAccelerator = (value) => value?.toLowerCase().replace(/command/g, 'cmd').replace(/\s/g, '');
    assert.equal(normalizeAccelerator(menu.find((item) => item.role === 'undo')?.accelerator), 'cmd+z');
    assert.equal(normalizeAccelerator(menu.find((item) => item.role === 'redo')?.accelerator), 'cmd+shift+z');
    // Attempt the handler directly as well: main and renderer must both reject
    // navigation behind an editor, even when an IPC menu action is invoked.
    await application.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu().getMenuItemById('easyhub-home');
      item.click(item, BrowserWindow.getAllWindows()[0], {});
    });
    await source.focus();
    await source.press('Meta+1');
    assert.equal(await dialog.isVisible(), true, 'A blocked navigation shortcut must preserve the editor');
    assert.equal(await source.inputValue(), original, 'A blocked navigation shortcut must preserve the draft');
    macCompatibility.modalNavigationGuard = true;

    const undoDraft = `${original}\n\nNative editing shortcut fixture`;
    await source.evaluate((element) => {
      element.focus(); element.setSelectionRange(element.value.length, element.value.length);
    });
    await page.keyboard.insertText('\n\nNative editing shortcut fixture');
    assert.equal(await source.inputValue(), undoDraft);
    await source.press('Meta+Z');
    await page.waitForFunction((expected) => document.querySelector('.intro-editor-source textarea')?.value === expected, original);
    await source.press('Meta+Shift+Z');
    await page.waitForFunction((expected) => document.querySelector('.intro-editor-source textarea')?.value === expected, undoDraft);
    await source.press('Meta+Z');
    await page.waitForFunction((expected) => document.querySelector('.intro-editor-source textarea')?.value === expected, original);
    macCompatibility.nativeUndoRedo = true;
  }
  await dialog.getByRole('button', { name: '边写边看', exact: true }).click();
  const preview = dialog.getByRole('region', { name: '项目介绍预览' });
  await preview.getByRole('heading', { name: 'HTML preview fixture' }).waitFor();
  assert.equal(await preview.locator('details > summary').innerText(), 'More information');
  await preview.locator('summary').click();
  assert.equal(await preview.locator('details h2').innerText(), 'Installation');
  await preview.getByText('Mixed Markdown', { exact: true }).waitFor();
  assert.equal(await preview.locator('table tr').count(), 2);
  await page.waitForFunction(() => [...document.querySelectorAll('.intro-editor-preview img')].every((image) => image.complete && image.naturalWidth > 0));
  assert.equal(await preview.locator('img').first().getAttribute('width'), '72');
  assert.equal(await preview.locator('[align="center"]').evaluate((element) => getComputedStyle(element).textAlign), 'center');
  const imageCentered = await preview.locator('[align="center"]').evaluate((element) => {
    const container = element.getBoundingClientRect();
    const image = element.querySelector('img').getBoundingClientRect();
    return Math.abs((container.left + container.right) / 2 - (image.left + image.right) / 2) < 2;
  });
  assert.equal(imageCentered, true, 'HTML images must follow their centered container');
  assert.equal(await preview.locator('script,iframe,[onclick],[onerror]').count(), 0);
  assert.equal(await preview.getByText('Unsafe link', { exact: true }).getAttribute('href'), null);
  assert.equal(await page.evaluate(() => window.htmlPreviewExecuted), undefined);
  assert.match(await preview.locator('pre code').innerText(), /<script>example code only<\/script>/);
  await preview.getByRole('link', { name: 'Guide', exact: true }).click();
  assert.deepEqual(await application.evaluate(() => globalThis.easyHubReadmePreviewFixture.external), ['https://example.invalid/guide']);
  const edited = original.replace('HTML preview fixture', 'Live HTML preview updated');
  await dialog.getByRole('textbox', { name: '项目介绍内容' }).fill(edited);
  await preview.getByRole('heading', { name: 'Live HTML preview updated' }).waitFor();
  assert.equal(await readFile(join(folder, 'README.md'), 'utf8'), original, 'Preview must not save the README');
  assert.equal(await dialog.getByRole('button', { name: '保存介绍' }).isDisabled(), true);
  await dialog.getByRole('button', { name: '预览', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: '项目介绍内容' }).count(), 0);
  await preview.getByRole('heading', { name: 'Live HTML preview updated' }).waitFor();
  await dialog.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: '项目介绍内容' }).inputValue(), edited);
  await dialog.getByRole('button', { name: '边写边看', exact: true }).click();
  for (const width of [1400, 700]) {
    await page.setViewportSize({ width, height: 900 });
    const sourceBox = await dialog.locator('.intro-editor-source').boundingBox();
    const previewBox = await dialog.locator('.intro-editor-live-preview').boundingBox();
    if (width > 760) assert.ok(previewBox.x >= sourceBox.x + sourceBox.width, 'Wide editor must have side-by-side panes');
    else assert.ok(previewBox.y >= sourceBox.y + sourceBox.height, 'Narrow editor must stack panes');
    if (width > 760) {
      const sourceContent = await dialog.getByRole('textbox', { name: '项目介绍内容' }).boundingBox();
      const previewContent = await preview.boundingBox();
      assert.ok(Math.abs(sourceContent.y - previewContent.y) < 2, 'Editor and preview must align horizontally');
    }
    assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, 'Editor must not overflow horizontally');
    await page.screenshot({ path: join(output, `${mode}-${width}.png`) });
  }
  const responsiveMeasurements = [];
  const measureResponsiveEditor = async (width, height, state = 'editing') => {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measurement = await dialog.evaluate((element) => {
      const rectangle = (target) => {
        const box = target.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      };
      const save = element.querySelector('.modal-actions .button-primary');
      const saveBox = rectangle(save);
      const saveTarget = document.elementFromPoint(saveBox.x + saveBox.width / 2, saveBox.y + saveBox.height / 2);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        dialog: rectangle(element),
        body: rectangle(element.querySelector('.intro-editor-body')),
        source: rectangle(element.querySelector('.intro-editor-source textarea')),
        preview: rectangle(element.querySelector('.intro-editor-live-preview .intro-editor-preview')),
        footer: rectangle(element.querySelector('.modal-actions')),
        sourcePane: rectangle(element.querySelector('.intro-editor-source')),
        previewPane: rectangle(element.querySelector('.intro-editor-live-preview')),
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
        pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        saveReachable: save === saveTarget || save.contains(saveTarget),
      };
    });
    measurement.state = state;
    responsiveMeasurements.push(measurement);
    assert.equal(await dialog.getByRole('textbox', { name: '项目介绍内容' }).inputValue(), edited, 'Resizing the editor must preserve its draft');
    await preview.getByRole('heading', { name: 'Live HTML preview updated' }).waitFor();
    await page.screenshot({ path: join(output, `${mode}-${width}x${height}-${state}.png`) });
    return measurement;
  };
  const wideShort = await measureResponsiveEditor(1400, 750);
  const wideTall = await measureResponsiveEditor(1400, 1100);
  await measureResponsiveEditor(1060, 700);
  await measureResponsiveEditor(900, 600);
  await measureResponsiveEditor(700, 600);
  await measureResponsiveEditor(720, 520);
  await dialog.getByRole('button', { name: '添加图片', exact: true }).click();
  await measureResponsiveEditor(900, 600, 'image-form');
  await dialog.getByRole('button', { name: '取消插入', exact: true }).click();
  await dialog.getByRole('button', { name: '添加链接', exact: true }).click();
  await measureResponsiveEditor(700, 600, 'link-form');
  await dialog.getByRole('button', { name: '取消插入', exact: true }).click();
  await writeFile(join(output, `${mode}-responsive-measurements.json`), `${JSON.stringify(responsiveMeasurements, null, 2)}\n`);
  const responsiveFailures = [];
  const responsiveCheck = (condition, message) => { if (!condition) responsiveFailures.push(message); };
  responsiveCheck(wideTall.source.height > wideShort.source.height + 80, `The editing area must grow with window height: ${wideShort.source.height}px at 750px tall, ${wideTall.source.height}px at 1100px tall`);
  responsiveCheck(wideTall.preview.height > wideShort.preview.height + 80, `The preview must grow with window height: ${wideShort.preview.height}px at 750px tall, ${wideTall.preview.height}px at 1100px tall`);
  for (const measurement of responsiveMeasurements) {
    const context = `${measurement.viewport.width}x${measurement.viewport.height} (${measurement.state})`;
    responsiveCheck(measurement.dialog.x >= -1 && measurement.dialog.right <= measurement.viewport.width + 1, `Dialog must fit window width at ${context}`);
    responsiveCheck(measurement.dialog.y >= -1 && measurement.dialog.bottom <= measurement.viewport.height + 1, `Dialog must fit window height at ${context}`);
    responsiveCheck(measurement.footer.y >= measurement.dialog.y && measurement.footer.bottom <= measurement.viewport.height + 1, `Save and cancel actions must stay inside the window at ${context}`);
    responsiveCheck(measurement.saveReachable, `The save button must remain reachable at ${context}`);
    responsiveCheck(!measurement.horizontalOverflow && !measurement.pageHorizontalOverflow, `Resizing must not introduce horizontal page overflow at ${context}`);
    responsiveCheck(measurement.source.height >= 70 && measurement.preview.height >= 70, `Editing and preview must retain usable content areas at ${context}`);
    if (measurement.state === 'editing') {
      responsiveCheck(measurement.source.y >= measurement.body.y - 1 && measurement.source.bottom <= measurement.body.bottom + 1, `The whole editing area must fit above the footer at ${context}`);
      responsiveCheck(measurement.preview.y >= measurement.body.y - 1 && measurement.preview.bottom <= measurement.body.bottom + 1, `The whole preview area must fit above the footer at ${context}`);
    }
    if (measurement.viewport.width > 760) {
      responsiveCheck(measurement.previewPane.x >= measurement.sourcePane.right - 1, `Wide windows must keep editor and preview side by side at ${context}`);
      responsiveCheck(Math.abs(measurement.source.y - measurement.preview.y) < 2 && Math.abs(measurement.source.height - measurement.preview.height) < 2, `Editor and preview must share their alignment and available height at ${context}`);
    } else responsiveCheck(measurement.previewPane.y >= measurement.sourcePane.bottom - 1, `Narrow windows must stack editor and preview at ${context}`);
  }
  assert.deepEqual(responsiveFailures, [], `README live preview must adapt as the window is resized:\n${responsiveFailures.join('\n')}`);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  if (isMac) await waitForMacMenu(false);
  assert.equal(await readFile(join(folder, 'README.md'), 'utf8'), original, 'Cancel must preserve the README');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('button', { name: '选择语言' }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Introduction', exact: true }).click();
  const englishDialog = page.getByRole('dialog', { name: 'Edit Project Introduction' });
  await englishDialog.getByRole('button', { name: 'Live preview', exact: true }).click();
  await englishDialog.getByText('首页', { exact: true }).waitFor();
  assert.equal(await englishDialog.getByRole('textbox', { name: 'Introduction content' }).inputValue(), original);
  await englishDialog.getByRole('textbox', { name: 'Introduction content' }).fill('');
  await englishDialog.getByText('This project has no introduction yet.', { exact: true }).waitFor();
  await englishDialog.getByRole('textbox', { name: 'Introduction content' }).fill(original);
  await englishDialog.getByText('首页', { exact: true }).waitFor();
  await englishDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await application.evaluate(() => globalThis.easyHubReadmePreviewFixture.saves), []);
  await page.getByRole('button', { name: 'Choose language' }).click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: '编辑介绍', exact: true }).click();
  await dialog.getByRole('button', { name: '边写边看', exact: true }).click();
  await dialog.getByRole('textbox', { name: '项目介绍内容' }).fill(edited);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '保存介绍', exact: true }).click();
  await page.getByText('介绍已保存到本地，发布源码后同步到 GitHub。', { exact: true }).waitFor();
  assert.equal(await readFile(join(folder, 'README.md'), 'utf8'), edited, 'Save must preserve authored HTML exactly');
  assert.deepEqual(await application.evaluate(() => globalThis.easyHubReadmePreviewFixture.saves), [edited]);
  assert.deepEqual(errors, [], 'Editor must not throw renderer errors');
  const isolation = await application.evaluate(() => globalThis.easyHubReadmePreviewFixture);
  assert.deepEqual(isolation.forbidden, [], 'No account, translation, project or GitHub mutation is allowed');
  assert.deepEqual(isolation.network, [], 'No external network request is allowed');
  await writeFile(join(output, `${mode}-results.json`), `${JSON.stringify({ status: 'passed', mode,
    platform: process.platform, application: applicationInfo, executable: executable || electronPath,
    isolatedUserData: true, inMemoryCredentials: true, remoteWrites: false,
    localReadmeSaves: isolation.saves.length, responsiveViewportCases: responsiveMeasurements.length,
    responsiveViewportMeasurements: `${mode}-responsive-measurements.json`, macCompatibility,
    nativeWindowResize: 'Viewport dimensions are emulated by Playwright; native window constraints are not changed.',
  }, null, 2)}\n`);
  process.stdout.write(`README HTML editing, live preview, images, links, folding, mixed Markdown, raw source, sanitization, cancel, responsive layout and platform compatibility passed (${mode}).\n`);
} finally {
  if (application) await application.close();
  await new Promise((resolve) => imageServer.close(resolve));
  const root = await realpath(output);
  const resolved = await realpath(fixture);
  if (resolved.startsWith(`${root}${sep}isolated-`)) await rm(resolved, { recursive: true, force: true });
}
