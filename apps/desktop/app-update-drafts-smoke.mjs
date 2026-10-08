import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

// The real renderer runs against an isolated IPC fixture. All network traffic
// and unregistered EasyHub operations are blocked; saves only mutate fixture data.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out', 'app-update-drafts-smoke');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'isolated-'));
const profile = join(run, 'profile');
await mkdir(profile);
const launcher = join(run, 'launch.cjs');
await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
process.env.EASYHUB_PROXY_APP_ONLY_TEST = '1';
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Isolated update and draft fixture</title>';
globalThis.draftRegister = ipcMain.handle.bind(ipcMain);
globalThis.draftForbidden = [];
ipcMain.handle = (channel, handler) => globalThis.draftRegister(channel, channel.startsWith('easyhub:') ? () => {
  globalThis.draftForbidden.push(channel); throw new Error('Unmocked draft IPC: ' + channel);
} : handler);
require(${JSON.stringify(join(desktop, 'out', 'main', 'index.js'))});
`);
const app = await electron.launch({ executablePath: electronPath, args: [launcher], cwd: desktop });
const started = Date.now();
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
    const renderer = BrowserWindow.getAllWindows()[0].webContents;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      globalThis.draftRegister(channel, (event, ...args) => {
        if (event.sender !== renderer) throw new Error('Fixture called by another renderer');
        return handler(...args);
      });
    };
    const now = new Date().toISOString();
    const fixture = globalThis.draftFixture = { account: 'draft-author', updateMode: 'current', editMode: 'success', links: [], edits: [], publishes: [], reads: [] };
    const repository = (id, name) => ({ id, name, full_name: `draft-author/${name}`, description: 'Isolated release draft project.',
      owner: { login: 'draft-author', avatar_url: '' }, private: false, default_branch: 'main', updated_at: now,
      permissions: { admin: true, push: true, pull: true }, open_issues_count: 0 });
    const repositories = [repository(7101, 'draft-project-one'), repository(7102, 'draft-project-two')];
    const release = (id) => ({ id, tag_name: 'v1.0.0', name: 'Published original title', body: 'Published original description.',
      draft: false, prerelease: false, published_at: now, assets: [], html_url: `https://github.com/draft-author/draft-project-one/releases/tag/v1.0.0` });
    const releases = { 'draft-project-one': [release(7201)], 'draft-project-two': [release(7202)] };
    mock('easyhub:auth-status', () => ({ user: { login: fixture.account, name: fixture.account, avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false }));
    mock('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    mock('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', engineVersion: '12.1.2' }));
    mock('easyhub:open-external-link', (url) => { fixture.links.push(url); });
    mock('easyhub:release-choose-files', inline => inline ? [{ id: 'fixture-local-image-grant', name: 'draft-picture.png', size: 68, mimeType: 'image/png',
      previewDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBecAAAAASUVORK5CYII=' }] : []);
    mock('easyhub:release-edit', input => {
      fixture.edits.push(input);
      if (fixture.editMode === 'error') throw new Error('The fixture could not save this release.');
      const items = releases[input.repo];
      const index = items.findIndex(item => item.id === input.releaseId);
      assertFixture(index >= 0);
      const updated = { ...items[index], name: input.title, body: input.body, prerelease: input.prerelease };
      items[index] = updated;
      return updated;
    });
    mock('easyhub:release-publish', input => {
      fixture.publishes.push(input);
      const created = { ...release(7301), name: input.title, body: input.body, tag_name: input.tagName, prerelease: input.channel !== 'stable' };
      releases[input.repo].unshift(created);
      return created;
    });
    function assertFixture(condition) { if (!condition) throw new Error('Invalid fixture release'); }
    mock('easyhub:github', (action, ...args) => {
      fixture.reads.push(action);
      if (action === 'appUpdate') {
        if (fixture.updateMode === 'error') throw new Error('raw internal update transport error');
        return { currentVersion: '1.1.0', latestVersion: fixture.updateMode === 'new' ? '1.2.0' : '1.1.0',
          available: fixture.updateMode === 'new', releaseUrl: 'https://github.com/FuFu-Flash/EasyHub/releases/tag/v1.2.0' };
      }
      if (action === 'repos') return args[0] === 1 ? repositories : [];
      if (action === 'activityCounts') return Object.fromEntries(repositories.map(repo => [repo.id, { issues: 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }]));
      if (action === 'isStarred') return false;
      if (action === 'readme') return '# Draft fixture\n\nNo remote writes.';
      if (action === 'commits' || action === 'comments') return [];
      if (action === 'issuesPage' || action === 'commitsPage' || action === 'commentsPage') return { items: [], nextPage: null };
      if (action === 'releases') return releases[args[1]] ?? [];
      if (action === 'releasesPage') return { items: releases[args[1]] ?? [], nextPage: null };
      if (action === 'releaseByTag') return (releases[args[1]] ?? []).find(item => item.tag_name === args[2]) ?? null;
      globalThis.draftForbidden.push('github:' + action);
      throw new Error('Unexpected fixture action: ' + action);
    });
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1060, height: 700 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), join(desktop, 'out', 'renderer', 'index.html'));
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('easyhub:language', 'zh'); localStorage.setItem('easyhub:auto-translate', 'false'); });
  const reload = async () => { await page.reload(); await page.locator('.live-connected').waitFor(); };
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const draftKey = (account, repo, kind, id = 'new') => JSON.stringify([account, String(repo), kind, String(id)]);
  const storedDraft = key => page.evaluate(key => {
    const entries = JSON.parse(localStorage.getItem('easyhub:user-drafts:v1') || '[]');
    return entries.find(item => item.key === key)?.value ?? null;
  }, key);
  const openProject = async name => {
    await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
    await page.getByRole('button', { name: /我的云端项目/ }).click();
    await page.locator('.cloud-row').filter({ hasText: name }).getByRole('button', { name: '查看', exact: true }).click();
    await page.locator('.detail-name-row').getByRole('heading', { name, exact: true }).waitFor();
  };
  const openNewRelease = async name => {
    await openProject(name);
    await page.getByRole('button', { name: '发布新版本', exact: true }).click();
    await page.locator('.release-page').waitFor();
  };
  const openReleaseEdit = async name => {
    await openProject(name);
    await page.getByRole('button', { name: '编辑发行版', exact: true }).click();
    await page.getByTestId('release-edit-panel').waitFor();
  };
  await reload();

  // Update results and failures stay in Settings; download is an explicitly
  // controlled external-link call, never a browser process or actual download.
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click();
  const update = page.locator('.app-update-panel');
  await update.getByRole('button', { name: '检查更新', exact: true }).click();
  await update.getByText('已是最新版本。', { exact: true }).waitFor();
  assert.equal(await update.getByRole('button', { name: '查看更新并下载', exact: true }).count(), 0);
  await app.evaluate(() => { globalThis.draftFixture.updateMode = 'new'; });
  await update.getByRole('button', { name: '检查更新', exact: true }).click();
  await update.getByText('发现新版本 1.2.0', { exact: true }).waitFor();
  await update.getByRole('button', { name: '查看更新并下载', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.draftFixture.links), ['https://github.com/FuFu-Flash/EasyHub/releases/tag/v1.2.0']);
  await app.evaluate(() => { globalThis.draftFixture.updateMode = 'error'; });
  await update.getByRole('button', { name: '检查更新', exact: true }).click();
  await update.getByRole('alert').waitFor();
  assert.equal(await update.getByRole('alert').innerText(), '暂时无法检查更新，请稍后重试。');
  assert.doesNotMatch(await update.innerText(), /raw internal|Error invoking/);
  await page.screenshot({ path: join(output, 'update-network-error.png') });

  // New-release text persists, while a revoked native image/file grant cannot
  // be reused after reload. External image/link URLs survive verbatim.
  const title = 'A carefully written custom release title';
  const body = '## Release notes\n\nKeep [documentation](https://example.com/guide) and ![hosted image](https://example.com/image.png).';
  const newKey = draftKey('draft-author', 7101, 'release');
  await openNewRelease('draft-project-one');
  await page.getByRole('textbox', { name: '版本名称', exact: true }).fill(title);
  await page.getByRole('button', { name: 'Beta 测试版', exact: true }).click();
  await page.getByRole('textbox', { name: '版本号', exact: true }).fill('beta0.4');
  await page.getByRole('textbox', { name: '版本介绍', exact: true }).fill(body);
  await page.getByRole('button', { name: '添加图片', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '选择本地图片', exact: true }).click();
  await page.locator('.release-selected-file').filter({ hasText: 'draft-picture.png' }).waitFor();
  assert.match(await page.getByRole('textbox', { name: '版本介绍', exact: true }).inputValue(), /easyhub-image:fixture-local-image-grant/);
  await frame();
  assert.equal(JSON.parse(await storedDraft(newKey)).title, title);
  await reload();
  await openNewRelease('draft-project-one');
  assert.equal(await page.getByRole('textbox', { name: '版本名称', exact: true }).inputValue(), title);
  assert.equal(await page.getByRole('textbox', { name: '版本号', exact: true }).inputValue(), 'beta0.4');
  assert.equal(await page.getByRole('button', { name: 'Beta 测试版', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal((await page.getByRole('textbox', { name: '版本介绍', exact: true }).inputValue()).trim(), body);
  await page.getByText('请重新添加上次选择的附件和本地图片。', { exact: false }).waitFor();
  assert.equal(await page.locator('.release-selected-file').count(), 0);
  await page.getByRole('button', { name: '预览发布效果', exact: true }).click();
  assert.equal(await page.locator('.release-preview-stage img[src^="easyhub-image:"]').count(), 0);
  assert.equal(await page.locator('.release-preview-stage img[src^="data:"]').count(), 0);
  await page.screenshot({ path: join(output, 'recovered-release-preview.png') });

  await openNewRelease('draft-project-two');
  assert.notEqual(await page.getByRole('textbox', { name: '版本名称', exact: true }).inputValue(), title);
  assert.equal(await page.getByRole('textbox', { name: '版本介绍', exact: true }).inputValue(), '');
  await app.evaluate(() => { globalThis.draftFixture.account = 'another-account'; });
  await reload();
  await openNewRelease('draft-project-one');
  assert.notEqual(await page.getByRole('textbox', { name: '版本名称', exact: true }).inputValue(), title);
  assert.equal(await page.getByRole('textbox', { name: '版本介绍', exact: true }).inputValue(), '');
  await app.evaluate(() => { globalThis.draftFixture.account = 'draft-author'; });
  await reload();
  await openNewRelease('draft-project-one');
  assert.equal(await page.getByRole('textbox', { name: '版本名称', exact: true }).inputValue(), title);

  // Editing an existing release restores its separate draft after closing the
  // editor and after reload. Failed saves retain it; successful saves clear it.
  const editKey = draftKey('draft-author', 7101, 'release-edit', 7201);
  const editedTitle = 'Saved release title after review';
  const editedBody = '<details><summary>Notes</summary>\n\nPersistent edit body.\n\n</details>';
  await openReleaseEdit('draft-project-one');
  let edit = page.getByTestId('release-edit-panel');
  await edit.getByRole('textbox', { name: '版本名称', exact: true }).fill(editedTitle);
  await edit.getByRole('textbox', { name: '版本介绍', exact: true }).fill(editedBody);
  await edit.getByRole('checkbox', { name: '这是测试版', exact: true }).check();
  await frame();
  assert.equal(JSON.parse(await storedDraft(editKey)).prerelease, true);
  await edit.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await page.locator('.release-edit-entry').getByRole('button', { name: '编辑发行版', exact: true }).click();
  edit = page.getByTestId('release-edit-panel');
  assert.equal(await edit.getByRole('textbox', { name: '版本名称', exact: true }).inputValue(), editedTitle);
  await reload();
  await openReleaseEdit('draft-project-one');
  edit = page.getByTestId('release-edit-panel');
  assert.equal(await edit.getByRole('textbox', { name: '版本介绍', exact: true }).inputValue(), editedBody);
  assert.equal(await edit.getByRole('checkbox', { name: '这是测试版', exact: true }).isChecked(), true);
  await app.evaluate(() => { globalThis.draftFixture.editMode = 'error'; });
  await edit.getByRole('button', { name: '保存版本介绍', exact: true }).click();
  await edit.getByRole('alert').waitFor();
  assert.equal(JSON.parse(await storedDraft(editKey)).title, editedTitle);
  await app.evaluate(() => { globalThis.draftFixture.editMode = 'success'; });
  await edit.getByRole('button', { name: '保存版本介绍', exact: true }).click();
  await edit.getByText('版本介绍已更新。', { exact: true }).waitFor();
  await frame();
  assert.equal(await storedDraft(editKey), null);
  assert.deepEqual(await app.evaluate(() => globalThis.draftFixture.edits.at(-1)), { owner: 'draft-author', repo: 'draft-project-one', releaseId: 7201, title: editedTitle, body: editedBody, prerelease: true });
  await page.screenshot({ path: join(output, 'release-edit-saved.png') });

  await openNewRelease('draft-project-one');
  assert.equal(await page.getByRole('textbox', { name: '版本名称', exact: true }).inputValue(), title);
  await page.getByRole('button', { name: '预览发布效果', exact: true }).click();
  await page.getByRole('button', { name: '确认发布新版本', exact: true }).click();
  await page.getByTestId('release-downloads').waitFor();
  await frame();
  assert.equal(await storedDraft(newKey), null);
  const published = await app.evaluate(() => globalThis.draftFixture.publishes.at(-1));
  assert.equal(published.title, title);
  assert.equal(published.tagName, 'beta0.4');
  assert.deepEqual(published.assetIds, [], 'Reloaded local-image grants must not be submitted');
  assert.doesNotMatch(published.body, /easyhub-image:/);
  assert.deepEqual(await app.evaluate(() => globalThis.draftForbidden), []);
  assert.deepEqual(errors, []);
  console.log(`PASS: update current/new/network/link handling, scoped release drafts, image-grant recovery, edit/publish clear after success (${((Date.now() - started) / 1000).toFixed(1)}s).`);
} finally { await app.close(); }
