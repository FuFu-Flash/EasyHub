import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const arguments_ = process.argv.slice(2);
for (const argument of arguments_) {
  if (argument !== '--packaged' && !argument.startsWith('--executable=')) throw new Error(`Unknown argument: ${argument}`);
}
const packaged = arguments_.includes('--packaged');
const executableArguments = arguments_.filter((value) => value.startsWith('--executable='));
if (executableArguments.length > 1) throw new Error('Only one --executable argument is allowed.');
const explicitExecutable = executableArguments[0]?.slice('--executable='.length);
const packagedExecutable = process.env.EASYHUB_PACKAGED_EXECUTABLE || '/tmp/easyhub-desktop-release/mac-arm64/EasyHub.app/Contents/MacOS/EasyHub';
const executable = explicitExecutable ?? (packaged ? packagedExecutable : undefined);
if (executable !== undefined && !isAbsolute(executable)) throw new Error('The selected executable requires an absolute path.');
const mode = packaged ? 'packaged' : explicitExecutable !== undefined ? 'executable' : 'development';

if (process.platform !== 'darwin') {
  process.stdout.write('Native macOS application menu smoke test skipped on this platform.\n');
  process.exit(0);
}

const userData = await mkdtemp(join(tmpdir(), 'easyhub-application-menu-smoke-'));
const commands = ['home', 'projects', 'discover', 'issues', 'reviews', 'starred', 'profile', 'settings', 'new-project', 'add-folder', 'download-project', 'search', 'refresh', 'proxy-settings'];
const topLevelIds = ['easyhub-app-menu', 'easyhub-file-menu', 'easyhub-edit-menu', 'easyhub-view-menu', 'easyhub-window-menu', 'easyhub-help-menu'];
let app;
let page;

try {
  app = await electron.launch({
    executablePath: executable || electronPath,
    args: executable ? [] : ['.'],
    cwd: process.cwd(),
    env: { ...process.env, ELECTRON_RENDERER_URL: '', EASYHUB_TEST_MODE: '1', EASYHUB_TEST_USER_DATA: userData },
  });
  const application = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged, version: app.getVersion() }));
  process.stdout.write(`Application menu smoke mode=${mode}, isPackaged=${application.isPackaged}, version=${application.version}, executable=${executable || electronPath}\n`);
  if (packaged) assert.equal(application.isPackaged, true, '--packaged must launch an actual packaged application');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), userData);
  await app.evaluate(({ app, dialog, ipcMain, session, shell }) => {
    const user = { id: 501, login: 'menu-fixture', name: 'Menu Fixture', avatar_url: '', html_url: 'https://github.com/menu-fixture', followers: 1, following: 0, public_repos: 1 };
    const repo = { id: 901, name: 'menu-project', full_name: 'menu-fixture/menu-project', description: 'Isolated menu fixture', private: false, archived: false, fork: false, stargazers_count: 12, language: 'TypeScript', permissions: { admin: true, push: true, pull: true }, updated_at: new Date().toISOString(), pushed_at: new Date().toISOString(), default_branch: 'main', owner: { login: user.login, avatar_url: '' }, open_issues_count: 2 };
    const state = globalThis.applicationMenuSmoke = { signedIn: false, user, repo, authReads: 0, repoReads: 0, holdRepos: false, repoWaiters: [], unexpected: [], external: [], delayNextWindowLoad: false, releaseWindowLoad: null };
    const handle = (channel, callback) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, callback); };
    // The fixture cannot reach a real server or open the user's browser.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    shell.openExternal = async (url) => { state.external.push(url); };
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    handle('easyhub:auth-status', () => { state.authReads += 1; return { user: state.signedIn ? user : null, clientId: 'menu-fixture-client' }; });
    handle('easyhub:local-list', () => []);
    handle('easyhub:local-discovery-roots', () => []);
    handle('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    handle('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', engineVersion: '12.1.2', downloadBytes: 0 }));
    handle('easyhub:github', async (_event, action, ...args) => {
      if (action === 'repos') {
        state.repoReads += 1;
        if (state.holdRepos) await new Promise((resolve) => state.repoWaiters.push(resolve));
        return args[0] === 1 ? [repo] : [];
      }
      if (action === 'activityCounts') return { 901: { issues: 2, closedIssues: 0, pullRequests: 3, closedPullRequests: 0 } };
      if (action === 'profile') return user;
      if (action === 'contributions') return { total: 0, years: [new Date().getUTCFullYear()], weeks: [], repositories: [] };
      if (action === 'starredRepos' || action === 'topStarredRepos' || action === 'searchPublicRepos') return [repo];
      if (action === 'isStarred') return true;
      if (action === 'trending') return { items: [repo], page: 1, hasNextPage: false };
      if (action === 'readme') return '# Menu fixture\n\nAll requests stay in this isolated process.';
      if (action === 'issuesPage') return { items: [], nextPage: null };
      if (['issues', 'commits', 'comments', 'pullRequestsPage', 'searchUsers', 'releases'].includes(action)) return [];
      state.unexpected.push(action);
      throw new Error(`Unexpected or write API action blocked by menu fixture: ${action}`);
    });
    // Delay only the reopened test window, so the queued settings command cannot rely
    // on a renderer that happened to finish loading before the native menu click.
    app.on('browser-window-created', (_event, window) => {
      if (!state.delayNextWindowLoad) return;
      state.delayNextWindowLoad = false;
      for (const method of ['loadFile', 'loadURL']) {
        const original = window[method].bind(window);
        window[method] = (...args) => new Promise((resolve, reject) => {
          state.releaseWindowLoad = () => original(...args).then(resolve, reject);
        });
      }
    });
  });

  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  const flat = (items) => items.flatMap((item) => [item, ...flat(item.submenu || [])]);
  const getItem = (items, id) => flat(items).find((item) => item.id === id);
  async function menuSnapshot() {
    return app.evaluate(({ Menu }) => {
      const serialize = (menu) => menu.items.map((item) => ({ id: item.id, label: item.label, role: item.role || '', enabled: item.enabled, accelerator: item.accelerator || '', submenu: item.submenu ? serialize(item.submenu) : [] }));
      const menu = Menu.getApplicationMenu();
      if (!menu) throw new Error('The native macOS application menu is missing.');
      return serialize(menu);
    });
  }
  async function waitForMenu(predicate, message) {
    const deadline = Date.now() + 15000;
    let snapshot;
    do {
      snapshot = await menuSnapshot();
      if (predicate(snapshot)) return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 40));
    } while (Date.now() < deadline);
    assert.fail(`${message}: ${JSON.stringify(snapshot)}`);
  }
  const waitEnabled = (command, enabled = true) => waitForMenu((menu) => getItem(menu, `easyhub-${command}`)?.enabled === enabled, `${command} did not become ${enabled ? 'enabled' : 'disabled'}`);
  async function clickMenu(command, allowDisabled = false) {
    if (!allowDisabled) await waitEnabled(command);
    await app.evaluate(({ BrowserWindow, Menu }, { id, allowDisabled }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item || (!item.enabled && !allowDisabled)) throw new Error(`Unavailable menu item: ${id}`);
      item.click(item, BrowserWindow.getAllWindows()[0], {});
    }, { id: `easyhub-${command}`, allowDisabled });
  }
  const settleRenderer = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function heading(name) { await page.getByRole('heading', { name, level: 1, exact: true }).waitFor(); }
  async function observeCommands() {
    await page.evaluate(() => {
      window.menuSmokeCommands = [];
      window.menuSmokeUnsubscribe?.();
      window.menuSmokeUnsubscribe = window.easyHub.onMenuCommand((command) => window.menuSmokeCommands.push(command));
    });
  }
  const normalizeAccelerator = (value) => value.toLowerCase().replace(/commandorcontrol|cmdorctrl|command/g, 'cmd').replace(/\s/g, '');

  const initialMenu = await waitEnabled('home');
  assert.deepEqual(initialMenu.map((item) => item.id), topLevelIds);
  assert.deepEqual(initialMenu.map((item) => item.label), ['EasyHub', '文件', '编辑', '显示', '窗口', '帮助']);
  for (const command of commands) assert.ok(getItem(initialMenu, `easyhub-${command}`), `Missing application command: ${command}`);
  for (const [command, accelerator] of Object.entries({ settings: 'cmd+,', search: 'cmd+f', refresh: 'cmd+r', 'new-project': 'cmd+n', 'add-folder': 'cmd+o', 'download-project': 'cmd+shift+o', home: 'cmd+1', projects: 'cmd+2', discover: 'cmd+3', issues: 'cmd+4', reviews: 'cmd+5', starred: 'cmd+6', profile: 'cmd+7' })) {
    assert.equal(normalizeAccelerator(getItem(initialMenu, `easyhub-${command}`).accelerator), accelerator, `${command} keyboard shortcut`);
  }
  const nativeRoles = flat(initialMenu).map((item) => item.role.toLowerCase());
  for (const role of ['about', 'services', 'hide', 'hideothers', 'unhide', 'quit', 'close', 'undo', 'redo', 'cut', 'copy', 'paste', 'pasteandmatchstyle', 'delete', 'selectall', 'minimize', 'zoom', 'front', 'togglefullscreen']) assert.ok(nativeRoles.includes(role), `Missing native menu role: ${role}`);
  for (const command of ['discover', 'reviews', 'starred', 'refresh']) assert.equal(getItem(initialMenu, `easyhub-${command}`).enabled, false, `${command} must require a real login`);
  await observeCommands();
  await clickMenu('discover', true);
  await settleRenderer();
  assert.deepEqual(await page.evaluate(() => window.menuSmokeCommands), [], 'A disabled signed-out command must not be dispatched');

  for (const [command, title] of [['projects', '我的项目'], ['issues', '问题'], ['profile', '个人资料'], ['settings', '设置'], ['new-project', '新建项目'], ['add-folder', '添加现有文件夹'], ['download-project', '下载项目']]) {
    await clickMenu(command);
    await heading(title);
  }
  await clickMenu('home');
  await page.locator('.v2-feature-card').waitFor();
  await clickMenu('search');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.topbar-search input'));
  await clickMenu('proxy-settings');
  await heading('设置');
  await page.getByRole('heading', { name: 'GitHub 系统代理', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.closest('.github-proxy-panel'));

  // Native menu labels follow the same preference as the actual renderer.
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  const englishMenu = await waitForMenu((menu) => menu[1]?.label === 'File', 'Native menu language did not follow the renderer');
  assert.deepEqual(englishMenu.map((item) => item.label), ['EasyHub', 'File', 'Edit', 'View', 'Window', 'Help']);
  assert.equal(getItem(englishMenu, 'easyhub-settings').label, 'Settings…');
  assert.equal(getItem(englishMenu, 'easyhub-reviews').label, 'Pull Request Reviews');
  await clickMenu('settings');
  await heading('Settings');
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await waitForMenu((menu) => menu[1]?.label === '文件', 'Native menu did not switch back to Chinese');

  // A real draft dialog blocks app navigation, while native editing roles remain.
  await clickMenu('issues');
  await page.getByRole('button', { name: '提出问题', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('textbox', { name: '问题标题', exact: true }).fill('Keep this draft');
  const modalMenu = await waitForMenu((menu) => commands.every((command) => getItem(menu, `easyhub-${command}`)?.enabled === false), 'Visible dialog did not disable application commands');
  const editRoles = flat(getItem(modalMenu, 'easyhub-edit-menu').submenu);
  assert.ok(editRoles.some((item) => item.role.toLowerCase() === 'copy' && item.enabled), 'A business dialog must not disable native Copy');
  await page.evaluate(() => { window.menuSmokeCommands = []; });
  await clickMenu('home', true);
  await settleRenderer();
  assert.deepEqual(await page.evaluate(() => window.menuSmokeCommands), []);
  assert.equal(await page.getByRole('textbox', { name: '问题标题', exact: true }).inputValue(), 'Keep this draft');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await waitEnabled('home');

  // Switch only the in-memory auth fixture; no credential or repository is changed.
  await app.evaluate(() => { globalThis.applicationMenuSmoke.signedIn = true; });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await waitEnabled('refresh');
  await observeCommands();
  for (const command of commands) assert.equal(getItem(await menuSnapshot(), `easyhub-${command}`).enabled, true, `${command} should be available to the idle signed-in workspace`);
  await clickMenu('projects'); await heading('我的项目');
  await clickMenu('issues'); await heading('问题');
  assert.equal(await page.getByRole('tab', { name: /^问题/ }).getAttribute('aria-selected'), 'true');
  await clickMenu('reviews'); await heading('合并请求审查');
  assert.equal(await page.getByRole('tab', { name: /^合并请求审查/ }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('tab', { name: /^问题/ }).getAttribute('aria-selected'), 'false');
  await clickMenu('issues'); await heading('问题');
  assert.equal(await page.getByRole('tab', { name: /^合并请求审查/ }).getAttribute('aria-selected'), 'false');
  await clickMenu('discover'); await heading('发现 / 搜索');
  await clickMenu('starred'); await heading('我收藏的项目');
  await page.locator('.starred-project-card').first().waitFor();
  await clickMenu('profile'); await page.locator('.profile-hero').waitFor();
  await clickMenu('new-project'); await heading('新建项目');
  await clickMenu('add-folder'); await heading('本地项目');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '选择文件夹');
  await clickMenu('download-project'); await heading('本地项目');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '下载');
  await clickMenu('search');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.discover-search input'));
  await clickMenu('settings'); await heading('设置');
  await clickMenu('proxy-settings');
  await page.waitForFunction(() => document.activeElement?.closest('.github-proxy-panel'));
  await page.screenshot({ path: 'out/application-menu-settings-smoke.png' });

  await clickMenu('home'); await page.locator('.v2-feature-card').waitFor();
  const marker = await page.evaluate(() => { window.menuSmokeDocument = crypto.randomUUID(); return window.menuSmokeDocument; });
  const beforeRefresh = await app.evaluate(() => ({ authReads: globalThis.applicationMenuSmoke.authReads, repoReads: globalThis.applicationMenuSmoke.repoReads }));
  await app.evaluate(() => { globalThis.applicationMenuSmoke.holdRepos = true; });
  await clickMenu('refresh');
  const busyMenu = await waitForMenu((menu) => ['new-project', 'add-folder', 'download-project', 'refresh'].every((command) => getItem(menu, `easyhub-${command}`)?.enabled === false), 'Pending refresh did not disable conflicting operations');
  for (const command of ['home', 'projects', 'issues', 'settings', 'profile', 'search']) assert.equal(getItem(busyMenu, `easyhub-${command}`).enabled, true, `${command} should remain available during a data read`);
  assert.equal(await page.locator('.sidebar-refresh').isDisabled(), true);
  assert.ok(await app.evaluate(() => globalThis.applicationMenuSmoke.repoReads) > beforeRefresh.repoReads, 'Refresh must call the existing repository data service');
  await app.evaluate(() => { const state = globalThis.applicationMenuSmoke; state.holdRepos = false; state.repoWaiters.splice(0).forEach((resolve) => resolve()); });
  await waitEnabled('refresh');
  assert.equal(await page.evaluate(() => window.menuSmokeDocument), marker, 'Refresh must preserve the document instead of reloading it');
  assert.equal(await app.evaluate(() => globalThis.applicationMenuSmoke.authReads), beforeRefresh.authReads, 'Refresh must not restart authentication');

  // Native notifications are a visible dialog too, not an opportunity to navigate
  // behind the overlay. Hidden dialog markup does not block idle commands.
  await page.locator('.download-notification-trigger').click();
  await page.getByRole('dialog').waitFor();
  await waitForMenu((menu) => commands.every((command) => getItem(menu, `easyhub-${command}`)?.enabled === false), 'Live dialog did not disable application commands');
  await page.getByRole('button', { name: '关闭通知', exact: true }).click();
  await waitEnabled('refresh');
  await page.evaluate(() => { const element = document.createElement('div'); element.id = 'menu-smoke-hidden-dialog'; element.setAttribute('role', 'dialog'); element.hidden = true; document.body.append(element); });
  await settleRenderer();
  assert.equal(getItem(await menuSnapshot(), 'easyhub-refresh').enabled, true, 'A hidden dialog must not disable navigation');
  await page.evaluate(() => document.getElementById('menu-smoke-hidden-dialog').remove());

  // The settings accelerator's menu action must survive closing all native windows
  // and wait for authentication plus the new renderer subscription to become ready.
  await Promise.all([page.waitForEvent('close'), app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())]);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
  await waitEnabled('home', false);
  await waitEnabled('settings');
  await app.evaluate(() => { globalThis.applicationMenuSmoke.delayNextWindowLoad = true; });
  const reopenedPage = app.waitForEvent('window');
  await clickMenu('settings');
  const delayedWindow = await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return { count: windows.length, url: windows[0]?.webContents.getURL() };
  });
  assert.equal(delayedWindow.count, 1);
  assert.ok(delayedWindow.url === '' || delayedWindow.url === 'about:blank', `The reopened renderer loaded before release: ${delayedWindow.url}`);
  assert.equal(await app.evaluate(() => typeof globalThis.applicationMenuSmoke.releaseWindowLoad), 'function');
  assert.equal(getItem(await menuSnapshot(), 'easyhub-home').enabled, false, 'Commands must remain disabled before renderer readiness');
  await app.evaluate(() => { const release = globalThis.applicationMenuSmoke.releaseWindowLoad; globalThis.applicationMenuSmoke.releaseWindowLoad = null; return release(); });
  page = await reopenedPage;
  page.setDefaultTimeout(15000);
  await page.locator('.live-connected').waitFor();
  await heading('设置');
  await page.getByRole('button', { name: '退出登录', exact: true }).waitFor();
  await waitEnabled('refresh');
  await page.screenshot({ path: 'out/application-menu-reopened-settings-smoke.png' });
  assert.deepEqual(await app.evaluate(() => globalThis.applicationMenuSmoke.unexpected), [], 'The fixture attempted an unmocked or remote write API');
  assert.deepEqual(await app.evaluate(() => globalThis.applicationMenuSmoke.external), [], 'Menu navigation must not launch an external browser');
  await mkdir('out', { recursive: true });
  await writeFile('out/application-menu-smoke-results.json', JSON.stringify({ status: 'passed', mode, executable: executable || electronPath, application, isolatedUserData: true, inMemoryCredentials: true, remoteWrites: false, menuSource: 'Menu.getApplicationMenu() item.click', nativeShortcutDefinitionsVerified: true, physicalSystemMenuClicks: 'not exercised by this suite', demoAndLiveNavigation: true, languageSync: true, modalAndBusyPolicy: true, refreshPreservesDocument: true, settingsReopensAfterDelayedRendererAndAuth: true }, null, 2));
  process.stdout.write('Native application menu layout, shortcuts, Demo/Live navigation, language, disabled states, refresh, and queued settings smoke test passed.\n');
} finally {
  await app?.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
