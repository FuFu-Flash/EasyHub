import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

// Real Electron renderer/preload, including the shipped CSS. The entire IPC
// surface starts blocked; this fixture allows only controlled reads. Mouse
// movement creates every selection (DOM Range is used solely to measure text).
const desktop = dirname(fileURLToPath(import.meta.url));
const packaged = process.argv.includes('--packaged');
const output = join(desktop, 'out', 'diff-selection-electron-smoke', packaged ? 'packaged' : 'built');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'isolated-'));
const profile = join(run, 'profile');
await mkdir(profile);
const assets = packaged ? join(desktop, 'release', 'win-unpacked', 'resources', 'app.asar', 'out') : join(desktop, 'out');
const launcher = join(run, 'launch.cjs');
await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
process.env.EASYHUB_PROXY_APP_ONLY_TEST = '1';
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Isolated diff selection</title>';
globalThis.selectionRegister = ipcMain.handle.bind(ipcMain);
globalThis.selectionForbidden = [];
ipcMain.handle = (channel, handler) => globalThis.selectionRegister(channel, channel.startsWith('easyhub:') ? () => {
  globalThis.selectionForbidden.push(channel); throw new Error('Blocked diff fixture IPC: ' + channel);
} : handler);
require(${JSON.stringify(join(assets, 'main', 'index.js'))});
`, 'utf8');

const app = await electron.launch({ executablePath: electronPath, args: [launcher], cwd: desktop });
let page;
const results = [];
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await app.evaluate(({ ipcMain, session, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      globalThis.selectionRegister(channel, (event, ...args) => {
        if (event.sender !== window.webContents) throw new Error('Unexpected fixture sender');
        return handler(...args);
      });
    };
    globalThis.selectionCalls = { settings: 0, ai: 0, network: [] };
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, callback) => {
      globalThis.selectionCalls.network.push(request.url); callback({ cancel: true });
    });
    const now = new Date().toISOString();
    const repo = { id: 901, name: 'diff-fixture', full_name: 'fixture-owner/diff-fixture', description: 'Selection fixture',
      owner: { login: 'fixture-owner', avatar_url: '' }, private: true, default_branch: 'main',
      permissions: { pull: true, push: true, admin: true }, updated_at: now, pushed_at: now, open_issues_count: 1 };
    const link = { id: 'local-selection-fixture', repositoryId: repo.id, owner: repo.owner.login,
      name: repo.name, localPath: 'C:/isolated-selection-fixture', lastOpenedAt: now };
    const files = [{ path: 'src/total.ts', kind: 'modified' }];
    const preview = { files, needsReview: false, snapshot: 'a'.repeat(64), pendingPublish: false };
    const pull = { id: 707, number: 7, title: 'Review selectable code', body: 'Read-only diff fixture', state: 'open', draft: false,
      created_at: now, user: { login: 'fixture-author' }, head: { sha: 'b'.repeat(40), ref: 'feature' },
      base: { sha: 'c'.repeat(40), ref: 'main', repo: { id: repo.id } }, comments: 0 };
    for (const channel of ['easyhub:github-cancel', 'easyhub:local-cancel-preview', 'easyhub:ai-cancel-review', 'easyhub:cancel-translation']) mock(channel, () => undefined);
    mock('easyhub:auth-status', () => ({ user: { login: 'fixture-owner', name: 'Fixture Owner', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:local-list', () => [link]);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:local-status', () => preview);
    mock('easyhub:local-preview-changes', () => preview);
    mock('easyhub:local-check-sync', () => ({ state: 'current', files: [] }));
    mock('easyhub:local-read-introduction', () => '# Selection fixture');
    mock('easyhub:local-file-diff', () => ({ path: files[0].path, kind: 'modified', additions: 2, deletions: 1, lines: [
      { kind: 'context', before: 101, after: 101, text: 'function total(a, b) {' },
      { kind: 'deleted', before: 102, text: '  return a - b;' },
      { kind: 'added', after: 102, text: '  const result = a + b;' },
      { kind: 'context', before: 103, after: 103, text: '' },
      { kind: 'added', after: 104, text: '  return result;' },
      { kind: 'context', before: 104, after: 105, text: '}' },
    ] }));
    mock('easyhub:ai-settings', () => { globalThis.selectionCalls.settings++; return {
      providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'fixture-only', hasApiKey: true,
    }; });
    mock('easyhub:ai-explain-code', () => { globalThis.selectionCalls.ai++; throw new Error('AI requests forbidden in mouse selection fixture'); });
    mock('easyhub:github', (action, ...args) => {
      if (action === 'repos') return args[0] === 1 ? [repo] : [];
      if (action === 'activityCounts') return { [repo.id]: { issues: 0, closedIssues: 0, pullRequests: 1, closedPullRequests: 0 } };
      if (action === 'readme') return '# Selection fixture';
      if (action === 'commits' || action === 'comments') return [];
      if (action === 'issuesPage') return { items: [], nextPage: null };
      if (action === 'isStarred') return false;
      if (action === 'pullRequests' || action === 'pullRequestsPage') return [pull];
      if (action === 'pullRequest') return pull;
      if (action === 'pullReviewContext') return { repository: repo, pullRequest: pull, filesTruncated: false, files: [{
        filename: 'src/total.ts', status: 'modified', additions: 2, deletions: 1,
        patch: '@@ -101,4 +101,5 @@\n function total(a, b) {\n-  return a - b;\n+  const result = a + b;\n \n+  return result;\n }',
      }] };
      if (action === 'pullChecks') return { headSha: pull.head.sha,
        checkRuns: { state: 'available', items: [], nextPage: null }, statuses: { state: 'available', items: [], nextPage: null } };
      globalThis.selectionForbidden.push(`github:${action}`); throw new Error('Unexpected fixture GitHub action');
    });
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), join(assets, 'renderer', 'index.html'));
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('easyhub:language', 'zh'); localStorage.setItem('easyhub:layout', 'compact'); });
  await page.reload();
  await page.setViewportSize({ width: 1060, height: 760 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.live-connected').waitFor();

  async function checkSelection(container, name, variant, expected) {
    // Closing the preceding dialog restores focus to its trigger on the next
    // animation frame, which can scroll the page. Finish that real UI lifecycle
    // before measuring physical mouse endpoints for the next independent drag.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await container.scrollIntoViewIfNeeded();
    const code = container.locator('[data-explain-code]');
    assert.equal(await code.count(), 6, 'Fixture must use the complete production line renderer with an empty line');
    const coordinates = await container.evaluate((element, variant) => {
      const nodes = [...element.querySelectorAll('[data-explain-code]')];
      const line = node => node.closest('.local-diff-line, tr');
      const pointIn = (node, edge) => {
        const box = node.getBoundingClientRect();
        return { x: edge === 'end' ? box.right - 0.1 : box.left + 0.1, y: box.top + box.height / 2 };
      };
      const textPoint = (node, edge) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const text = []; let current;
        while ((current = walker.nextNode())) if (current.textContent) text.push(current);
        const target = edge === 'end' ? text.at(-1) : text[0];
        if (!target) return pointIn(node, 'start');
        const range = document.createRange();
        const offset = edge === 'end' ? target.textContent.length - 1 : 0;
        range.setStart(target, offset); range.setEnd(target, offset + 1);
        const box = range.getBoundingClientRect();
        return { x: edge === 'end' ? box.right - 0.1 : box.left + 0.1, y: box.top + box.height / 2 };
      };
      const tailSpace = node => {
        const row = line(node).getBoundingClientRect();
        const region = element.getBoundingClientRect();
        return { x: Math.min(row.right, region.right) - 20, y: row.top + row.height / 2 };
      };
      let start = textPoint(nodes[0], 'start'); let end = textPoint(nodes.at(-1), 'end');
      if (variant === 'tail-forward') start = tailSpace(nodes[0]);
      if (variant === 'tail-reverse') { start = tailSpace(nodes.at(-1)); end = textPoint(nodes[0], 'start'); }
      if (variant === 'number-forward') start = textPoint(line(nodes[0]).querySelector('span, .pull-line-number'), 'start');
      if (variant === 'empty-end') end = tailSpace(nodes[3]);
      if (variant === 'empty-start') start = tailSpace(nodes[3]);
      if (variant.startsWith('hunk')) start = textPoint(element.querySelector('.pull-diff-hunk code'), 'start');
      if (variant === 'hunk-only') end = textPoint(element.querySelector('.pull-diff-hunk code'), 'end');
      const styles = [element, ...element.querySelectorAll('*')].map(node => ({
        className: node.className, select: getComputedStyle(node).userSelect, cursor: getComputedStyle(node).cursor,
      }));
      return { start, end, styles };
    }, variant);
    await page.mouse.move(coordinates.start.x, coordinates.start.y);
    await page.mouse.down();
    await page.mouse.move(coordinates.end.x, coordinates.end.y, { steps: 18 });
    await page.mouse.up();
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    results.push({ name, variant, selected, ...coordinates });
    await writeFile(join(output, 'selection-results.json'), JSON.stringify(results, null, 2));
    await page.screenshot({ path: join(output, `${name}-${variant}-selected.png`) });
    assert.ok(selected.length > 0, `${name}/${variant}: real mouse drag must create a selection`);
    assert.ok(coordinates.styles.every(style => style.select === 'text'), `${name}/${variant}: the complete code region must be selectable, including gutters and trailing space`);
    assert.ok(coordinates.styles.every(style => style.cursor === 'text'), `${name}/${variant}: the complete code region must show an I-beam`);
    const outsideCursor = await page.locator('.sidebar-nav button, .local-selection-row button, .pull-file-toggle').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).cursor));
    assert.ok(outsideCursor.length > 0 && outsideCursor.every(cursor => cursor === 'default'), 'Controls outside code regions keep the default pointer');
    const explanation = container.locator('..');
    if (expected === null) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await explanation.getByRole('button', { name: '让 AI 详细说明', exact: true }).count(), 0, `${name}/${variant}: hunk metadata alone cannot be sent to AI`);
      return;
    }
    await explanation.getByRole('button', { name: '让 AI 详细说明', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI 代码说明', exact: true });
    await dialog.getByText(/fixture-only/).waitFor();
    assert.equal(await dialog.locator('.code-explanation-selection code').textContent(), expected, `${name}/${variant}: confirmation contains only selected lines, excluding gutter numbers/signs/hunk metadata`);
    assert.equal(await app.evaluate(() => globalThis.selectionCalls.ai), 0, 'Opening a selection must never send an AI request');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }

  async function checkRegion(container, name) {
    const expected = 'function total(a, b) {\n  return a - b;\n  const result = a + b;\n\n  return result;\n}';
    await checkSelection(container, name, 'full', expected);
    await checkSelection(container, name, 'tail-forward', expected.slice(expected.indexOf('\n') + 1).trim());
    await checkSelection(container, name, 'tail-reverse', expected);
    await checkSelection(container, name, 'number-forward', expected);
    await checkSelection(container, name, 'empty-end', expected.split('\n').slice(0, 3).join('\n'));
    await checkSelection(container, name, 'empty-start', 'return result;\n}');
    if (name === 'pull-diff') {
      await checkSelection(container, name, 'hunk-forward', expected);
      await checkSelection(container, name, 'hunk-only', null);
    }
  }

  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: /这台电脑/ }).click();
  await page.locator('.project-card').getByRole('button', { name: '打开项目', exact: true }).click();
  await page.getByRole('button', { name: '查看不同', exact: true }).click();
  await checkRegion(page.locator('.local-diff-lines'), 'local-diff');
  await page.locator('.sidebar-nav').getByRole('button', { name: /^问题/ }).click();
  await page.getByRole('tab', { name: /合并请求审查/ }).click();
  await page.locator('.issue-project-header').click();
  await page.getByRole('button', { name: /Review selectable code/ }).click();
  await page.locator('.pull-file-toggle').click();
  await checkRegion(page.locator('.pull-diff-scroll'), 'pull-diff');
  assert.deepEqual(errors, []);
  assert.deepEqual(await app.evaluate(() => globalThis.selectionForbidden), []);
  assert.deepEqual(await app.evaluate(() => globalThis.selectionCalls.network), []);
  process.stdout.write(`Electron ${packaged ? 'packaged' : 'built'} local/PR whole-region mouse selection, reverse/trailing-space/gutter/empty-line boundaries, code-only confirmation and scoped I-beam passed.\n`);
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => undefined);
  throw error;
} finally { await app.close(); }
