import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Browser keyboard events on the real application and real notification dialog.
// All bridge calls are local fixtures, with no downloads, GitHub writes or login.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out/dialog-focus-smoke');
await mkdir(output, { recursive: true });
const fixture = `
import { createElement as h, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '/src/App.tsx';
import { useDialogFocus } from '/src/components/useDialogFocus.ts';
import { useDownloadCenter } from '/src/components/useDownloadCenter.ts';
import { DownloadNotifications } from '/src/components/DownloadNotifications.tsx';
import '/src/styles.css';
import '/src/v2.css';
localStorage.setItem('easyhub:language', 'zh');
const repo = { id: 1, name: 'fixture', full_name: 'fixture/fixture', private: false, owner: { login: 'fixture' }, default_branch: 'main', updated_at: '', open_issues_count: 0 };
let rows = [{ id: 'fixture-download', request: { kind: 'archive', repo, ref: 'main', fileName: 'example.zip' }, state: 'complete', percent: 100, loaded: 1024, total: 1024, path: 'C:/fixture/example.zip', seen: true, phase: '项目已经下载完成。' }];
const listeners = new Set();
window.githubCallLog = [];
window.easyHub = { platform: ${JSON.stringify(process.platform)},
  authStatus: async () => ({ user: null }),
  github: async (...args) => { window.githubCallLog.push(args); throw Error('Demo must not call GitHub'); },
  chooseFolder: async () => 'C:/fixture',
  windowControl: async () => {},
  onWindowMaximized: () => () => {},
  downloadsList: async () => rows,
  onDownloadsChanged: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  downloadsEnqueue: async request => { const item = { ...rows[0], id: 'fixture-download-2', request }; rows = [item, ...rows]; listeners.forEach(listener => listener(rows)); return item; },
  downloadsOpen: async () => {},
  downloadsCommand: async () => {},
  downloadsClear: async () => {},
};
function Dialog({ label, close, children }) {
  const dialog = useRef(null);
  useDialogFocus(true, dialog, close);
  return h('div', { className: 'modal-backdrop' }, h('section', { ref: dialog, className: 'modal', role: 'dialog', 'aria-label': label, 'aria-modal': true, tabIndex: -1 }, h('button', { onClick: close }, '关闭 ' + label), children));
}
function FocusFixture() {
  const center = useDownloadCenter(async () => {});
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [latestClose, setLatestClose] = useState('');
  window.fixtureHideOuter = () => { setHidden(true); setInner(true); };
  window.fixtureChangeClose = () => setLatestClose('updated');
  return h('main', { className: 'v2-layout', style: { padding: 20 } },
    h('button', { id: 'background' }, '背景按钮'),
    h('button', { id: 'start-download', onClick: () => center.start({ kind: 'archive', repo, ref: 'main', fileName: 'second.zip' }) }, '添加下载'),
    h(DownloadNotifications, { center, savedPublicRepoIds: [], onAddPublic: () => {} }),
    h('button', { id: 'open-outer', onClick: () => { setOuter(true); setHidden(false); } }, '打开弹窗'),
    outer && h('div', { hidden }, h(Dialog, { label: '外层', close: () => { window.closedBy = latestClose; setOuter(false); } },
      h('input', { 'aria-label': '名称' }),
      h('button', { disabled: true }, '不可用按钮'),
      h('button', { style: { display: 'none' } }, '隐藏按钮'),
      h('button', { id: 'open-inner', onClick: () => setInner(true) }, '打开子弹窗'))),
    inner && h(Dialog, { label: '子弹窗', close: () => setInner(false) }, h('button', null, '子弹窗末尾')));
}
createRoot(document.getElementById('root')).render(h(new URLSearchParams(location.search).has('demo') ? App : FocusFixture));
`;
const server = await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'dialog-focus-fixture',
  resolveId(id) { if (id === 'virtual:dialog-focus.jsx') return '\0' + id; },
  load(id) { if (id === '\0virtual:dialog-focus.jsx') return fixture; },
  configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith('/dialog-focus-test')) return next();
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(await vite.transformIndexHtml(request.url, '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:dialog-focus.jsx"></script></body></html>'));
  }); },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1060, height: 740 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${address.port}/dialog-focus-test`;
  await page.route('**/*', route => new URL(route.request().url()).origin === `http://127.0.0.1:${address.port}` ? route.continue() : route.abort());
  await page.goto(url);
  const focusedInside = dialog => dialog.evaluate(element => element.contains(document.activeElement));
  const focused = locator => locator.evaluate(element => document.activeElement === element);
  const notificationTrigger = page.getByRole('button', { name: '通知', exact: true });
  await notificationTrigger.click();
  const notification = page.getByRole('dialog', { name: '通知', exact: true });
  await notification.waitFor();
  assert.equal(await focusedInside(notification), true, 'Notification opening moves focus inside');
  const notificationFirst = notification.getByRole('button', { name: '清除下载记录' });
  const notificationLast = notification.getByRole('button', { name: '打开文件夹' });
  await notificationLast.focus(); await page.keyboard.press('Tab');
  assert.equal(await focused(notificationFirst), true, 'Tab on the last action cycles to the first');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focused(notificationLast), true, 'Shift+Tab cycles in reverse');
  await page.locator('#background').evaluate(element => element.focus());
  assert.equal(await focusedInside(notification), true, 'Background controls cannot retain focus');
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab'); assert.equal(await focusedInside(notification), true);
  }
  await page.keyboard.press('Escape'); await notification.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '通知');
  assert.equal(await focused(notificationTrigger), true, 'Escape restores notification trigger focus');
  await page.locator('#start-download').click(); await notification.waitFor();
  await notification.getByRole('button', { name: '关闭通知' }).click();
  await page.waitForFunction(() => document.activeElement?.id === 'start-download');
  assert.equal(await focused(page.locator('#start-download')), true, 'Auto-opened transfers restore the download trigger');

  await page.locator('#open-outer').click();
  const outer = page.getByRole('dialog', { name: '外层', exact: true });
  await outer.waitFor();
  await page.locator('#open-inner').focus(); await page.keyboard.press('Tab');
  assert.equal(await focused(outer.getByRole('button', { name: '关闭 外层' })), true, 'Hidden and disabled buttons are excluded');
  await page.locator('#open-inner').click();
  const inner = page.getByRole('dialog', { name: '子弹窗', exact: true });
  await inner.waitFor(); await page.keyboard.press('Escape'); await inner.waitFor({ state: 'hidden' });
  assert.equal(await outer.isVisible(), true, 'Escape closes only the current modal');
  await page.waitForFunction(() => document.activeElement?.id === 'open-inner');
  assert.equal(await focused(page.locator('#open-inner')), true, 'Closing nested dialog restores its parent trigger');
  await page.evaluate(() => window.fixtureChangeClose()); await page.keyboard.press('Escape');
  await outer.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.closedBy), 'updated', 'Close callback uses the latest render');
  await page.locator('#open-outer').click(); await outer.waitFor();
  await page.evaluate(() => window.fixtureHideOuter()); await inner.waitFor();
  await page.keyboard.press('Escape'); await inner.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.closedBy), 'updated', 'Hidden retained dialog does not consume Escape');

  await page.goto(url + '?demo');
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: /我的云端项目/ }).click();
  const downloadTrigger = page.locator('.cloud-row').getByRole('button', { name: '下载', exact: true }).first();
  await downloadTrigger.click();
  const download = page.getByRole('dialog', { name: '下载项目', exact: true });
  await download.waitFor();
  assert.equal(await focusedInside(download), true, 'Real demo download dialog receives focus');
  await download.getByRole('button', { name: '取消', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await focused(download.getByRole('button', { name: '关闭', exact: true })), true, 'Disabled download action is skipped');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focused(download.getByRole('button', { name: '取消', exact: true })), true);
  await page.keyboard.press('Escape'); await download.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.closest('.cloud-row') !== null);
  assert.equal(await focused(downloadTrigger), true, 'Demo Escape restores the exact download trigger');
  await downloadTrigger.click(); await download.getByRole('button', { name: '选择位置', exact: true }).click();
  await download.getByRole('button', { name: '下载', exact: true }).click();
  await download.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.matches('.sidebar-nav button.active'));
  assert.equal(await page.getByRole('heading', { name: '我的项目', exact: true }).count(), 0, 'Successful download navigates to the project and restores safe page focus');
  await page.locator('.demo-mode-notice').getByText('演示模式 · 未上传到 GitHub。演示项目和修改会在重启 EasyHub 后重置。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('button', { name: /新建项目/ }).first().click();
  const demoName = '演示重启验证项目';
  const demoMessage = '演示更新内容重启后重置';
  await page.getByPlaceholder('例如：我的工具', { exact: true }).fill(demoName);
  await page.getByPlaceholder('用一句话介绍你的项目', { exact: true }).fill('只存在当前窗口的模拟项目');
  await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('heading', { name: demoName, exact: true }).waitFor();
  await page.locator('.detail-hero').getByText('演示已保存 · 未上传到 GitHub', { exact: true }).waitFor();
  await page.getByRole('button', { name: '模拟文件修改', exact: true }).click();
  await page.getByRole('button', { name: '发布更新', exact: true }).click();
  await page.getByPlaceholder('例如：修复窗口缩放问题', { exact: true }).fill(demoMessage);
  await page.getByRole('button', { name: '发布更新', exact: true }).click();
  await page.getByRole('heading', { name: '历史版本', exact: true }).waitFor();
  await page.getByText(demoMessage, { exact: true }).waitFor();
  await page.locator('.toast').getByText('演示更新已保存 · 未上传到 GitHub', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.githubCallLog), [], 'Demo creation and publishing perform no GitHub requests');
  await page.reload();
  await page.locator('.demo-mode-notice').waitFor();
  assert.equal(await page.getByText(demoName, { exact: true }).count(), 0, 'Restart drops newly created demo projects');
  assert.equal(await page.getByText(demoMessage, { exact: true }).count(), 0, 'Restart drops demo updates');
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  assert.equal(await page.getByText(demoName, { exact: true }).count(), 0, 'The reset project is absent from the full project list');
  await page.getByRole('button', { name: '选择语言', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.locator('.demo-mode-notice').getByText('Demo mode · Not uploaded to GitHub. Demo projects and changes reset when EasyHub restarts.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, coverage: ['real download dialog', 'real download notifications', 'native Tab and Shift+Tab', 'Escape', 'opener and navigation fallback', 'nested and retained dialogs', 'latest callback', 'demo upload disclaimer in Chinese and English', 'demo creation and publication without GitHub requests', 'demo project and update reset on restart'] }, null, 2));
  console.log('Dialog focus and demo passed: actual keyboard interactions, nesting, hidden pages, restoration, no GitHub writes and restart reset.');
} finally { await browser?.close(); await server.close(); }
