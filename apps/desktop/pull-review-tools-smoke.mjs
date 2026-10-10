import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, 'out', 'pull-review-tools-smoke');
await mkdir(output, { recursive: true });
// Production components with injected read-only GitHub fixtures. Every external
// request is blocked and no approval, comment or other remote mutation is mocked.
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {PullRequestsPanel} from '/src/components/PullRequestsPanel.tsx';
import '/src/styles.css';import '/src/v2.css';
const now='2026-10-08T00:00:00Z';
const repo={id:1,name:'sample',full_name:'owner/sample',private:true,default_branch:'main',owner:{login:'owner'},permissions:{push:true,admin:true},updated_at:now};
const pull=number=>({id:number,number,title:'Change '+number,body:'Please review the changed lines.',state:'open',draft:false,created_at:now,user:{login:'contributor'},head:{sha:(number===7?'a':'b').repeat(40),ref:'feature'},base:{sha:'c'.repeat(40),ref:'main',repo:{id:1}}});
const files=[
 {filename:'src/main.ts',status:'modified',additions:1,deletions:1,patch:'@@ -1,3 +1,3 @@\\n same\\n-old value\\n+<img src=x onerror=alert(1)>\\n last'},
 {filename:'assets/app.bin',status:'modified',additions:0,deletions:0},
 {filename:'empty.txt',status:'added',sha:'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',additions:0,deletions:0},
 {filename:'new-name.ts',previous_filename:'old-name.ts',status:'renamed',additions:0,deletions:0},
 {filename:'truncated.ts',status:'modified',additions:3,deletions:1,patch:'@@ -1 +1,3 @@\\n-old\\n+only part'},
 {filename:'long.ts',status:'added',additions:450,deletions:0,patch:'@@ -0,0 +1,450 @@\\n'+Array.from({length:450},(_,i)=>'+line '+i).join('\\n')},
];
const run=(id,name,conclusion='success',status='completed',head='a'.repeat(40))=>({id,name,head_sha:head,status,conclusion,html_url:'https://github.com/owner/sample/actions/runs/'+id,details_url:null,started_at:now,completed_at:now,app:{id:1,name:'Builder'}});
const legacy=(id,state)=>({id,context:'legacy-build',state,description:'Status report',target_url:'https://ci.example.com/build/1',created_at:now,updated_at:now});
window.mode='paged';window.links=[];window.reads=[];window.held=null;window.resolved=false;window.writes=[];
window.easyHub={onAiReviewProgress:()=>()=>{},openExternalLink:async(url)=>{window.links.push(url)},github:async(action,...args)=>{
window.reads.push({action,args});
if(action==='pullRequests'||action==='pullRequestsPage')return [pull(7),pull(8)];
if(action==='pullRequest')return pull(args[2]);
if(action==='pullReviewContext')return {repository:repo,pullRequest:pull(args[2]),files,filesTruncated:false};
if(action==='comments')return [];
if(action==='pullChecks'){
 const {headSha,checkPage,statusPage}=args[3];const available=items=>({state:'available',items,nextPage:null});
 if(window.mode==='hold'&&args[2]===7){await new Promise(resolve=>window.held=resolve);window.resolved=true;return {headSha,checkRuns:available([run(99,'late-old-check')]),statuses:available([])}};
 if(args[2]===8)return {headSha,checkRuns:available([run(8,'new-request-check',null,'in_progress',headSha)]),statuses:available([])};
 if(window.mode==='error')throw Error('changed revision');
 if(window.mode==='empty')return {headSha,checkRuns:available([]),statuses:available([])};
 if(window.mode==='many')return {headSha,checkRuns:available([...Array.from({length:8},(_,i)=>run(i+1,'passed-check-'+i)),run(20,'must-fix','failure'),run(21,'still-running',null,'in_progress')]),statuses:available([])};
 if(window.mode==='denied')return {headSha,checkRuns:available([run(1,'unit-tests')]),statuses:{state:'forbidden',items:[],nextPage:1}};
 if(window.mode==='neutral')return {headSha,checkRuns:available([run(1,'unit-tests','skipped'),run(2,'optional-check','neutral'),run(3,'future-check',null,'unknown')]),statuses:available([])};
 if(window.mode==='passed')return {headSha,checkRuns:checkPage===null?null:available([run(1,'unit-tests')]),statuses:statusPage===null?null:available([legacy(10,'success'),legacy(9,'failure')])};
 return {headSha,checkRuns:checkPage===1?{state:'available',items:[run(1,'unit-tests')],nextPage:2}:available([run(2,'integration-tests','failure')]),statuses:statusPage===null?null:available([legacy(3,'pending')])};
}
window.writes.push(action);throw Error('Blocked unexpected action '+action);
}};
createRoot(document.getElementById('root')).render(React.createElement(PullRequestsPanel,{repo,currentUser:'owner',language:new URLSearchParams(location.search).get('lang')||'zh'}));
`;
const server = await createServer({ configFile: false, root: join(root, 'src/renderer'), plugins: [react(), {
  name: 'pull-review-tools-fixture',
  configureServer(server) { server.middlewares.use(async (request, response, next) => { if (!request.url.startsWith('/pull-tools-test')) return next(); response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(await server.transformIndexHtml(request.url, '<div id="root"></div><script type="module" src="/@id/virtual:pull-tools.jsx"></script>')); }); },
  resolveId(id) { if (id === 'virtual:pull-tools.jsx') return '\0' + id; }, load(id) { if (id === '\0virtual:pull-tools.jsx') return fixture; },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/pull-tools-test`;
  const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1060, height: 760 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  await page.goto(url); await page.getByRole('button', { name: /Change 7/ }).click();
  await page.getByText('检查结果尚未完整载入', { exact: true }).waitFor();
  assert.equal(await page.getByText('已报告的检查均已通过', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '加载更多检查', exact: true }).click();
  await page.getByText('有检查未通过', { exact: true }).waitFor();
  assert.equal(await page.locator('.pull-check-row').count(), 3);
  assert.equal(await page.locator('.pull-check-state.failed').innerText(), '未通过 1');
  await page.locator('.pull-check-row').filter({ hasText: 'unit-tests' }).getByRole('button', { name: '查看日志', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.links), ['https://github.com/owner/sample/actions/runs/1']);
  const file = name => page.locator('.pull-file-change').filter({ hasText: name });
  await file('src/main.ts').locator('.pull-file-toggle').click();
  assert.equal(await file('src/main.ts').locator('.pull-diff-remove .pull-line-number').first().innerText(), '2');
  assert.equal(await file('src/main.ts').locator('.pull-diff-add .pull-line-number').nth(1).innerText(), '2');
  assert.equal(await file('src/main.ts').locator('.pull-diff-add .pull-line-code').innerText(), '<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('.pull-diff-scroll img').count(), 0);
  for (const name of ['assets/app.bin', 'empty.txt', 'new-name.ts', 'truncated.ts']) await file(name).locator('.pull-file-toggle').click();
  assert.match(await file('assets/app.bin').innerText(), /没有提供.*文字差异/);
  assert.match(await file('empty.txt').innerText(), /新建的空文件/);
  assert.match(await file('new-name.ts').innerText(), /old-name.ts → new-name.ts/);
  assert.match(await file('truncated.ts').innerText(), /不完整/);
  await file('long.ts').locator('.pull-file-toggle').click();
  assert.equal(await file('long.ts').locator('tbody tr').count(), 200);
  await file('long.ts').getByRole('button', { name: '继续查看修改内容', exact: true }).click();
  assert.equal(await file('long.ts').locator('tbody tr').count(), 400);
  await file('src/main.ts').getByRole('button', { name: '在 GitHub 查看完整修改', exact: true }).click();
  assert.equal(await page.evaluate(() => window.links.at(-1)), 'https://github.com/owner/sample/pull/7/files');
  const refresh = async mode => { await page.evaluate(mode => { window.mode = mode; }, mode); await page.getByRole('button', { name: '刷新检查', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.pull-checks-heading button').disabled); };
  await refresh('many');
  assert.equal(await page.locator('.pull-check-row').count(), 5, 'Long checks list should start compact');
  assert.equal(await page.locator('.pull-check-row strong').first().innerText(), 'must-fix');
  assert.equal(await page.locator('.pull-check-row strong').nth(1).innerText(), 'still-running');
  assert.equal(await page.locator('.pull-check-state.passed').innerText(), '已通过 8', 'Summary includes collapsed checks');
  assert.equal(await page.locator('.pull-check-row small').first().evaluate(node => getComputedStyle(node).display), 'block');
  await page.getByRole('button', { name: '查看全部检查（10）', exact: true }).click();
  assert.equal(await page.locator('.pull-check-row').count(), 10);
  await page.getByRole('button', { name: '收起检查', exact: true }).click();
  assert.equal(await page.locator('.pull-check-row').count(), 5);
  await refresh('denied'); await page.getByText('部分检查暂时无法确认', { exact: true }).waitFor();
  assert.equal(await page.getByText('已报告的检查均已通过', { exact: true }).count(), 0);
  await page.evaluate(() => { window.mode = 'passed'; }); await page.getByRole('button', { name: '重试未读取的检查', exact: true }).click();
  await page.getByText('已报告的检查均已通过', { exact: true }).waitFor();
  assert.equal(await page.locator('.pull-check-row').count(), 2, 'Older context state must not override the latest status');
  assert.equal(await page.evaluate(() => window.reads.filter(item => item.action === 'pullChecks').at(-1).args[3].checkPage), null);
  await refresh('empty'); await page.getByText('当前修改没有报告检查结果', { exact: true }).waitFor();
  assert.equal(await page.getByText('已报告的检查均已通过', { exact: true }).count(), 0);
  await refresh('neutral'); await page.getByText('请查看各项检查结果', { exact: true }).waitFor();
  assert.equal(await page.locator('.pull-check-state.passed').count(), 0);
  await refresh('error'); await page.locator('.pull-checks .live-error').waitFor();
  assert.equal(await page.getByText('已报告的检查均已通过', { exact: true }).count(), 0);
  await page.evaluate(() => { window.mode = 'hold'; }); await page.getByRole('button', { name: '刷新检查', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.held));
  await page.getByRole('button', { name: '返回合并请求审查', exact: true }).click(); await page.getByRole('button', { name: /Change 8/ }).click();
  await page.getByText('new-request-check', { exact: true }).waitFor(); await page.evaluate(() => window.held());
  await page.waitForFunction(() => window.resolved); await page.waitForTimeout(80);
  assert.equal(await page.getByText('late-old-check', { exact: true }).count(), 0);
  assert.equal(await page.getByText('new-request-check', { exact: true }).count(), 1);
  await page.screenshot({ path: join(output, 'checks-narrow.png'), fullPage: false });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(await page.evaluate(() => window.writes), []);
  await writeFile(join(output, 'read-requests.json'), JSON.stringify(await page.evaluate(() => window.reads), null, 2));
  await page.goto(url + '?lang=en'); await page.getByRole('button', { name: /Change 7/ }).click();
  await page.getByRole('heading', { name: 'Build and tests', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Load more checks', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Pull review tools passed: line numbers, escaped code, binary/empty/rename/truncated changes, bounded preview, paged checks, latest statuses, denied/empty/pending results, controlled log links, stale-response isolation and English UI.');
} finally { await browser?.close(); await server.close(); }
