import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

// Exercise the real signed-in renderer without exposing account data or allowing writes.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out', 'search-history-motion-smoke');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, 'isolated-'));
const profile = join(directory, 'profile');
await mkdir(profile);
const preload = await readFile(join(desktop, 'src', 'preload', 'index.ts'), 'utf8');
const channels = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\(([^,\r\n]*)/g)].map(match => {
  const literal = /^'(easyhub:[^']+)'\s*\)?\s*$/.exec(match[1]);
  assert.ok(literal, 'An IPC fixture must discover every exposed literal channel.');
  return literal[1];
}))];
assert.ok(channels.length > 40);
const executableArgument = process.argv.find(value => value.startsWith('--executable='));
const executable = executableArgument?.slice('--executable='.length)
  ?? (process.argv.includes('--packaged') ? join(desktop, 'release', 'win-unpacked', 'EasyHub.exe') : null);
if (executableArgument) assert.ok(isAbsolute(executable), '--executable must be an absolute path.');
const baseline = process.argv.includes('--baseline');
const launcher = join(directory, 'launch.cjs');
if (!executable) await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>History and motion fixture</title>';
globalThis.historyRegister = ipcMain.handle.bind(ipcMain);
globalThis.historyRejected = [];
ipcMain.handle = (channel, handler) => globalThis.historyRegister(channel, channel.startsWith('easyhub:') ? () => {
  globalThis.historyRejected.push(channel);
  throw new Error('Unmocked history fixture IPC: ' + channel);
} : handler);
require(${JSON.stringify(join(desktop, 'out', 'main', 'index.js'))});
`, 'utf8');

const started = Date.now();
const measurements = [];
let checks = 0;
const check = (condition, label) => { checks++; assert.ok(condition, label); };
const app = await electron.launch({ executablePath: executable || electronPath,
  args: executable ? ['--user-data-dir=' + profile] : [launcher], cwd: desktop,
  env: { ...process.env, EASYHUB_PROXY_APP_ONLY_TEST: '1' } });
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await app.evaluate(({ BrowserWindow, ipcMain, session }, channels) => {
    const renderer = BrowserWindow.getAllWindows()[0].webContents;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
    const register = globalThis.historyRegister ?? ipcMain.handle.bind(ipcMain);
    const fixture = globalThis.historyFixture = { forbidden: [], reads: [], repositoryCount: 7 };
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      register(channel, (event, ...args) => {
        if (event.sender !== renderer) throw new Error('Unexpected history fixture renderer');
        return handler(...args);
      });
    };
    for (const channel of channels) mock(channel, () => {
      fixture.forbidden.push(channel);
      throw new Error('Write or unknown history fixture IPC blocked: ' + channel);
    });
    const now = new Date().toISOString();
    const repositories = () => Array.from({ length: fixture.repositoryCount }, (_, index) => ({ id: 7901 + index,
      name: `history-project-${index}`, full_name: `history-fixture/history-project-${index}`, description: 'Read-only history fixture project.',
      private: false, archived: false, owner: { login: 'history-fixture', avatar_url: '' }, default_branch: 'main', updated_at: now,
      pushed_at: now, permissions: { pull: true, push: true, admin: true }, open_issues_count: 0, stargazers_count: 1 }));
    mock('easyhub:auth-status', () => ({ user: { login: 'history-fixture', name: 'History Fixture', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false }));
    mock('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    mock('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', engineVersion: '12.1.2' }));
    mock('easyhub:github', (action, ...args) => {
      fixture.reads.push(action);
      if (action === 'repos') return args[0] === 1 ? repositories() : [];
      if (action === 'activityCounts') return Object.fromEntries(repositories().map(repo => [repo.id,
        { issues: 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }]));
      if (action === 'trending') return { items: repositories().slice(0, 2), page: args[1] ?? 1, hasNextPage: false };
      if (action === 'searchPublicReposPage') return { items: [], totalCount: 0, hasNextPage: false };
      if (action === 'searchUsersPage') return { items: [], totalCount: 0, hasNextPage: false };
      if (action === 'commits' || action === 'starredRepos') return [];
      if (action === 'issuesPage') return { items: [], nextPage: null };
      if (action === 'pullRequestsPage') return [];
      fixture.forbidden.push('github:' + action);
      throw new Error('Write or unexpected mock GitHub action: ' + action);
    });
  }, channels);
  const page = await app.firstWindow();
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (!executable) await app.evaluate(async ({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].loadFile(file), join(desktop, 'out', 'renderer', 'index.html'));
  const history = Array.from({ length: 10 }, (_, index) => ({ query: index === 9 ? 'LongUnbrokenQuery'.repeat(11).slice(0, 200)
    : `历史搜索项目 ${index + 1}`, scope: index % 2 ? 'mine' : 'local' }));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const load = async ({ language = 'zh', width = 1440, preference = 'comfortable', count = 10 } = {}) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: width === 1060 ? 700 : 900 });
    await page.evaluate(({ language, preference, entries }) => {
      localStorage.clear();
      localStorage.setItem('easyhub:language', language);
      localStorage.setItem('easyhub:auto-translate', 'false');
      localStorage.setItem('easyhub:layout-preference', preference);
      localStorage.setItem('easyhub:search-history:history-fixture', JSON.stringify(entries));
    }, { language, preference, entries: history.slice(0, count) });
    await page.reload();
    await page.locator('.live-connected').waitFor();
    await page.locator('.sidebar-nav').getByRole('button', { name: /^(我的项目|My Projects)$/ }).click();
    await page.locator('.search-history').waitFor();
    await settle();
  };
  const record = async label => {
    const geometry = await page.locator('.search-history').evaluate(panel => {
      const r = panel.getBoundingClientRect();
      const list = panel.querySelector('.search-history-list');
      const controls = [...document.querySelectorAll('.segmented')].map(group => ({ marker: Boolean(group.querySelector('.segmented-indicator')),
        buttons: group.querySelectorAll(':scope > button').length }));
      return { width: innerWidth, density: document.querySelector('.app-shell').dataset.layout, height: r.height,
        panelRight: r.right, columnRight: document.querySelector('.main-column').getBoundingClientRect().right,
        overflow: document.querySelector('.main-column').scrollWidth - document.querySelector('.main-column').clientWidth,
        listOverflowY: list.scrollHeight - list.clientHeight, listOverflowX: list.scrollWidth - list.clientWidth,
        histories: list.querySelectorAll('button').length, controls };
    });
    measurements.push({ label, ...geometry });
    await page.screenshot({ path: join(output, label + '.png') });
    return geometry;
  };
  for (const count of [1, 10]) {
    await load({ count });
    const geometry = await record((baseline ? 'before' : 'after') + '-zh-comfortable-1440-' + count);
    if (!baseline) {
      check(geometry.height <= 70, 'A comfortable history strip must stay at most 70 px high with ' + count + ' saved searches.');
      check(geometry.overflow <= 1 && geometry.panelRight <= geometry.columnRight + 1, 'History must not widen the page.');
      check(geometry.histories === count, 'All saved searches must remain available.');
      check(geometry.controls.every(group => group.marker), 'Segmented choices must have a shared sliding indicator.');
    }
  }
  if (baseline) {
    process.stdout.write('Captured installed real-renderer baseline: ' + JSON.stringify(measurements) + '\n');
  } else {
    const historyGeometry = (geometry, label) => {
      check(geometry.height <= (geometry.density === 'compact' ? 58 : 70), label + ': saved searches stay in a compact strip.');
      check(geometry.histories === 10, label + ': all ten saved searches remain in the scroll strip.');
      check(geometry.listOverflowY <= 1, label + ': saved searches must not wrap into multiple rows.');
      check(geometry.overflow <= 1 && geometry.panelRight <= geometry.columnRight + 1, label + ': long queries do not widen the page.');
      check(geometry.controls.length > 0 && geometry.controls.every(group => group.marker), label + ': every rendered segmented choice has the shared indicator.');
    };
    const focusLastHistory = async () => {
      const chips = page.locator('.search-history-list > button');
      await chips.first().focus();
      for (let index = 1; index < 10; index++) await page.keyboard.press('Tab');
      await settle();
      const position = await chips.last().evaluate(chip => {
        const r = chip.getBoundingClientRect();
        const list = chip.parentElement.getBoundingClientRect();
        return { focused: document.activeElement === chip, visible: r.right <= list.right + 1 && r.left >= list.left - 1,
          chipLeft: r.left, chipRight: r.right, listLeft: list.left, listRight: list.right,
          title: chip.title, scrollLeft: chip.parentElement.scrollLeft };
      });
      check(position.focused && position.visible, 'Tab reaches the tenth saved query and scrolls the strip to show its complete chip: ' + JSON.stringify(position));
      check(position.title.includes(history[9].query), 'The full 200-character query is preserved in the chip title.');
    };
    const matrices = [
      { width: 1060, preference: 'comfortable' }, { width: 1060, preference: 'compact' },
      { width: 1440, preference: 'comfortable' }, { width: 1440, preference: 'compact' },
      { language: 'en', width: 1060, preference: 'compact' }, { language: 'en', width: 1440, preference: 'comfortable' },
    ];
    for (const options of matrices) {
      const label = `${options.language ?? 'zh'}-${options.preference}-${options.width}`;
      await load(options);
      historyGeometry(await record('projects-' + label), label);
      await focusLastHistory();
      await page.locator('.sidebar-nav').getByRole('button', { name: /^(发现|Discover)$/ }).click();
      await page.locator('.discover-page .search-history').waitFor();
      historyGeometry(await record('discover-' + label), 'Discover ' + label);
      await focusLastHistory();
    }

    // A chip restores the complete query; typing hides history; clearing restores it; Clear All persists.
    await load({ width: 1060, preference: 'compact' });
    await focusLastHistory();
    await page.keyboard.press('Enter');
    await page.locator('.search-history').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.toolbar .search-box input').inputValue(), history[9].query);
    await page.locator('.toolbar .search-box').getByRole('button', { name: '清除搜索', exact: true }).click();
    await page.locator('.search-history').waitFor();
    await page.locator('.search-history').getByRole('button', { name: '清除全部', exact: true }).click();
    await page.locator('.search-history').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => localStorage.getItem('easyhub:search-history:history-fixture')), null);
    await page.reload();
    await page.locator('.live-connected').waitFor();
    await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
    check(await page.locator('.search-history').count() === 0, 'Clear All remains cleared after reloading the real renderer.');

    const snapshot = group => group.evaluate(element => {
      const r = node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
      const indicator = element.querySelector(':scope > .segmented-indicator');
      const selected = element.querySelector(':scope > button.selected');
      return { indicator: r(indicator), selected: r(selected), text: selected.textContent.trim(),
        durations: getComputedStyle(indicator).transitionDuration,
        animations: indicator.getAnimations().filter(animation => animation.playState === 'running').length,
        pressed: [...element.querySelectorAll(':scope > button')].filter(button => button.getAttribute('aria-pressed') === 'true').length,
        markerIgnored: indicator.getAttribute('aria-hidden') === 'true' && getComputedStyle(indicator).pointerEvents === 'none' };
    });
    const finish = async group => {
      await group.evaluate(async element => {
        const end = performance.now() + 1500;
        while (performance.now() < end) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const indicator = element.querySelector(':scope > .segmented-indicator');
          if (!indicator.getAnimations().some(animation => animation.playState === 'running')) break;
        }
      });
      await settle();
    };
    const aligned = (state, label) => {
      check(['x', 'y', 'width', 'height'].every(key => Math.abs(state.indicator[key] - state.selected[key]) <= 1), label + ': moving background ends exactly under the selected option.');
      check(state.pressed === 1 && state.markerIgnored, label + ': exactly one pressed button and no focusable or clickable background.');
    };
    const slide = async (group, index, label, keyboard = false) => {
      await finish(group);
      const before = await snapshot(group);
      const buttons = group.locator(':scope > button');
      if (keyboard) {
        await buttons.nth(index).focus();
        await page.keyboard.press('Enter');
      } else await buttons.nth(index).evaluate(button => button.click());
      await group.evaluate(() => new Promise(resolve => setTimeout(resolve, 45)));
      const moving = await snapshot(group);
      check(Math.abs(moving.selected.x - before.indicator.x) > 5, label + ': fixture changes the target position.');
      const direction = Math.sign(moving.selected.x - before.indicator.x);
      check((moving.indicator.x - before.indicator.x) * direction > 0.1
        && (moving.selected.x - moving.indicator.x) * direction > 0.1 && moving.animations > 0,
      label + ': the selected background visibly travels between options, rather than appearing instantly.');
      await finish(group);
      aligned(await snapshot(group), label);
      measurements.push({ label, before, moving, after: await snapshot(group) });
    };
    await load();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const projects = page.locator('.toolbar > .segmented').first();
    await slide(projects, 3, 'Project scope click');
    await slide(projects, 1, 'Project scope keyboard', true);
    await projects.evaluate(async group => {
      const buttons = group.querySelectorAll(':scope > button');
      for (const index of [0, 2, 3, 1]) {
        buttons[index].click();
        await new Promise(resolve => setTimeout(resolve, 24));
      }
    });
    await finish(projects);
    const rapid = await snapshot(projects);
    aligned(rapid, 'Rapid repeated changes');
    check(rapid.text.includes('我的云端项目'), 'Rapid changes finish under the last requested selection.');

    // Real read-only refresh changes the count and label width while the selected option remains mounted.
    await app.evaluate(() => { globalThis.historyFixture.repositoryCount = 17; });
    await page.locator('.sidebar-refresh').click();
    await projects.locator(':scope > button.selected').getByText('17', { exact: true }).waitFor();
    await finish(projects);
    aligned(await snapshot(projects), 'Updated project count');
    await page.setViewportSize({ width: 1060, height: 700 });
    await page.evaluate(() => {
      localStorage.setItem('easyhub:layout-preference', 'compact');
      window.dispatchEvent(new StorageEvent('storage', { key: 'easyhub:layout-preference', newValue: 'compact' }));
    });
    await finish(projects);
    aligned(await snapshot(projects), 'Compact density and window resize');

    await page.locator('.sidebar-nav').getByRole('button', { name: '发现', exact: true }).click();
    await page.locator('.trending-periods').waitFor();
    await slide(page.locator('.trending-periods'), 2, 'Popular period');
    await slide(page.locator('.discover-scopes'), 1, 'Discover user scope');
    await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
    await projects.waitFor();
    await settle();
    const restored = await snapshot(projects);
    aligned(restored, 'Restored project page');
    check(restored.animations === 0, 'Returning to a saved page paints its current selection without sliding from an unrelated option.');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await projects.locator(':scope > button').nth(2).click();
    await settle();
    const reduced = await snapshot(projects);
    aligned(reduced, 'Reduced motion');
    check(reduced.animations === 0 && reduced.durations.split(',').every(value => parseFloat(value) <= 0.001), 'Reduced motion disables visible sliding and selection remains correct: ' + JSON.stringify(reduced));
    measurements.push({ label: 'reduced-motion', ...reduced });

    await page.locator('.sidebar-nav').getByRole('button', { name: /^问题/ }).click();
    await page.locator('.discussion-search').waitFor();
    const issues = page.locator('.toolbar .segmented').first();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await slide(issues, 1, 'Issue filter');
    await page.getByRole('tab', { name: /^合并请求审查/ }).first().click();
    const reviews = page.locator('.toolbar .segmented').first();
    await reviews.locator(':scope > button').first().getByText('待审查', { exact: false }).waitFor();
    await slide(reviews, 1, 'Review filter');
    assert.deepEqual(errors, []);
  }
  assert.deepEqual(await app.evaluate(() => globalThis.historyFixture.forbidden), []);
  assert.deepEqual(await app.evaluate(() => globalThis.historyRejected ?? []), []);
  await writeFile(join(output, baseline ? 'baseline-isolation.json' : 'isolation.json'), JSON.stringify({ blockedByDefaultChannels: channels.length,
    executable: executable ?? 'development-renderer', baseline, historyLayoutCases: baseline ? 2 : 14,
    forbiddenCalls: [], unexpectedIpcCalls: [], externalNetworkBlocked: true, systemProxyIntegrationDisabled: true, checks,
    elapsedMs: Date.now() - started }, null, 2) + '\n');
  if (!baseline) process.stdout.write(`PASS history and selection animation: ${checks} assertions (${Date.now() - started} ms).\n`);
} finally {
  await writeFile(join(output, baseline ? 'before-measurements.json' : 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  await app.close();
}
