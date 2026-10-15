import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const desktop = dirname(fileURLToPath(import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'easyhub-workspace-safety-'));
const output = join(desktop, 'out/workspace-safety-smoke'); await mkdir(output, { recursive: true });
const fixture = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import App from '/src/App.tsx';import{FeedbackNotice}from'/src/components/FeedbackNotice.tsx';import{useFeedback}from'/src/useFeedback.ts';import '/src/tokens.css';import '/src/styles.css';
const mode=new URLSearchParams(location.search).get('mode')||'online';
const repo={id:1,name:'sample',full_name:'tester/sample',description:'Fixture project',private:false,default_branch:'main',updated_at:'2026-10-14T12:00:00Z',owner:{login:'tester',avatar_url:''},open_issues_count:0};
const link={id:'local-1',repositoryId:1,owner:'tester',name:'sample',localPath:'C:/fixture',lastOpenedAt:''};
const user={login:'tester',name:'Test',avatar_url:'',html_url:'https://github.com/tester'};
const preview={files:[{path:'file.txt',kind:'modified'}],needsReview:false,snapshot:'a'.repeat(64)};
window.reads=[];window.writes=[];window.releaseAuth=null;
if(mode==='offline')localStorage.setItem('easyhub:repos:tester',JSON.stringify([repo]));
const api={platform:'win32',authStatus:()=>mode==='online'?new Promise(resolve=>window.releaseAuth=()=>resolve({state:'signed-in',user,clientId:'fixture'})):Promise.resolve({state:mode==='demo'?'signed-out':mode==='expired'?'expired':'offline',user:mode==='offline'?user:null,clientId:'fixture'}),
 localList:async()=>[link],localStatus:async()=>preview,localPreviewChanges:async()=>preview,localReadIntroduction:async()=>('# README\\n\\nLong introduction.\\n\\n'.repeat(100)),localPublish:async(...args)=>{window.writes.push(args);return{changed:1}},
 github:async(action,...args)=>{window.reads.push({action,args});if(action==='repos')return[repo];if(action==='activityCounts')return{1:{issues:0,closedIssues:0,pullRequests:0,closedPullRequests:0}};if(action==='trending')return{items:[],page:1,hasNextPage:false};if(action==='searchPublicReposPage'||action==='searchUsersPage')return{items:[],totalCount:0,hasNextPage:false};if(action==='readme')return'# README';if(action==='repository'||action==='publicRepo')return repo;return[]},
 githubProxyStatus:async()=>({enabled:false,state:'off',checks:[],checkedAt:null,error:null,legacyHosts:false,system:{mode:'off'}}),hostsRepairStatus:async()=>({enabled:false,supported:true}),binaryAnalysisStatus:async()=>({installed:false,state:'missing',languages:[]}),aiSettings:async()=>({hasApiKey:false,model:'',providerId:'deepseek',baseUrl:'https://api.deepseek.com'}),localDiscoverySettings:async()=>({roots:[],enabled:false}),
};window.easyHub=new Proxy(api,{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return()=>()=>{};return async()=>[]}});
function Probe(){const[page,setPage]=useState('first');const f=useFeedback(page);return <div><button onClick={()=>f.setNotice('成功提示')}>成功</button><button onClick={()=>f.setError('错误提示')}>错误</button><button onClick={()=>setPage(page==='first'?'next':'first')}>换页</button><FeedbackNotice message={f.notice} onClose={()=>f.setNotice('')} language="zh"/><FeedbackNotice message={f.error} kind="error" onClose={()=>f.setError('')} language="zh"/></div>}
createRoot(document.getElementById('root')).render(mode==='feedback'?<Probe/>:<App/>);
`;
const server = await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'workspace-safety-fixture', resolveId(id) { if(id==='virtual:workspace-safety.jsx')return '\0'+id; },async load(id){if(id==='\0virtual:workspace-safety.jsx')return (await transformWithEsbuild(fixture,'fixture.jsx',{loader:'jsx',jsx:'automatic'})).code;},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/workspace-safety-test'))return next();res.setHeader('content-type','text/html');res.end(await server.transformIndexHtml(req.url,'<div id="root"></div><script type="module" src="/@id/virtual:workspace-safety.jsx"></script>'));});},
}], server: { host: '127.0.0.1', port: 0 } });
let app; const errors=[];
try {
  await server.listen(); const url = `http://127.0.0.1:${server.httpServer.address().port}/workspace-safety-test`;
  const bootstrap = join(profile, 'bootstrap.cjs');
  await writeFile(bootstrap, `const{app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(join(profile,'profile'))});app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('http://127.0.0.1:')&&!details.url.startsWith('ws://127.0.0.1:')}));new BrowserWindow({width:1060,height:760,show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}}).loadURL(${JSON.stringify(url)});});`);
  const environment = { ...process.env, NODE_OPTIONS: '' }; delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath, args: [bootstrap], env: environment });
  const page = await app.firstWindow();page.on('pageerror',cause=>errors.push(cause.message));
  await page.locator('.startup-loading').waitFor(); assert.equal(await page.locator('.sidebar-demo').count(),0);
  await page.evaluate(()=>window.releaseAuth()); await page.locator('.live-connected').waitFor();
  const search=page.getByRole('combobox',{name:'搜索项目/用户',exact:true});
  await search.fill('s');await search.press('Enter');assert.ok(await page.locator('.v2-dashboard-intro').isVisible());
  await search.fill('sa'); assert.ok(await page.locator('.v2-dashboard-intro').isVisible());assert.equal(await search.evaluate(el=>el===document.activeElement),true);
  await search.dispatchEvent('compositionstart');await search.press('Enter');assert.ok(await page.locator('.v2-dashboard-intro').isVisible());await search.dispatchEvent('compositionend');
  await search.press('Escape');assert.equal(await search.getAttribute('aria-expanded'),'false');
  await search.press('ArrowUp');assert.ok((await search.getAttribute('aria-activedescendant')).endsWith('-2'));await search.press('Enter');
  await page.getByRole('heading',{name:'用户搜索结果',exact:true}).waitFor();assert.equal(await page.locator('.discover-search input').count(),0);
  await page.waitForFunction(()=>window.reads.some(call=>call.action==='searchUsersPage'));const before=await page.evaluate(()=>window.reads.filter(call=>call.action==='searchUsersPage').length);
  await search.fill('another');await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>window.reads.filter(call=>call.action==='searchUsersPage').length),before,'Editing alone must not request a new search');
  await page.locator('.topbar-search-container').getByRole('button',{name:'清除搜索',exact:true}).click();assert.equal(await search.inputValue(),'');
  await page.locator('.sidebar-nav').getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('button',{name:'查看并发布',exact:true}).click();
  const message=page.getByRole('textbox',{name:'这次改了什么？',exact:true});await message.waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='这次改了什么？');
  assert.equal(await page.evaluate(()=>window.writes.length),0,'Home action must not publish');assert.equal(await page.locator('.local-readme').getAttribute('open'),null);assert.equal(await page.getByRole('heading',{name:'sample',exact:true}).count(),1);
  await page.screenshot({path:join(output,'local-review.png')});
  await page.goto(url+'?mode=offline');await page.locator('.live-offline').waitFor();assert.equal(await page.locator('.sidebar-demo:not(.live-connected)').count(),0);await page.locator('.home-project-row').first().waitFor();
  assert.equal(await page.evaluate(()=>window.reads.filter(call=>call.action==='repos').length),0,'Offline startup must retain cached projects');await page.getByRole('button',{name:'网络修复',exact:true}).click();await page.getByRole('heading',{name:'设置',exact:true}).waitFor();
  await page.goto(url+'?mode=expired');await page.locator('.friendly-error').filter({hasText:'登录或授权已失效'}).waitFor();
  await page.evaluate(()=>localStorage.removeItem('easyhub:welcome-choice'));await page.goto(url+'?mode=demo');await page.getByRole('button',{name:'先看看演示',exact:true}).click();await page.locator('.demo-mode-notice').waitFor();const demoSearch=page.getByRole('combobox');await demoSearch.fill('test');assert.ok(await page.locator('.v2-dashboard-intro').isVisible());await demoSearch.press('ArrowUp');await demoSearch.press('Enter');await page.getByRole('heading',{name:'发现 / 搜索',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.reads.filter(call=>call.action.startsWith('search')).length),0);
  await page.goto(url+'?mode=feedback');await page.getByRole('button',{name:'成功',exact:true}).click();const notice=page.getByRole('status').filter({hasText:'成功提示'});await notice.hover();await page.waitForTimeout(4300);assert.ok(await notice.isVisible());await notice.focus();await page.mouse.move(800,600);await page.waitForTimeout(4300);assert.ok(await notice.isVisible());await page.getByRole('button',{name:'错误',exact:true}).focus();await notice.waitFor({state:'detached',timeout:5000});
  await page.getByRole('button',{name:'错误',exact:true}).click();await page.mouse.move(800,600);await page.waitForTimeout(4300);assert.ok(await page.getByText('错误提示',{exact:true}).isVisible());await page.getByRole('button',{name:'换页',exact:true}).click();assert.equal(await page.getByRole('status').count(),0);
  await page.getByRole('button',{name:'成功',exact:true}).click();await page.getByRole('button',{name:'关闭提示',exact:true}).click();assert.equal(await page.getByRole('status').count(),0);
  assert.deepEqual(errors,[]);await writeFile(join(output,'results.json'),JSON.stringify({passed:true,startup:true,offlineCache:true,expired:true,homeSelection:true,searchRealAndDemo:true,composition:true,keyboard:true,successHoverFocusAndExpiry:true,persistentErrors:true,noRealCredentialsOrWrites:true},null,2));
  process.stdout.write('Startup, offline cache, safe home review, shared search/IME/keyboard and notice lifetime passed in isolated Electron.\n');
} catch (cause) { console.error('Fixture renderer errors:', errors); throw cause; }
finally { await app?.close(); await server.close(); assert.ok(profile.startsWith(join(tmpdir(), 'easyhub-workspace-safety-'))); await rm(profile,{recursive:true,force:true}); }
