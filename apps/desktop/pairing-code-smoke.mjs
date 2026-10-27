import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out/pairing-code');
await mkdir(output, { recursive: true });
const fixture = `
import React from 'react';import{createRoot}from'react-dom/client';
import App from '/src/App.tsx';import{LiveProjectDangerZone}from'/src/components/LiveProjectDangerZone.tsx';
import{createDemoBridge}from'/src/demo/demoBridge.ts';import{LanguageContext}from'/src/i18n.ts';import'/src/styles.css';
const params=new URLSearchParams(location.search),language=params.get('language')||'zh',kind=params.get('kind')||'login';
localStorage.clear();localStorage.setItem('easyhub:language',language);localStorage.setItem('easyhub:layout-preference',params.get('density')||'comfortable');
if(params.get('entry')==='demo')localStorage.setItem('easyhub:welcome-choice','demo');
const demo=createDemoBridge(),api=demo.api;window.calls=[];window.copyResult=true;window.holdCopy=false;window.copyThrows=false;window.complete=false;window.authorized=false;let generation=0;
const flow=()=>({userCode:'TEST-'+String(++generation).padStart(4,'0'),verificationUri:'https://github.com/login/device',expiresAt:Date.now()+600000,interval:1,...(params.get('copied')==='missing'?{}:{codeCopied:params.get('copied')==='true'})});
api.authStatus=async()=>({state:'signed-out',user:null,clientId:'fixture'});
api.authStart=async()=>{window.calls.push({method:'authStart'});return flow()};
api.authStartDeletion=async(...args)=>{window.calls.push({method:'authStartDeletion',args});return flow()};
api.authPoll=async()=>{window.calls.push({method:'authPoll'});if(window.complete){window.authorized=true;return{state:'complete',user:demo.user}}return{state:'waiting'}};
api.authCancel=async()=>{window.calls.push({method:'authCancel'})};
api.openExternalLink=async(url)=>{window.calls.push({method:'openExternalLink',url})};
api.copyPairingCode=async(code)=>{window.calls.push({method:'copyPairingCode',code});if(window.holdCopy)await new Promise(resolve=>window.finishCopy=resolve);if(window.copyThrows)throw Error('Clipboard unavailable');return window.copyResult};
if(params.get('copyApi')==='missing')delete api.copyPairingCode;
const originalGithub=api.github;
api.github=async(action,...args)=>{window.calls.push({method:action,args});if(action==='deleteRepoScope')return window.authorized;if(action==='deleteRepo')throw Error('Test must never delete a repository');return originalGithub(action,...args)};
window.easyHub=api;
const repo={id:1,name:'fixture',full_name:'owner/fixture',private:true,owner:{login:'owner'},permissions:{admin:true,push:true}};
createRoot(document.getElementById('root')).render(<LanguageContext.Provider value={language}>{kind==='login'?<App/>:<div className="app-shell"><main className="page-content" style={{gridColumn:'1/-1'}}><LiveProjectDangerZone repo={repo} language={language} open onClose={()=>{}} onUpdate={()=>{}} onTransferred={()=>{}} onNotice={()=>{}}/></main></div>}</LanguageContext.Provider>);
`;
const server = await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'pairing-code-fixture',
  resolveId(id) { if (id === 'virtual:pairing.jsx') return '\0' + id; },
  async load(id) { if (id === '\0virtual:pairing.jsx') return (await transformWithEsbuild(fixture, 'pairing.jsx', { loader: 'jsx', jsx: 'automatic' })).code; },
  configureServer(s) { s.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/pairing-test')) return next();
    res.setHeader('content-type', 'text/html;charset=utf-8');
    res.end(await s.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/@id/virtual:pairing.jsx"></script>'));
  }); },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
const results = [], errors = [];
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/pairing-test`;
  const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  const context = await browser.newContext();
  await context.route('**/*', route => /^(http|ws):\/\/127\.0\.0\.1:|^data:/.test(route.request().url()) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  // The project settings list stays open beneath the deletion confirmation, so name the one to inspect.
  const confirmDialog = (kind, language) => page.getByRole('dialog', kind === 'login' ? {} : { name: language === 'zh' ? '删除此项目' : 'Delete project' });
  async function open(kind, language, copied, width = 1000, density = 'comfortable', extra = '') {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: density === 'compact' ? 'reduce' : 'no-preference' });
    await page.goto(`${base}?kind=${kind}&language=${language}&copied=${copied}&density=${density}${extra}`);
    if (kind === 'login') {
      await page.getByRole('button', { name: language === 'zh' ? '登录 GitHub' : 'Sign in to GitHub', exact: true }).click();
    } else {
      await page.locator('.danger-zone-row').last().getByRole('button').click();
      await page.getByRole('textbox', { name: language === 'zh' ? '确认项目名称' : 'Confirm project name' }).fill('owner/fixture');
      await page.getByRole('button', { name: language === 'zh' ? '授权删除权限' : 'Authorize deletion', exact: true }).click();
    }
    await confirmDialog(kind, language).getByText('TEST-0001', { exact: true }).waitFor();
    return confirmDialog(kind, language);
  }
  function status(dialog) { return dialog.locator('[role="status"]').filter({ hasText: /配对码|Pairing code|pairing code/ }); }
  const copyLabel = language => language === 'zh' ? '复制配对码' : 'Copy pairing code';
  const copiedMessage = language => language === 'zh' ? '配对码已复制，可直接粘贴到 GitHub。' : 'Pairing code copied. Paste it on GitHub.';
  const failedMessage = language => language === 'zh' ? '无法复制配对码，请手动选择上方代码。' : 'Could not copy the pairing code. Select the code above manually.';
  for (const kind of ['login', 'deletion']) for (const language of ['zh', 'en']) for (const density of ['comfortable', 'compact']) for (const width of [1440, 1000]) {
    const dialog = await open(kind, language, 'true', width, density);
    assert.equal(await status(dialog).innerText(), copiedMessage(language), 'Main-process clipboard success must be visible');
    assert.equal(await dialog.getByRole('button', { name: copyLabel(language), exact: true }).count(), 1);
    const actionBounds = await dialog.getByRole('button').evaluateAll(buttons => buttons.filter(button => /复制配对码|Copy pairing code|重新打开 GitHub|Open GitHub Again|打开 GitHub 授权|Open GitHub authorization|^取消$|^Cancel$/.test(button.textContent.trim())).map(button => { const r = button.getBoundingClientRect(); return { text: button.textContent.trim(), y: r.y + r.height / 2 }; }));
    const row = kind === 'login' ? actionBounds : actionBounds.filter(button => !/^(取消|Cancel)$/.test(button.text));
    assert.ok(row.every(button => Math.abs(button.y - row[0].y) <= 1), 'Pairing actions must share one horizontal row: ' + JSON.stringify(row));
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.method === 'copyPairingCode').length), 0, 'Opening the dialog must not copy again');
    const bounds = await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, overflow: el.scrollWidth > el.clientWidth }; });
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 900 && !bounds.overflow, JSON.stringify(bounds));
    await page.screenshot({ path: join(output, `${kind}-${language}-${density}-${width}.png`), animations: 'disabled' });
    results.push({ kind, language, density, width, autoCopied: true });
  }
  for (const kind of ['login', 'deletion']) for (const language of ['zh', 'en']) {
    const dialog = await open(kind, language, 'false');
    assert.equal(await status(dialog).innerText(), failedMessage(language));
    await page.evaluate(() => { window.holdCopy = true; });
    const copy = dialog.getByRole('button', { name: copyLabel(language), exact: true });
    await copy.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.calls.filter(c => c.method === 'copyPairingCode').length === 1);
    assert.equal(await dialog.getByRole('button', { name: language === 'zh' ? '正在复制…' : 'Copying…', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.finishCopy());
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some(el => /配对码已复制|Pairing code copied/.test(el.textContent)));
    assert.equal((await page.evaluate(() => window.calls.find(c => c.method === 'copyPairingCode'))).code, 'TEST-0001');
    await page.evaluate(() => { window.holdCopy = false; window.copyResult = false; });
    await copy.click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some(el => /无法复制配对码|Could not copy/.test(el.textContent)));
    await page.evaluate(() => { window.copyThrows = true; }); await copy.click();
    await page.waitForFunction(() => window.calls.filter(c => c.method === 'copyPairingCode').length === 3);
    assert.equal(await status(dialog).innerText(), failedMessage(language));
    await page.evaluate(() => { window.copyThrows = false; window.copyResult = true; }); await copy.click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some(el => /配对码已复制|Pairing code copied/.test(el.textContent)));
    // The pairing code remains selectable if every clipboard attempt fails.
    assert.equal(await dialog.locator('.oauth-code').evaluate(el => getComputedStyle(el).userSelect), 'all');
    await dialog.locator('.oauth-code').selectText();
    assert.equal(await page.evaluate(() => getSelection().toString()), 'TEST-0001');
    await copy.focus();
    for (let step = 0; step < 8; step++) {
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'Tab stays inside the authorization dialog');
    }
    const cancel = dialog.getByRole('button', { name: language === 'zh' ? '取消' : 'Cancel', exact: true });
    await cancel.click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.calls.some(c => c.method === 'authCancel')), true);
    results.push({ kind, language, manualCopyRetry: true, keyboard: true });
  }
  // Missing clipboard support never claims success and still lets the user authorize manually.
  for (const kind of ['login', 'deletion']) {
    const dialog = await open(kind, 'en', 'missing', 1000, 'compact', '&copyApi=missing');
    assert.equal(await status(dialog).innerText(), failedMessage('en'));
    await dialog.getByRole('button', { name: 'Copy pairing code', exact: true }).click();
    assert.equal(await status(dialog).innerText(), failedMessage('en'));
  }
  // Entering login from the demo banner must use the native auth bridge, not demo clipboard results.
  await open('login', 'en', 'true', 1000, 'compact', '&entry=demo');
  assert.equal(await status(page.getByRole('dialog').last()).innerText(), copiedMessage('en'));
  // An outstanding copy from a closed flow must not change the next flow's status.
  for (const kind of ['login', 'deletion']) {
    let dialog = await open(kind, 'en', 'false');
    await page.evaluate(() => { window.holdCopy = true; });
    await dialog.getByRole('button', { name: 'Copy pairing code', exact: true }).click();
    await page.waitForFunction(() => typeof window.finishCopy === 'function');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(label => document.activeElement?.textContent?.trim() === label, kind === 'login' ? 'Sign in to GitHub' : 'Delete project');
    if (kind === 'login') await page.getByRole('button', { name: 'Sign in to GitHub', exact: true }).click();
    else {
      await page.locator('.danger-zone-row').last().getByRole('button').click();
      await page.getByRole('textbox', { name: 'Confirm project name' }).fill('owner/fixture');
      await page.getByRole('button', { name: 'Authorize deletion', exact: true }).click();
    }
    dialog = confirmDialog(kind, 'en'); await dialog.getByText('TEST-0002', { exact: true }).waitFor();
    await page.evaluate(() => window.finishCopy());
    await page.waitForTimeout(50);
    assert.equal(await status(dialog).innerText(), failedMessage('en'));
  }
  // Granting delete scope must still require a separate explicit delete confirmation.
  const dialog = await open('deletion', 'en', 'true');
  await page.evaluate(() => { window.complete = true; });
  await dialog.getByText(/Authorization succeeded/).waitFor({ timeout: 10000 });
  assert.equal(await page.evaluate(() => window.calls.filter(c => c.method === 'deleteRepo').length), 0);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, results, errors, scope: 'Production App and danger zone; isolated in-memory bridge; external network blocked; no account writes or real clipboard changes.' }, null, 2));
  console.log(`Pairing code smoke passed (${results.length} layout and copy cases).`);
} catch (error) {
  if (browser) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' });
  throw error;
} finally {
  await browser?.close(); await server.close();
}
