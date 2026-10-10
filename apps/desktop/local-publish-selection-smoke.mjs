import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out/local-publish-selection-smoke');
await mkdir(output, { recursive: true });
const fixture = `
import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {LocalWorkspace} from '/src/LocalWorkspace.tsx';
import '/src/styles.css';
import '/src/v2.css';
const repo={id:1,name:'fixture',full_name:'tester/fixture',owner:{login:'tester'},private:false,default_branch:'main',updated_at:'',open_issues_count:0};
const link={id:'local-1',repositoryId:1,owner:'tester',name:'fixture',localPath:'C:/fixture',lastOpenedAt:''};
let files=[{path:'one.txt',kind:'modified'},{path:'keep.txt',kind:'modified'},{path:'renamed.txt',previousPath:'old.txt',kind:'renamed'},{path:'image.png',kind:'added'}];
let revision=1,pending=false,held=null,cancelHeld=null;window.fixtureCalls=[];window.fixtureFail=false;window.holdDiff=false;window.holdCancel=false;
const preview=()=>({files,needsReview:false,snapshot:String(revision).repeat(64),pendingPublish:pending});
window.easyHub={platform:${JSON.stringify(process.platform)},localList:async()=>[link],localStatus:async()=>preview(),localReadIntroduction:async()=>'',onLocalStatus:()=>()=>{},onLocalProgress:()=>()=>{},localCancelPreview:async(id)=>{window.cancelledPreview=id;held?.();if(window.holdCancel){window.holdCancel=false;await new Promise(resolve=>cancelHeld=resolve)}},
 localPreviewChanges:async()=>preview(),localFileDiff:async(id,path,snapshot)=>{const diff=path==='image.png'?{path,kind:'added',unavailable:'binary',lines:[],additions:0,deletions:0}:{path,kind:'modified',lines:[{kind:'deleted',text:'old value',before:1},{kind:'added',text:revision===1?'new value':'fresh value',after:1}],additions:1,deletions:1};if(window.holdDiff){window.holdDiff=false;await new Promise(resolve=>held=resolve)}return diff},
 localPublish:async(id,message,selection)=>{window.fixtureCalls.push({id,message,selection});if(pending){pending=false;return{changed:selection.paths.length}}files=files.filter(file=>!selection.paths.includes(file.path));revision++;if(window.fixtureFail){window.fixtureFail=false;pending=true;throw Error('Error invoking remote method \\'easyhub:local-publish\\': Error: 本地版本已保存，请重试发布。')}return{changed:selection.paths.length}},
};
window.refreshFixture=()=>{revision++;held?.();};window.resolveFixture=()=>held?.();window.resolveCancel=()=>cancelHeld?.();
createRoot(document.getElementById('root')).render(h('div',{className:'app-shell','data-layout':'compact'},h('main',{className:'main-column',style:{paddingTop:0,marginLeft:0}},h('div',{className:'page-content'},h(LocalWorkspace,{mode:'list',repos:[repo],selectedRepo:repo,initialLocalId:'local-1',onBack:()=>{},onCreated:async()=>{},onDownloadProject:async()=>{},downloadBusy:false})))));
`;
const server = await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'local-selection-fixture',
  configureServer(server) { server.middlewares.use(async (request, response, next) => {
    if (request.url !== '/local-selection-test') return next();
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(await server.transformIndexHtml(request.url, '<div id="root"></div><script type="module" src="/@id/virtual:local-selection.jsx"></script>'));
  }); },
  resolveId(id) { if (id === 'virtual:local-selection.jsx') return '\0' + id; },
  load(id) { if (id === '\0virtual:local-selection.jsx') return fixture; },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 860, height: 680 } }); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === `http://127.0.0.1:${address.port}` ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${address.port}/local-selection-test`);
  const row = (path) => page.locator('.local-selection-file').filter({ has: page.getByRole('checkbox', { name: `发布 ${path}`, exact: true }) });
  await page.getByText('已选 4 / 4 个文件', { exact: true }).waitFor();
  await row('one.txt').getByRole('button', { name: '查看不同', exact: true }).click(); await page.getByText('new value', { exact: true }).waitFor();
  assert.equal(await page.locator('.local-diff-lines').getAttribute('data-content-original'), 'true');
  const layoutResults = [];
  for (const width of [800, 1060]) for (const layout of ['compact', 'comfortable']) {
    await page.setViewportSize({ width, height: 620 });
    await page.locator('.app-shell').evaluate((element, value) => element.setAttribute('data-layout', value), layout);
    await page.locator('.local-selection').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${layout}-${width}x620.png`) });
    const overflow = await page.evaluate(() => {
      const names = ['.main-column', '.local-workspace', '.local-selection', '.local-selection-row', '.local-selection-heading', '.local-diff-panel'];
      return names.flatMap((selector) => [...document.querySelectorAll(selector)].filter((element) => element.scrollWidth > element.clientWidth + 2).map((element) => ({ selector, client: element.clientWidth, scroll: element.scrollWidth })));
    });
    assert.deepEqual(overflow, [], `${layout} ${width}px must keep controls inside their container`);
    layoutResults.push({ width, height: 620, layout, overflow });
  }
  await writeFile(join(output, 'layout-results.json'), JSON.stringify(layoutResults, null, 2));
  await page.setViewportSize({ width: 860, height: 680 }); await page.locator('.app-shell').evaluate((element) => element.setAttribute('data-layout', 'compact'));
  await row('image.png').getByRole('button', { name: '查看不同', exact: true }).click(); await page.getByText('这是图片、程序或其他非文本文件，无法逐行预览；仍可勾选发布。', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: '全选', exact: true }).uncheck();
  await page.getByRole('button', { name: '发布源码', exact: true }).click(); await page.getByRole('textbox', { name: '这次改了什么？' }).fill('选择一个文件');
  assert.equal(await page.getByRole('button', { name: '发布选中的文件', exact: true }).isDisabled(), true);
  await page.getByRole('checkbox', { name: '发布 one.txt', exact: true }).check(); await page.getByRole('button', { name: '发布选中的文件', exact: true }).click();
  await page.getByText('发布成功，1 个文件已保存到 GitHub。', { exact: true }).waitFor(); assert.deepEqual(await page.evaluate(() => window.fixtureCalls[0].selection.paths), ['one.txt']);
  assert.equal(await page.getByRole('checkbox', { name: '发布 keep.txt', exact: true }).isChecked(), true);
  // A late response from the old preview must never appear after refresh.
  await page.evaluate(() => { window.holdDiff = true; }); await row('keep.txt').getByRole('button', { name: '查看不同', exact: true }).click();
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.evaluate(() => window.refreshFixture());
  await row('keep.txt').getByRole('button', { name: '查看不同', exact: true }).click(); await page.getByText('fresh value', { exact: true }).waitFor();
  await page.evaluate(() => { window.holdDiff = true; }); await row('renamed.txt').getByRole('button', { name: '查看不同', exact: true }).click(); await page.getByRole('button', { name: '取消读取', exact: true }).click();
  await page.getByText('已取消读取，可以重新读取修改。', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.cancelledPreview), 'local-1');
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByText('已选 3 / 3 个文件', { exact: true }).waitFor();
  // Finishing an old cancellation after a new read must not overwrite its UI.
  await page.evaluate(() => { window.holdDiff = true; window.holdCancel = true; }); await row('keep.txt').getByRole('button', { name: '查看不同', exact: true }).click();
  await page.getByRole('button', { name: '取消读取', exact: true }).click(); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.getByText('已选 3 / 3 个文件', { exact: true }).waitFor();
  await page.evaluate(async () => { window.resolveCancel(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  assert.equal(await page.getByText('已取消读取，可以重新读取修改。', { exact: true }).count(), 0, 'A stale cancel response must not replace the refreshed state');
  await page.evaluate(() => { window.fixtureFail = true; }); await page.getByRole('button', { name: '发布源码', exact: true }).click(); await page.getByRole('textbox', { name: '这次改了什么？' }).fill('保存后重试');
  await page.getByRole('button', { name: '发布选中的文件', exact: true }).click(); await page.getByRole('button', { name: '重试发布', exact: true }).waitFor();
  assert.equal((await page.locator('.local-workspace').innerText()).includes('Error invoking'), false);
  await page.getByRole('button', { name: '重试发布', exact: true }).click(); await page.getByText('发布成功，3 个文件已保存到 GitHub。', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixtureCalls[1].selection), await page.evaluate(() => window.fixtureCalls[2].selection));
  assert.deepEqual(errors, []);
  process.stdout.write('Local selection, line preview, binary fallback, stale response isolation and saved-version retry passed.\n');
} finally { await browser?.close(); await server.close(); }
