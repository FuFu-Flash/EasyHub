import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

// Independent experience audit of the signed-in UI. The bridge is a read-only
// in-memory fixture; it is not a real GitHub account or a replacement for live tests.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out/workspace-navigation-review');
await mkdir(output, { recursive: true });
const scenarios = [
  { goal: '新手能逐级回到实际来处', steps: '首页→项目→问题列表→详情→返回', expected: '项目筛选、标题和来处正确，不跳到别的项目' },
  { goal: '开发者切页不丢未发送的回复', steps: '问题填写草稿→设置→问题→连续返回与前进', expected: '草稿和滚动保留，重新取数，不显示迟到的其他页面结果' },
  { goal: '小窗口和英文模式仍可发现入口', steps: '中英×舒适/紧凑×1440/1000，浏览六个一级页面', expected: '无横向溢出、窗口控件漂移和界面漏翻，一级页面无返回按钮' },
];
await writeFile(join(output, 'scenarios.json'), JSON.stringify(scenarios, null, 2));
const profile = await mkdtemp(join(tmpdir(), 'easyhub-workspace-review-'));
const fixture = `import React from'react';import{createRoot}from'react-dom/client';import App from'/src/App.tsx';import{createDemoBridge}from'/src/demo/demoBridge.ts';import{initialProjects,initialIssues}from'/src/data/mock.ts';import '/src/tokens.css';import '/src/styles.css';
window.allowedContent=[...initialProjects.map(p=>p.description),...initialIssues.flatMap(i=>[i.title,i.body,i.author])];window.reviewCalls=[];window.violations=[];
const data=createDemoBridge();const writes=new Set(['createRepo','createIssue','updateIssue','createComment','forkRepo','submitForkContribution','setStarred','setArchived','setVisibility','transferRepo','deleteRepo','mergePull','closePull']);
const bridge={...data.api,authStatus:async()=>({state:'signed-in',user:data.user,clientId:'fixture'}),github:async(action,...args)=>{window.reviewCalls.push({action,args});if(writes.has(action)){window.violations.push(action);throw Error('Write blocked by experience audit')}if(action==='readme'&&window.holdNextReadme){await new Promise(resolve=>(window.reviewHeld??=[]).push(resolve));return '# Cancelled stale content';}return data.api.github(action,...args)}};Object.defineProperty(window,'easyHub',{configurable:false,writable:false,value:Object.freeze(bridge)});createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));`;
const server = await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'workspace-experience-fixture', resolveId(id) { if (id === 'virtual:workspace-review.jsx') return '\0' + id; },
  async load(id) { if (id === '\0virtual:workspace-review.jsx') return (await transformWithEsbuild(fixture, 'fixture.jsx', { loader: 'jsx', jsx: 'automatic' })).code; },
  configureServer(s) { s.middlewares.use(async (req, res, next) => { if (!req.url?.startsWith('/workspace-review')) return next(); res.setHeader('content-type','text/html;charset=utf-8'); res.end(await s.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/@id/virtual:workspace-review.jsx"></script>')); }); },
}], server: { host: '127.0.0.1', port: 0 } });
let app;
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/workspace-review`;
  const bootstrap = join(profile, 'bootstrap.cjs');
  await writeFile(bootstrap, `const{app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(join(profile,'data'))});app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest((d,c)=>c({cancel:!d.url.startsWith('http://127.0.0.1:')&&!d.url.startsWith('ws://127.0.0.1:')}));new BrowserWindow({width:1000,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}).loadURL(${JSON.stringify(url)});});`);
  const env = { ...process.env, NODE_OPTIONS: '' }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath, args: [bootstrap], env });
  const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { localStorage.setItem('easyhub:language','zh'); }); await page.reload(); await page.locator('.live-connected').waitFor();
  assert.equal(await page.locator('.demo-workspace').count(), 0, 'Audit the signed-in workspace UI');
  const nav = label => page.locator('.sidebar-nav').getByRole('button',{name:new RegExp('^'+label,'i')});
  await page.evaluate(()=>window.holdNextReadme=true);
  await page.locator('.home-project-row').filter({hasText:'MyTool'}).locator('.home-project-name').click();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.locator('.detail-hero h1').innerText(),'MyTool');
  await page.evaluate(()=>window.holdNextReadme=false);
  await page.locator('.sidebar-refresh').click(); await page.locator('.readme-markdown').first().waitFor();
  await page.evaluate(()=>window.reviewHeld.forEach(resolve=>resolve())); await page.waitForTimeout(60);
  assert.equal(await page.getByText('Cancelled stale content',{exact:true}).count(),0,'Cancelled read cannot overwrite a later retry');
  await page.locator('.readme-markdown').first().waitFor(); await page.getByRole('button',{name:'查看问题',exact:true}).click();
  await page.locator('.issue-row').first().click(); await page.locator('#live-reply').fill('Unsent developer reply');
  await page.locator('.main-column').evaluate(el=>el.scrollTop=150); const position=await page.locator('.main-column').evaluate(el=>el.scrollTop);
  await nav('设置').click(); await nav('问题').click(); assert.equal(await page.locator('#live-reply').inputValue(),'Unsent developer reply');
  await page.waitForFunction(expected=>Math.abs(document.querySelector('.main-column').scrollTop-expected)<3,position);
  await page.getByRole('button',{name:'返回问题',exact:true}).evaluate(el=>el.click()); await page.getByRole('heading',{name:'设置',exact:true}).waitFor();
  await page.keyboard.press('Alt+ArrowLeft'); await page.locator('#live-reply').waitFor();
  await page.getByRole('button',{name:'返回问题',exact:true}).evaluate(el=>el.click()); await page.locator('.filter-project').waitFor();
  await page.getByRole('button',{name:'返回',exact:true}).evaluate(el=>el.click()); await page.locator('.detail-hero h1').waitFor();
  assert.ok(await page.evaluate(()=>window.reviewCalls.filter(c=>c.action==='readme'&&c.args[1]==='MyTool').length>=2),'A returned page revalidates by its repository parameter');
  await page.getByRole('button',{name:'所有项目',exact:true}).evaluate(el=>el.click()); await page.locator('.home-dashboard').waitFor();
  const layouts=[],leaks=[];
  for(const language of ['zh','en'])for(const density of ['comfortable','compact'])for(const width of [1440,1000]){
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);
    await page.evaluate(({language,density})=>{localStorage.setItem('easyhub:language',language);localStorage.setItem('easyhub:layout-preference',density);},{language,density}); await page.goto(url); await page.locator('.live-connected').waitFor();
    for(const label of language==='en'?['Home','My Projects','Discover','Issues','Pull requests','Settings']:['首页','我的项目','发现','问题','合并请求','设置']){
      await nav(label).click();
      const measurement=await page.evaluate(()=>{const area=document.querySelector('.main-column'),r=document.querySelector('.windows-window-controls').getBoundingClientRect();return{width:innerWidth,overflow:area.scrollWidth-area.clientWidth,controlsTop:r.top,controlsRight:r.right};});
      assert.ok(measurement.overflow<=2&&measurement.controlsTop===0&&Math.abs(measurement.width-measurement.controlsRight)<=1,JSON.stringify(measurement));
      assert.equal(await page.locator('.back-link').count(),0,'Top-level pages do not show Back'); layouts.push({language,density,label,...measurement});
      if(language==='en')leaks.push(...await page.evaluate(()=>{const found=[],allowed=new Set(window.allowedContent),walker=document.createTreeWalker(document.querySelector('.app-shell'),NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const el=node.parentElement,value=node.data.trim();if(el?.getBoundingClientRect().width&&!el.closest('[data-content-original]')&&!allowed.has(value)&&/[\u3400-\u9fff]/u.test(value))found.push(value);}for(const el of document.querySelectorAll('[aria-label],[title],[placeholder]'))if(el.getBoundingClientRect().width&&!el.closest('[data-content-original]'))for(const attr of ['aria-label','title','placeholder']){const value=el.getAttribute(attr)||'';if(!allowed.has(value)&&/[\u3400-\u9fff]/u.test(value))found.push(attr+': '+value);}return found;}));
      await page.screenshot({path:join(output,`${language}-${density}-${width}-${label}.png`)});
    }
  }
  assert.deepEqual(leaks,[]);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.violations),[]);
  await writeFile(join(output,'result.json'),JSON.stringify({passed:true,scenarios,layouts,leaks,errors,mode:'signed-in UI, isolated in-memory bridge fixture',network:'blocked except localhost',githubWrites:0,paidAiCalls:0},null,2));
  console.log('Independent workspace navigation experience review passed.');
}catch(error){const page=await app?.firstWindow();await page?.screenshot({path:join(output,'failure.png')});throw error;}
finally{await app?.close();await server.close();await rm(profile,{recursive:true,force:true});}
