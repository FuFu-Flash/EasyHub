import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const desktop = dirname(fileURLToPath(import.meta.url));
const packaged = process.argv.includes('--packaged');
const built = packaged || process.argv.includes('--built');
const product = packaged ? join(desktop, 'release/win-unpacked/resources/app.asar') : desktop;
const output = join(desktop, 'out/demo-navigation-chain-smoke');
await mkdir(output, { recursive: true });
const fixture = `
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import App from '/src/App.tsx';
import '/src/styles.css';
import '/src/v2.css';
localStorage.setItem('easyhub:language', 'zh');
window.githubCallLog = [];
window.easyHub = {
  authStatus: async () => ({ user: null }),
  github: async (...args) => { window.githubCallLog.push(args); throw Error('Demo must not call GitHub'); },
  chooseFolder: async () => 'C:/fixture',
  aiSettings: async () => ({ providerId: 'openai', model: 'fixture', hasApiKey: false }),
  githubProxyStatus: async () => ({ state: 'off', enabled: false, checks: [], checkedAt: null, error: null, legacyHosts: false }),
  onWindowMaximized: () => () => {},
};
createRoot(document.getElementById('root')).render(h(App));
`;
const server = built ? null : await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'demo-navigation-chain-fixture',
  resolveId(id) { if (id === 'virtual:demo-navigation.jsx') return '\0' + id; },
  load(id) { if (id === '\0virtual:demo-navigation.jsx') return fixture; },
  configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith('/demo-navigation-test')) return next();
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(await vite.transformIndexHtml(request.url, '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:demo-navigation.jsx"></script></body></html>'));
  }); },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
let electronApp;
try {
  let page;
  let load;
  if (built) {
    const run = await mkdtemp(join(output, packaged ? 'packaged-' : 'built-'));
    const launcher = join(run, 'launch.cjs');
    await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(join(run, 'profile'))});
process.env.EASYHUB_PROXY_APP_ONLY_TEST = '1';
process.env.ELECTRON_RENDERER_URL = 'data:text/html,Demo history fixture';
globalThis.registerDemoFixture = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => globalThis.registerDemoFixture(channel, channel.startsWith('easyhub:') ? () => { throw Error('Unexpected IPC: '+channel); } : handler);
require(${JSON.stringify(join(product, 'out/main/index.js'))});
`);
    electronApp = await electron.launch({ executablePath: electronPath, args: [launcher], cwd: desktop });
    await electronApp.evaluate(({ ipcMain, session }) => {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
      globalThis.demoGithubCalls = [];
      const mock = (channel, handler) => { ipcMain.removeHandler(channel); globalThis.registerDemoFixture(channel, (_event, ...args) => handler(...args)); };
      mock('easyhub:auth-status', () => ({ user: null, clientId: null }));
      mock('easyhub:ai-settings', () => ({ providerId: 'openai', model: 'fixture', hasApiKey: false }));
      mock('easyhub:github-proxy-status', () => ({ state: 'off', enabled: false, checks: [], checkedAt: null, error: null, legacyHosts: false }));
      mock('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', platform: 'win32', arch: 'x64' }));
      mock('easyhub:github', (...args) => { globalThis.demoGithubCalls.push(args); throw Error('Demo must not call GitHub'); });
    });
    page = await electronApp.firstWindow();
    load = () => electronApp.evaluate(async ({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), join(product, 'out/renderer/index.html'));
  } else {
    await server.listen();
    const address = server.httpServer.address();
    const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
    page = await browser.newPage();
    load = () => page.goto(`http://127.0.0.1:${address.port}/demo-navigation-test`);
  }
  await page.setViewportSize({ width: 980, height: 640 });
  page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load();
  await page.locator('.home-project-row').filter({ hasText: 'MyTool' }).getByRole('button', { name: '打开项目', exact: true }).click();
  await page.locator('.detail-hero h1').filter({ hasText: 'MyTool' }).waitFor();
  const projectVersion = page.locator('.timeline-item').filter({ hasText: '修复启动问题' }).first();
  await projectVersion.scrollIntoViewIfNeeded();
  const projectPosition = await page.locator('.main-column').evaluate(node => node.scrollTop);
  await projectVersion.click();
  await page.getByRole('heading', { name: '修复启动问题', exact: true }).waitFor();
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  await page.locator('.back-link').click();
  await page.getByRole('heading', { name: '修复启动问题', exact: true }).waitFor();
  await page.locator('.back-link').click();
  assert.equal(await page.locator('.detail-hero h1').textContent(), 'MyTool', 'A version opened directly from project must return to that project, not fabricate history page.');
  assert.ok(Math.abs(await page.locator('.main-column').evaluate(node => node.scrollTop) - projectPosition) < 5, 'Project scroll position must survive Back.');
  await page.locator('.back-link').click();
  await page.locator('.home-dashboard').waitFor();

  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  // An active sidebar click intentionally opens the list, including after restoration.
  if (!await page.locator('.project-grid').count()) await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByPlaceholder('搜索项目', { exact: true }).fill('MyTool');
  await page.locator('.project-card').getByRole('button', { name: '打开项目', exact: true }).click();
  await page.locator('.detail-primary .panel').filter({ has: page.getByRole('heading', { name: '历史版本', exact: true }) }).getByRole('button', { name: '查看全部', exact: true }).click();
  await page.getByRole('heading', { name: '历史版本', exact: true }).waitFor();
  await page.locator('.history-row').first().click();
  await page.locator('.back-link').click();
  await page.getByRole('heading', { name: '历史版本', exact: true }).waitFor();
  await page.locator('.back-link').click();
  await page.locator('.detail-hero h1').filter({ hasText: 'MyTool' }).waitFor();
  await page.locator('.back-link').click();
  assert.equal(await page.getByPlaceholder('搜索项目', { exact: true }).inputValue(), 'MyTool', 'Each level restores the projects search state.');
  assert.equal(await page.locator('.project-card').count(), 1);

  await page.locator('.project-card').getByRole('button', { name: '打开项目', exact: true }).click();
  await page.getByRole('button', { name: '发布新版本', exact: true }).click();
  const publishedTag = await page.getByRole('textbox', { name: '版本号', exact: true }).inputValue();
  await page.getByRole('textbox', { name: '版本介绍', exact: true }).fill('Demo release keeps the current mock data.');
  await page.getByRole('button', { name: '预览发布效果', exact: true }).click();
  await page.getByRole('button', { name: '确认发布新版本', exact: true }).click();
  await page.getByRole('heading', { name: '已发布的新版本', exact: true }).waitFor();
  await page.locator('.back-link').click();
  await page.locator('.detail-hero h1').filter({ hasText: 'MyTool' }).waitFor();
  assert.ok((await page.locator('.timeline-list').first().innerText()).includes(publishedTag), 'Back retains the latest published mock data, never an old snapshot.');
  await page.getByRole('button', { name: '发布新版本', exact: true }).click();
  assert.notEqual(await page.getByRole('textbox', { name: '版本号', exact: true }).inputValue(), publishedTag, 'Completed release form cannot be reused for another submission.');
  assert.equal(await page.getByRole('textbox', { name: '版本介绍', exact: true }).inputValue(), '', 'A new release starts with a fresh form.');
  await page.locator('.back-link').click();
  await page.locator('.detail-hero h1').filter({ hasText: 'MyTool' }).waitFor();
  await page.getByRole('button', { name: '删除此项目', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除此项目', exact: true });
  await confirmation.getByRole('textbox', { name: '确认项目名称', exact: true }).fill('MyTool');
  await confirmation.getByRole('button', { name: '删除此项目', exact: true }).click();
  await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor();
  for (let index = 0; index < 20 && await page.locator('.back-link').count(); index++) {
    await page.locator('.back-link').click();
    await page.waitForTimeout(70);
    assert.equal(await page.locator('.detail-hero h1').filter({ hasText: 'MyTool' }).count(), 0, 'Deleted projects are removed from every history level.');
  }
  assert.equal(await page.locator('.back-link').count(), 0, 'Back exhausts history without a loop.');
  assert.deepEqual(built ? await electronApp.evaluate(() => globalThis.demoGithubCalls) : await page.evaluate(() => window.githubCallLog), []);
  assert.deepEqual(errors, []);
  const mode = packaged ? 'packaged' : built ? 'built' : 'source';
  await page.screenshot({ path: join(output, `${mode}-restored-projects.png`) });
  await writeFile(join(output, `${mode}-result.json`), JSON.stringify({ passed: true, mode, checks: ['direct-version-origin', 'multilevel-back', 'root-page-back', 'scroll-restoration', 'search-restoration', 'completed-form-replacement', 'latest-data-preserved', 'deleted-page-pruning', 'demo-no-network'] }, null, 2));
  process.stdout.write('Demo Back restores every visited page, query and scroll position.\n');
} finally { await browser?.close(); await electronApp?.close(); await server?.close(); }
