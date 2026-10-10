import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Real notification/hook UI, isolated new IPC-shaped fixture. No GitHub or user files.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out/managed-downloads-smoke');
await mkdir(output, { recursive: true });
const fixture = `
import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {useDownloadCenter} from '/src/components/useDownloadCenter.ts';
import {DownloadNotifications} from '/src/components/DownloadNotifications.tsx';
import '/src/styles.css';
import '/src/v2.css';
let rows=JSON.parse(localStorage.getItem('managed-download-fixture')||'[]').map(item=>item.state==='running'||item.state==='queued'?{...item,state:item.request.kind==='project'?'failed':'paused'}:item);
const listeners=new Set();
let count=rows.length;
window.fixtureActions=[];
const clone=value=>JSON.parse(JSON.stringify(value));
const emit=()=>{localStorage.setItem('managed-download-fixture',JSON.stringify(rows));for(const listener of listeners)listener(clone(rows))};
const pump=()=>{let active=rows.filter(item=>item.state==='running').length;for(const item of [...rows].reverse())if(item.state==='queued'&&active<2){item.state='running';active++}emit()};
const repo={id:1,name:'fixture',full_name:'fixture/fixture',owner:{login:'fixture'},private:false,default_branch:'main',updated_at:'',open_issues_count:0};
window.easyHub={platform:${JSON.stringify(process.platform)},
 downloadsList:async()=>clone(rows),
 onDownloadsChanged:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
 downloadsEnqueue:async(request)=>{window.fixtureActions.push(['enqueue',request.kind]);if(window.failNextDownload){window.failNextDownload=false;throw Error('无法选择保存位置。')}const item={id:crypto.randomUUID(),request,state:'queued',percent:25,loaded:256,total:1024,bytesPerSecond:128,phase:'正在下载…',seen:true};rows.unshift(item);pump();return clone(item)},
 downloadsCommand:async(id,action)=>{window.fixtureActions.push([id,action]);const item=rows.find(item=>item.id===id);if(!item)return;
 if(action==='pause')item.state='paused';else if(action==='resume')item.state='queued';else if(action==='cancel')item.state='cancelled';else if(action==='seen')item.seen=true;else if(action==='remove')rows=rows.filter(item=>item.id!==id);pump()},
 downloadsClear:async()=>{rows=rows.filter(item=>!['complete','failed','cancelled'].includes(item.state));emit()},
 downloadsOpen:async(id,folder)=>{window.fixtureActions.push([id,folder?'folder':'file'])},
};
window.fixtureComplete=id=>{const item=rows.find(item=>item.id===id);Object.assign(item,{state:'complete',percent:100,path:'C:/fixture/'+item.request.fileName,seen:false,phase:'项目已经下载完成。'});pump()};
window.fixtureRows=()=>clone(rows);
window.fixtureTick=emit;
function App(){const center=useDownloadCenter(async()=>{});return h('div',{className:'v2-layout','data-layout':'compact'},
 h('div',{style:{padding:20,display:'flex',gap:20,alignItems:'center',height:80}},h('button',{className:'button',disabled:center.busy,onClick:()=>center.start({kind:'archive',repo,ref:'main',assetId:++count,fileName:'file-'+count+'.zip'})},'添加下载'),
 h('button',{className:'button',disabled:center.busy,onClick:()=>center.start({kind:'project',repo,fileName:'本地项目'})},'下载本地项目'),
 h('div',{style:{marginLeft:'auto',marginRight:100}},h(DownloadNotifications,{center,savedPublicRepoIds:[],onAddPublic:()=>{}}))))}
createRoot(document.getElementById('root')).render(h(App));
`;
const server = await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'managed-downloads-fixture',
  configureServer(server) { server.middlewares.use(async (request, response, next) => {
    if (request.url !== '/managed-downloads-test') return next();
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(await server.transformIndexHtml(request.url, '<div id="root"></div><script type="module" src="/@id/virtual:managed-downloads.jsx"></script>'));
  }); },
  resolveId(id) { if (id === 'virtual:managed-downloads.jsx') return '\0' + id; },
  load(id) { if (id === '\0virtual:managed-downloads.jsx') return fixture; },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1060, height: 700 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === `http://127.0.0.1:${address.port}` ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${address.port}/managed-downloads-test`);
  const add = page.getByRole('button', { name: '添加下载', exact: true });
  const row = name => page.locator('.download-notification-item').filter({ hasText: name });
  await add.click(); await add.click(); await add.click();
  await row('file-3.zip').getByText('等待下载', { exact: true }).waitFor();
  assert.equal(await add.isDisabled(), false, 'Further downloads can be added while transfers are active');
  assert.equal(await page.getByRole('progressbar').count(), 2);
  await row('file-1.zip').getByRole('button', { name: '暂停', exact: true }).click();
  await row('file-1.zip').getByRole('button', { name: '继续下载', exact: true }).waitFor();
  await row('file-3.zip').getByRole('progressbar').waitFor();
  await page.reload();
  await page.getByRole('button', { name: '通知', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '继续下载', exact: true }).count(), 3, 'Restored transfers stay paused until the user chooses');
  await row('file-1.zip').getByRole('button', { name: '继续下载', exact: true }).click();
  await row('file-1.zip').getByRole('progressbar').waitFor();
  await page.getByRole('button', { name: '关闭通知', exact: true }).click();
  await page.evaluate(() => window.fixtureComplete(window.fixtureRows().find(item => item.request.fileName === 'file-1.zip').id));
  await page.locator('.download-notification-count').getByText('1', { exact: true }).waitFor();
  await page.getByRole('button', { name: '通知', exact: true }).click();
  await page.locator('.download-notification-count').waitFor({ state: 'hidden' });
  await row('file-1.zip').getByRole('button', { name: '打开文件夹', exact: true }).click();
  await page.getByRole('button', { name: '清除下载记录', exact: true }).click();
  assert.equal(await page.locator('.download-notification-item').count(), 2, 'Clearing finished records preserves paused transfers');
  await row('file-2.zip').getByRole('button', { name: '取消', exact: true }).click();
  await row('file-2.zip').getByRole('button', { name: '重试', exact: true }).click();
  await row('file-2.zip').getByRole('progressbar').waitFor();
  await page.getByRole('button', { name: '下载本地项目', exact: true }).click();
  await row('本地项目').getByRole('progressbar').waitFor();
  assert.equal(await row('本地项目').getByRole('button', { name: '暂停', exact: true }).count(), 0, 'Clones offer cancellation, not resumable file transfer');
  await row('本地项目').getByRole('button', { name: '取消', exact: true }).click();
  const projectId = await page.evaluate(() => window.fixtureRows().find(item => item.request.kind === 'project').id);
  await row('本地项目').getByRole('button', { name: '重试', exact: true }).click();
  await row('本地项目').getByRole('progressbar').waitFor();
  assert.equal(await page.evaluate(id => window.fixtureActions.some(action => action[0] === id && action[1] === 'resume'), projectId), false, 'Clone retry chooses a new destination through enqueue instead of reusing the incomplete directory');
  await page.getByRole('button', { name: '关闭通知', exact: true }).click();
  await page.evaluate(() => { window.failNextDownload = true; });
  await add.click();
  await page.getByText('无法选择保存位置。', { exact: true }).waitFor();
  await page.evaluate(() => window.fixtureTick());
  await page.getByText('无法选择保存位置。', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  const geometry = await page.locator('.download-notification-panel').evaluate(element => {
    const box = element.getBoundingClientRect(); return { x: box.x, right: box.right, width: innerWidth, horizontalOverflow: element.scrollWidth - element.clientWidth };
  });
  assert.ok(geometry.x >= 0 && geometry.right <= geometry.width && geometry.horizontalOverflow === 0, JSON.stringify(geometry));
  await page.screenshot({ path: join(output, 'notification-queue.png') });
  await writeFile(join(output, 'result.json'), JSON.stringify({ geometry, actions: await page.evaluate(() => window.fixtureActions), errors }, null, 2));
  console.log('Managed downloads UI passed: queue, pause/resume, reload recovery, retry, unread count, safe clearing and clone cancellation.');
} finally { await browser?.close(); await server.close(); }
