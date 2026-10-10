import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Every proxy operation is mocked; this check never changes system settings.
const source = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { HostsRepairPanel } from '/src/components/HostsRepairPanel.tsx';
import '/src/styles.css';
import '/src/v2.css';
const query = new URLSearchParams(location.search);
const systemMode = query.has('existing') ? 'existing' : query.has('external') ? 'external' : query.has('unavailable') ? 'unavailable' : 'managed';
const ready = { enabled:true,state:'ready',checkedAt:'2026-10-01T03:20:00Z',error:null,system:{mode:systemMode,error:query.has('unavailable')?'unsafe system internals':null},checks:['login','api','download'].map(target=>({target,ok:true})),legacyHosts:query.has('legacy') };
const off = () => ({...ready,enabled:false,state:'off',system:{mode:'off',error:null},checks:[]});
let current = off();
if(query.has('existing')||query.has('external')||query.has('unavailable')||query.has('takeover')||query.has('disable-rejection')) current = {...ready};
if(query.has('checking')) current = {...ready,state:'checking',checks:[]};
if(query.has('error')) current = {...ready,state:'error',error:'unsafe internals',checks:[{target:'login',ok:false}]};
const metrics = window.fixture = { reads:0, enabled:[], refresh:0, cancel:0, cleanup:[], resolve:null };
window.easyHub = {
 platform: query.has('mac') ? 'darwin' : 'win32',
 githubProxyStatus:async()=>{metrics.reads++;if(query.has('load-error')&&metrics.reads===1)throw Error('unsafe internals');if(query.has('checking')&&metrics.reads>1)current=ready;if(query.has('takeover')&&metrics.reads>1)current={...current,system:{mode:'external',error:null}};return structuredClone(current)},
 githubProxySetEnabled:async enabled=>{metrics.enabled.push(enabled);if(metrics.enabled.length===1&&(query.has('enable-rejection')||query.has('disable-rejection'))){current={...ready,state:'error',system:{mode:'unavailable',error:'unsafe recovery internals'}};throw Error('unsafe recovery internals')}current=enabled?ready:off();return structuredClone(current)},
 githubProxyRefresh:async()=>{metrics.refresh++;current={...ready,state:'checking',checks:[]};return new Promise(resolve=>{metrics.resolve=()=>{current=ready;resolve(structuredClone(ready))}})},
 githubProxyCancel:async()=>{metrics.cancel++;current=off()},
 hostsSetEnabled:async enabled=>{metrics.cleanup.push(enabled);current={...current,legacyHosts:false};return {}},
};
createRoot(document.getElementById('root')).render(createElement('main',{style:{maxWidth:810,margin:'30px auto',padding:20}},createElement(HostsRepairPanel,{language:query.has('en')?'en':'zh',disabled:query.has('disabled')})));
`;

const server = await createServer({
  configFile: false,
  root: join(dirname(fileURLToPath(import.meta.url)), 'src/renderer'),
  plugins: [react(), {
    name: 'proxy-ui-fixture',
    resolveId(id) { if (id === 'virtual:proxy-ui-fixture') return '\0' + id; },
    load(id) { if (id === '\0virtual:proxy-ui-fixture') return source; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/proxy-ui-test')) return next();
        res.setHeader('content-type', 'text/html;charset=utf-8');
        res.end(await server.transformIndexHtml(req.url, '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:proxy-ui-fixture"></script></body></html>'));
      });
    },
  }],
  server: { host: '127.0.0.1', port: 0 },
});

let browser;
try {
  await server.listen();
  const base = 'http://127.0.0.1:' + server.httpServer.address().port + '/proxy-ui-test';
  const installed = [process.env.EASYHUB_TEST_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
  browser = await chromium.launch({ executablePath: installed, headless: true });
  const page = await browser.newPage({ viewport: { width: 1060, height: 700 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const go = async query => {
    await page.goto(base + query);
    await page.getByRole('heading', { name: /GitHub/ }).waitFor();
  };

  await go('');
  const toggle = page.getByRole('switch', { name: 'GitHub 系统代理' });
  await toggle.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[role="switch"]').disabled === false);
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.equal(await page.getByText('让 EasyHub 和使用 Windows 系统代理设置的浏览器访问 GitHub 相关网站。', { exact: true }).count(), 1);
  assert.equal(await page.getByText('已有系统代理时优先复用。关闭或退出后恢复 EasyHub 修改的设置，其他代理接管时自动让出。', { exact: true }).count(), 1);
  await toggle.click();
  await page.getByText('已启用系统代理', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alertdialog').count(), 0, 'Enabling the proxy should take effect directly');
  assert.equal(await page.locator('.github-proxy-checks .is-ok').count(), 3);
  await toggle.click();
  await page.getByText('已关闭', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixture.enabled), [true, false]);

  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByText('已关闭', { exact: true }).waitFor();
  await page.evaluate(() => window.fixture.resolve());
  await page.waitForTimeout(100);
  assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'Cancelled response must not overwrite state');

  for (const [query, label] of [['?existing', '使用现有系统代理'], ['?external', '其他代理已接管']]) {
    await go(query);
    await page.getByText(label, { exact: true }).waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    assert.deepEqual(await page.evaluate(() => window.fixture.enabled), []);
    await toggle.click();
    await page.getByText('已关闭', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.enabled), [false]);
  }
  await go('?takeover');
  await page.getByText('已启用系统代理', { exact: true }).waitFor();
  await page.getByText('其他代理已接管', { exact: true }).waitFor({ timeout: 10000 });
  assert.ok(await page.evaluate(() => window.fixture.reads) >= 2, 'Observe changes made by another proxy while enabled');
  assert.deepEqual(await page.evaluate(() => window.fixture.enabled), []);

  await go('?unavailable');
  await page.getByText('系统代理暂不可用', { exact: true }).waitFor();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('unsafe system internals').count(), 0);
  assert.equal(await page.getByRole('alert').textContent(), '无法更新系统代理设置，请检查系统代理设置后重试。');

  for (const [query, initialEnabled] of [['?enable-rejection', false], ['?disable-rejection', true]]) {
    await go(query);
    await page.waitForFunction(() => document.querySelector('[role="switch"]').disabled === false);
    assert.equal(await toggle.getAttribute('aria-checked'), String(initialEnabled));
    await toggle.click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').textContent(), '系统代理设置尚未恢复，代理仍保持开启。请再次关闭以重试恢复。');
    assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'Reload the actual enabled state after a rejected operation');
    assert.equal(await toggle.isDisabled(), false, 'Allow another attempt to restore system settings');
    assert.equal(await page.getByText('unsafe recovery internals').count(), 0);
    assert.ok(await page.evaluate(() => window.fixture.reads) >= 2);
    await toggle.click();
    await page.getByText('已关闭', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.enabled), [!initialEnabled, false]);
    assert.equal(await page.getByRole('alert').count(), 0);
  }

  await go('?legacy');
  await page.getByRole('button', { name: '移除旧版修复', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixture.cleanup), []);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '取消');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '确认移除');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.fixture.cleanup), []);
  await page.getByRole('button', { name: '移除旧版修复', exact: true }).click();
  await dialog.getByRole('button', { name: '确认移除', exact: true }).click();
  await page.getByRole('button', { name: '移除旧版修复', exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.fixture.cleanup), [false]);

  await go('?load-error');
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('unsafe internals').count(), 0);
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="switch"]').disabled === false);
  assert.equal(await page.getByRole('alert').count(), 0);
  await go('?checking');
  await page.getByText('已启用系统代理', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.fixture.reads) >= 2);
  await go('?error');
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('unsafe internals').count(), 0);
  assert.equal(await page.locator('.github-proxy-checks .is-failed').count(), 1);

  await go('?en&legacy&existing');
  await page.getByRole('heading', { name: 'GitHub system proxy', exact: true }).waitFor();
  await page.getByText('Using the existing system proxy', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Remove previous repair', exact: true }).waitFor();
  assert.equal(await page.getByText('移除旧版修复', { exact: true }).count(), 0);
  await go('?en&external');
  await page.getByText('Another proxy has taken over', { exact: true }).waitFor();
  await go('?mac&existing');
  await page.getByText('使用现有系统代理', { exact: true }).waitFor();
  assert.equal(await page.getByText('让 EasyHub 和使用 macOS 系统代理设置的浏览器访问 GitHub 相关网站。', { exact: true }).count(), 1);
  await go('?mac&en&existing');
  await page.getByText('Using the existing system proxy', { exact: true }).waitFor();
  assert.equal(await page.getByText('Connect EasyHub and browsers that use macOS system proxy settings to GitHub websites.', { exact: true }).count(), 1);
  await go('?disabled&legacy');
  assert.equal(await page.getByRole('switch').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.fixture.reads), 0);
  assert.equal(await page.getByRole('button', { name: '移除旧版修复', exact: true }).count(), 0);

  await go('?legacy');
  await page.getByRole('button', { name: '移除旧版修复', exact: true }).waitFor();
  await page.setViewportSize({ width: 480, height: 700 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole('button', { name: '移除旧版修复', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS GitHub system proxy UI: direct toggle, rejected enable/disable recovery, checks/cancel, existing proxy, external takeover, safe system errors, load retry, startup checking, legacy cleanup, keyboard dialog, English, demo, 480px layout');
} finally {
  await browser?.close();
  await server.close();
}
