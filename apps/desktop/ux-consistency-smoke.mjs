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
const profile = await mkdtemp(join(tmpdir(), 'easyhub-ux-consistency-'));
const output = join(desktop, 'out/ux-consistency-smoke'); await mkdir(output, { recursive: true });
const fixture = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import App from '/src/App.tsx';import{FeedbackNotice}from'/src/components/FeedbackNotice.tsx';import{useFeedback}from'/src/useFeedback.ts';import '/src/tokens.css';import '/src/styles.css';
const mode=new URLSearchParams(location.search).get('mode')||'online';
const repo={id:1,name:'sample',full_name:'tester/sample',description:'Fixture project',private:false,default_branch:'main',updated_at:'2026-10-14T12:00:00Z',owner:{login:'tester',avatar_url:''},open_issues_count:0};
const link={id:'local-1',repositoryId:1,owner:'tester',name:'sample',localPath:'C:/fixture',lastOpenedAt:''};
const cloud={...repo,id:2,name:'cloud-only',full_name:'tester/cloud-only'};
const user={login:'tester',name:'Test',avatar_url:'',html_url:'https://github.com/tester'};
const preview={files:[{path:'file.txt',kind:'modified'}],needsReview:false,snapshot:'a'.repeat(64)};
window.reads=[];window.writes=[];window.releaseAuth=null;
if(mode==='offline')localStorage.setItem('easyhub:repos:tester',JSON.stringify([repo]));
const api={platform:'win32',authStatus:()=>mode==='online'?new Promise(resolve=>window.releaseAuth=()=>resolve({state:'signed-in',user,clientId:'fixture'})):Promise.resolve({state:mode==='demo'?'signed-out':mode==='expired'?'expired':'offline',user:mode==='offline'?user:null,clientId:'fixture'}),
 authStart:async()=>({userCode:'ABCD-1234',verificationUri:'https://github.com/login/device',expiresAt:Date.now()+60000,interval:60}),authCancel:async()=>{},openExternalLink:async()=>{},
 localList:async()=>[link],localStatus:async()=>preview,localPreviewChanges:async()=>preview,localReadIntroduction:async()=>('# README\\n\\nLong introduction.\\n\\n'.repeat(100)),localPublish:async(...args)=>{window.writes.push(args);return{changed:1}},
 github:async(action,...args)=>{window.reads.push({action,args});if(action==='repos')return[repo,cloud];if(action==='activityCounts')return{1:{issues:2,closedIssues:0,pullRequests:1,closedPullRequests:0},2:{issues:0,closedIssues:0,pullRequests:0,closedPullRequests:0}};if(action==='trending')return{items:[],page:1,hasNextPage:false};if(action==='searchPublicReposPage'||action==='searchUsersPage')return{items:[],totalCount:0,hasNextPage:false};if(action==='issuesPage')return{items:[1,2].map(number=>({id:number,number,title:'Fixture issue '+number,state:'open',body:'Fixture body',created_at:'2026-10-14T12:00:00Z',comments:0,user:{login:'reporter'}})),nextPage:null};if(action==='readme')return'# README';if(action==='repository'||action==='publicRepo')return repo;return[]},
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
  await writeFile(bootstrap, `const{app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(join(profile,'profile'))});app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('http://127.0.0.1:')&&!details.url.startsWith('ws://127.0.0.1:')}));new BrowserWindow({width:1060,height:760,show:true,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}}).loadURL(${JSON.stringify(url)});});`);
  const environment = { ...process.env, NODE_OPTIONS: '' }; delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath, args: [bootstrap], env: environment });
  const page = await app.firstWindow();page.setDefaultTimeout(8000);await page.emulateMedia({reducedMotion:'reduce'});page.on('pageerror',cause=>errors.push(cause.message));
  await page.locator('.startup-loading').waitFor(); assert.equal(await page.locator('.sidebar-demo').count(),0);
  await page.evaluate(()=>window.releaseAuth()); await page.locator('.live-connected').waitFor();

  const sidebar=page.locator('.sidebar-nav');
  const issuesNav=sidebar.getByRole('button',{name:/^问题/}); const pullsNav=sidebar.getByRole('button',{name:/^合并请求/});
  assert.equal(await issuesNav.locator('.nav-count').innerText(),'2');assert.equal(await pullsNav.locator('.nav-count').innerText(),'1');
  assert.equal(await page.locator('.home-publish').count(),0,'Home keeps only the primary task card');
  assert.equal(await page.locator('.topbar-actions').getByRole('button',{name:'设置',exact:true}).count(),0);
  await issuesNav.click();await page.locator('.issue-row').first().waitFor();
  assert.equal(await page.locator('.issue-section-tabs').count(),0);assert.equal(await page.locator('.issue-project-header').first().getAttribute('aria-expanded'),'true');
  const tabs=page.getByRole('tablist',{name:'问题状态'});await tabs.getByRole('tab').first().focus();
  await page.keyboard.press('ArrowRight');assert.equal(await tabs.getByRole('tab').last().getAttribute('aria-selected'),'true');
  await page.keyboard.press('Home');assert.equal(await tabs.getByRole('tab').first().getAttribute('tabindex'),'0');
  await page.keyboard.press('End');await page.keyboard.press('ArrowRight');assert.equal(await tabs.getByRole('tab').first().getAttribute('aria-selected'),'true');
  await pullsNav.click();await page.getByRole('heading',{name:'合并请求审查',exact:true}).waitFor();assert.equal(await page.locator('main > .v2-page-transition > .back-link').count(),0);
  await sidebar.getByRole('button',{name:'我的项目',exact:true}).click();await page.getByRole('button',{name:/我的云端项目/}).click();
  const linked=page.locator('.cloud-row').filter({hasText:'Fixture project'}).filter({hasText:'sample'});
  assert.ok(await linked.getByRole('button',{name:'打开',exact:true}).isVisible());assert.equal(await linked.getByRole('button',{name:'下载',exact:true}).count(),0);
  assert.ok(await page.locator('.cloud-row').filter({hasText:'cloud-only'}).getByRole('button',{name:'下载',exact:true}).isVisible());
  assert.equal(await page.getByRole('button',{name:'所有公开项目',exact:true}).count(),0);
  await linked.getByRole('button',{name:'打开',exact:true}).click();await page.locator('.local-project-card').waitFor();
  await page.keyboard.press('Alt+ArrowLeft');await page.locator('.cloud-row').first().waitFor();
  await page.keyboard.press('Alt+ArrowRight');await page.locator('.local-project-card').waitFor();
  await page.evaluate(()=>window.dispatchEvent(new MouseEvent('mouseup',{button:3,bubbles:true})));await page.locator('.cloud-row').first().waitFor();
  await page.waitForTimeout(120);await page.evaluate(()=>window.dispatchEvent(new MouseEvent('mouseup',{button:4,bubbles:true})));await page.locator('.local-project-card').waitFor();
  await sidebar.getByRole('button',{name:'首页',exact:true}).click();
  const bell=page.getByRole('button',{name:'通知',exact:true});assert.equal(await bell.locator('.download-notification-count').innerText(),'2');
  await bell.click();assert.equal(await page.locator('.download-notification-count').count(),0);
  assert.deepEqual(await page.locator('.notification-section-label').allTextContents(),['问题','合并请求']);await page.getByRole('button',{name:'关闭通知',exact:true}).click();
  const results=[];
  for(const width of [1440,1000]){
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,900),width);
    for(const label of ['首页','我的项目','发现','问题','合并请求','设置']){
      await sidebar.getByRole('button',{name:new RegExp('^'+label)}).click();await page.waitForTimeout(180);
      const layout=await page.evaluate(()=>{
        const area=document.querySelector('.main-column'),controls=document.querySelector('.windows-window-controls');
        const rect=controls.getBoundingClientRect();const tiny=[...document.querySelectorAll('main *,header *,aside *')].filter(el=>el.offsetWidth&&el.offsetHeight&&el.childNodes.length&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(el).fontSize)<12).map(el=>({text:el.textContent.slice(0,60),font:getComputedStyle(el).fontSize}));
        return {width:innerWidth,overflow:area.scrollWidth-area.clientWidth,controlsRight:rect.right,controlsTop:rect.top,tiny};
      });assert.ok(layout.overflow<=2,`${label} ${width}: horizontal overflow ${layout.overflow}`);assert.ok(Math.abs(layout.width-layout.controlsRight)<=1,`Window controls drift at ${width}`);assert.equal(layout.controlsTop,0);assert.deepEqual(layout.tiny,[],`Small text on ${label}: ${JSON.stringify(layout.tiny)}`);
      await page.screenshot({animations:'disabled',timeout:10000,path:join(output,`zh-${width}-${label}.png`)});results.push({width,label,layout});
    }
  }
  await page.evaluate(()=>localStorage.setItem('easyhub:language','en'));await page.reload();await page.evaluate(()=>window.releaseAuth());await page.locator('.live-connected').waitFor();
  const englishNav=page.locator('.sidebar-nav');
  const untranslated=[];
  for(const label of ['Home','My Projects','Discover','Issues','Pull requests','Settings']){
    await englishNav.getByRole('button',{name:new RegExp('^'+label,'i')}).click();await page.waitForTimeout(220);
    const leaks=await page.evaluate(()=>{
      const leaks=[];const walker=document.createTreeWalker(document.getElementById('root'),NodeFilter.SHOW_TEXT);let n;
      while((n=walker.nextNode())){const el=n.parentElement;if(el?.closest('[data-content-original]')||!el?.getBoundingClientRect().width)continue;if(/[\u3400-\u9fff]/u.test(n.textContent))leaks.push(n.textContent.trim());}
      for(const el of document.querySelectorAll('[aria-label],[title],[placeholder]')){if(!el.getBoundingClientRect().width)continue;for(const attr of ['aria-label','title','placeholder']){const text=el.getAttribute(attr);if(text&&/[\u3400-\u9fff]/u.test(text))leaks.push(`${attr}: ${text}`);}}
      return leaks;
    });untranslated.push(...leaks.map(text=>({label,text})));await page.screenshot({animations:'disabled',timeout:10000,path:join(output,`en-1000-${label}.png`)});
  }
  await page.locator('.language-trigger').click();
  assert.ok(await page.getByRole('button',{name:'中文',exact:true}).isVisible());
  // Each language is listed under its own name, so a reader can always find their way back.
  assert.ok(await page.getByRole('button',{name:'English',exact:true}).isVisible());
  await page.getByRole('button',{name:'English',exact:true}).click();
  assert.equal(await page.locator('.window-style-option').first().locator('small').innerText(),'Top-right buttons');
  await writeFile(join(output,'language-leaks.json'),JSON.stringify(untranslated,null,2));assert.deepEqual(untranslated,[],'Untranslated interface text');
  await page.evaluate(()=>{window.easyHub.authLogout=async()=>{throw new Error('EPERM: fixture credential store locked')}});
  await page.getByRole('button',{name:/^Sign out$/i}).click();await page.locator('.live-error .friendly-error').waitFor();
  assert.ok(await page.getByRole('button',{name:'View details',exact:true}).isVisible());assert.ok(await page.locator('.live-shell').isVisible());
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('easyhub:language','zh')});await page.goto(url+'?mode=demo');
  await page.getByRole('heading',{name:'欢迎使用 EasyHub',exact:true}).waitFor();await page.getByRole('button',{name:'登录 GitHub',exact:true}).click();await page.locator('.oauth-code').waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'先看看演示',exact:true}).click();await page.locator('.demo-mode-notice').waitFor();assert.equal(await page.locator('.sidebar-demo').count(),0);
  assert.ok(await page.locator('.demo-mode-notice').getByRole('button',{name:'登录 GitHub',exact:true}).isVisible());await page.reload();await page.locator('.demo-mode-notice').waitFor();assert.equal(await page.locator('.welcome-page').count(),0);
  await page.locator('.sidebar-nav').getByRole('button',{name:/^问题/}).click();assert.equal(await page.locator('.issue-project-header[aria-expanded=true]').count()>0,true);
  await page.getByRole('tablist',{name:'问题状态'}).getByRole('tab').first().focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tablist',{name:'问题状态'}).getByRole('tab').last().getAttribute('aria-selected'),'true');
  assert.deepEqual(errors,[]);await writeFile(join(output,'results.json'),JSON.stringify({passed:true,onboarding:true,demoRemembered:true,independentPulls:true,keyboardTabs:true,cloudLinkActions:true,historyShortcuts:true,mouseSideButtons:true,unreadNotifications:true,layouts:results,englishLeaks:0},null,2));
  process.stdout.write('Desktop UX consistency: welcome, navigation, counts, cloud links, tabs, 1440/1000 layout and English UI passed.\n');
} catch (cause) { console.error('Fixture renderer errors:', errors); throw cause; }
finally { await app?.close(); await server.close(); assert.ok(profile.startsWith(join(tmpdir(), 'easyhub-ux-consistency-'))); await rm(profile,{recursive:true,force:true}); }
