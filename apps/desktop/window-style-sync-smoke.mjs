import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

// The welcome and offline pages run before the workspace. On macOS they must still tell the main process which
// window style they show, or a saved Windows style shows the native traffic lights beside the Windows buttons.
// A local fixture stands in for macOS; nothing reaches GitHub or the native window.
const desktop = dirname(fileURLToPath(import.meta.url));
const fixture = `
import React from 'react';import{createRoot}from'react-dom/client';
import App from '/src/App.tsx';import{createDemoBridge}from'/src/demo/demoBridge.ts';import'/src/styles.css';
const params=new URLSearchParams(location.search);
localStorage.clear();localStorage.setItem('easyhub:language','zh');
if(params.get('style'))localStorage.setItem('easyhub:window-control-style',params.get('style'));
if(params.get('density'))localStorage.setItem('easyhub:layout-preference',params.get('density'));
const api=createDemoBridge().api;window.styleCalls=[];
api.platform='darwin';
api.setWindowControlStyle=async(style,density)=>{window.styleCalls.push([style,density])};
api.authStatus=async()=>params.get('page')==='offline'?{state:'offline',user:null}:{state:'signed-out',user:null,clientId:'fixture'};
window.easyHub=api;
createRoot(document.getElementById('root')).render(<App/>);
`;
const server = await createServer({
  configFile: false,
  root: join(desktop, 'src/renderer'),
  plugins: [
    react(),
    {
      name: 'window-style-fixture',
      resolveId(id) { if (id === 'virtual:window-style.jsx') return '\0' + id; },
      async load(id) {
        if (id === '\0virtual:window-style.jsx') return (await transformWithEsbuild(fixture, 'window-style.jsx', { loader: 'jsx', jsx: 'automatic' })).code;
      },
      configureServer(s) {
        s.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/window-style-test')) return next();
          res.setHeader('content-type', 'text/html;charset=utf-8');
          res.end(await s.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/@id/virtual:window-style.jsx"></script>'));
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
const results = [];
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/window-style-test`;
  const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  const context = await browser.newContext();
  await context.route('**/*', (route) => (/^(http|ws):\/\/127\.0\.0\.1:|^data:/.test(route.request().url()) ? route.continue() : route.abort()));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  for (const [screen, ready] of [['welcome', '.welcome-controls'], ['offline', '.welcome-controls']]) {
    for (const { style, density, expected } of [
      { style: 'windows', density: 'compact', expected: ['windows', 'compact'] },
      { style: 'reference', density: 'comfortable', expected: ['reference', 'comfortable'] },
      // Nothing saved yet: macOS starts with its own traffic lights (density follows the window size).
      { style: '', density: '', expected: ['reference'] },
    ]) {
      await page.goto(`${base}?page=${screen}&style=${style}&density=${density}`);
      await page.locator(ready).waitFor();
      if (screen === 'offline') await page.getByRole('button', { name: '重试', exact: true }).waitFor();
      else await page.getByRole('button', { name: '登录 GitHub', exact: true }).waitFor();
      await page.waitForFunction((want) => window.styleCalls.some((call) => call[0] === want), expected[0]);
      const calls = await page.evaluate(() => window.styleCalls);
      const label = `${screen} with ${style || 'no saved'} style`;
      assert.deepEqual(calls.at(-1).slice(0, expected.length), expected, `${label}: the main process learns the style the page shows`);
      const windowsButtons = await page.locator('.welcome-controls .windows-window-controls').count();
      const nativeSpace = await page.locator('.welcome-controls .native-window-controls').count();
      if (expected[0] === 'windows') {
        assert.equal(windowsButtons, 1, `${label}: shows the Windows buttons`);
        assert.equal(nativeSpace, 0, `${label}: keeps no space for traffic lights the main process hides`);
      } else {
        assert.equal(windowsButtons, 0, `${label}: shows no Windows buttons beside the traffic lights`);
        assert.equal(nativeSpace, 1, `${label}: keeps the space for the native traffic lights`);
      }
      results.push({ screen, style: style || 'default', calls });
    }
  }
  // Changing the layout in Settings must reach the window buttons as well: they read the same layout as the
  // workspace, so macOS moves its traffic lights to the compact toolbar position.
  await page.goto(`${base}?page=welcome&style=&density=comfortable`);
  await page.getByRole('button', { name: '先看看演示', exact: true }).click();
  await page.waitForFunction(() => window.styleCalls.some((call) => call[0] === 'reference' && call[1] === 'comfortable'));
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  await page.getByRole('button', { name: '紧凑', exact: true }).click();
  await page.waitForFunction(() => {
    const last = window.styleCalls.at(-1);
    return last?.[0] === 'reference' && last?.[1] === 'compact';
  });
  assert.deepEqual((await page.evaluate(() => window.styleCalls)).at(-1), ['reference', 'compact'], 'Settings layout reaches the main process');
  results.push({ screen: 'workspace settings', style: 'default', calls: await page.evaluate(() => window.styleCalls) });
  assert.deepEqual(errors, []);
  console.log(`Window style sync passed: welcome and offline pages, saved Windows/dot styles, the macOS default and a layout change in Settings (${results.length} cases).`);
} finally {
  await browser?.close();
  await server.close();
}
