import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

const desktop=dirname(fileURLToPath(import.meta.url)),output=join(desktop,'out/new-project-layout');
const scenario=process.argv[2]??'all';
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'easyhub-create-review-'));
const fixture=`import React from'react';import{createRoot}from'react-dom/client';import App from'/src/App.tsx';import{DemoWorkspace}from'/src/DemoWorkspace.tsx';import{createDemoBridge}from'/src/demo/demoBridge.ts';import'/src/styles.css';
const data=createDemoBridge();window.calls=[];window.failCreate=false;window.holdCreate=false;window.folderPath=null;window.data=data;
const bridge={...data.api,authStatus:async()=>({state:'signed-in',user:data.user,clientId:'fixture'}),chooseFolder:async()=>{window.calls.push({method:'chooseFolder'});return window.folderPath?data.api.chooseFolder():null;},localStatus:async(id)=>{if(id=== (await data.api.localList())[1]?.id)throw Error('[NOT_FOUND] Folder moved');return data.api.localStatus(id);},localCreate:async(...args)=>{window.calls.push({method:'localCreate',args});return data.api.localCreate(...args);},localPublish:async(...args)=>{window.calls.push({method:'localPublish',args});return data.api.localPublish(...args);},github:async(action,...args)=>{window.calls.push({method:action,args});if(action==='createRepo'){if(window.failCreate)throw Error('[NETWORK] Fixture offline');if(window.holdCreate)await new Promise(resolve=>window.finishCreate=resolve);}return data.api.github(action,...args);}};Object.defineProperty(window,'easyHub',{value:Object.freeze(bridge)});createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).get('mode')==='demo'?<DemoWorkspace demoOnly onLogin={()=>{}}/>:<App/>);`;
const server=await createServer({configFile:false,root:join(desktop,'src/renderer'),plugins:[react(),{
  name:'new-project-review',resolveId(id){if(id==='virtual:new-project.jsx')return'\0'+id;},async load(id){if(id==='\0virtual:new-project.jsx')return(await transformWithEsbuild(fixture,'fixture.jsx',{loader:'jsx',jsx:'automatic'})).code;},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/new-project-review'))return next();res.setHeader('content-type','text/html;charset=utf-8');res.end(await s.transformIndexHtml(req.url,'<div id="root"></div><script type="module" src="/@id/virtual:new-project.jsx"></script>'));});},
}],server:{host:'127.0.0.1',port:0}});
let app;
try{
  await server.listen();const url=`http://127.0.0.1:${server.httpServer.address().port}/new-project-review`;
  const bootstrap=join(profile,'bootstrap.cjs');
  await writeFile(bootstrap,`const{app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(join(profile,'data'))});app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest((d,c)=>c({cancel:!/^https?:\\/\\/127.0.0.1:|^ws:\\/\\/127.0.0.1:/.test(d.url)}));new BrowserWindow({width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}).loadURL(${JSON.stringify(url)});});`);
  const env={...process.env,NODE_OPTIONS:''};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:electronPath,args:[bootstrap],env});const page=await app.firstWindow(),errors=[],layouts=[];
  page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await page.waitForURL(url);await page.emulateMedia({reducedMotion:'reduce'});
  const nav=label=>page.locator('.sidebar-nav').getByRole('button',{name:new RegExp('^'+label,'i')});
  const openNew=async(language='zh')=>{await nav(language==='zh'?'首页':'Home').click();await page.getByRole('button',{name:language==='zh'?'新建项目':'New Project',exact:true}).click();await page.locator('.live-create-form').waitFor();};
  const reset=async(language='zh',density='comfortable',mode='real')=>{await page.evaluate(({language,density})=>{localStorage.clear();localStorage.setItem('easyhub:language',language);localStorage.setItem('easyhub:layout-preference',density);},{language,density});await page.goto(url+'?mode='+mode);await page.locator('.sidebar-nav').waitFor();};
  await reset();await openNew();
  if(scenario==='all'||scenario==='cards'){
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.local-project-card').count(),0,'New project must not display existing local project cards or missing-folder warnings');
  }
  if(scenario==='all'||scenario==='folder'){
    const form=page.locator('.live-create-form');await form.getByRole('textbox',{name:'项目名称',exact:true}).fill('cloud-only-project');await form.getByRole('textbox',{name:'一句介绍',exact:true}).fill('Cloud project without local folder');
    assert.equal(await form.getByRole('button',{name:'创建项目',exact:true}).isEnabled(),true,'Creating a cloud project must not require a folder');
  }
  if(scenario==='all'||scenario==='layout'){
    for(const mode of ['real','demo'])for(const language of ['zh','en'])for(const density of ['comfortable','compact'])for(const width of [1440,1000]){
      await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setContentSize(w,900),width);await reset(language,density,mode);
      for(const screen of ['settings','create']){
        if(screen==='settings')await nav(language==='zh'?'设置':'Settings').click();else await openNew(language);
        const locator=page.locator(screen==='settings'?'.settings-stack':'.live-create-form');
        const measurement=await locator.evaluate(el=>{const content=document.querySelector('.page-content'),main=document.querySelector('.main-column'),r=el.getBoundingClientRect(),c=content.getBoundingClientRect(),s=getComputedStyle(content),controls=document.querySelector('.windows-window-controls').getBoundingClientRect();return{contentWidth:c.width,usable:c.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),width:r.width,internalUnused:c.right-parseFloat(s.paddingRight)-r.right,left:r.left-c.left,right:main.getBoundingClientRect().right-r.right,overflow:main.scrollWidth-main.clientWidth,controlsTop:controls.top,controlsRight:controls.right,viewport:innerWidth};});
        assert.ok(measurement.internalUnused<=2,`${screen} must fill the available page width: ${JSON.stringify(measurement)}`);
        assert.ok(Math.abs(measurement.left-measurement.right)<=4,`${screen} should have balanced outer gutters: ${JSON.stringify(measurement)}`);
        assert.ok(measurement.overflow<=2&&measurement.controlsTop===0&&Math.abs(width-measurement.controlsRight)<=1);
        assert.equal(await page.locator('.local-project-card').count(),0);
        if(language==='en'){
          const leaks=await page.evaluate(()=>{const leaks=[],root=document.querySelector('.app-shell'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const el=node.parentElement;if(el?.getBoundingClientRect().width&&!el.closest('[data-content-original]')&&/[\u3400-\u9fff]/u.test(node.data))leaks.push(node.data.trim());}for(const el of root.querySelectorAll('[title],[aria-label],[placeholder]'))if(el.getBoundingClientRect().width)for(const attr of ['title','aria-label','placeholder']){const value=el.getAttribute(attr)||'';if(/[\u3400-\u9fff]/u.test(value))leaks.push(attr+': '+value);}return leaks;});assert.deepEqual(leaks,[],'English creation and settings UI, including attributes, must not contain Chinese');
        }
        layouts.push({mode,language,density,width,screen,...measurement});await page.screenshot({path:join(output,`${mode}-${language}-${density}-${width}-${screen}.png`),scale:'css'});
      }
    }
  }
  if(scenario==='all'||scenario==='workflows'){
    await reset();await openNew();const form=page.locator('.live-create-form'),name=form.getByRole('textbox',{name:'项目名称',exact:true}),description=form.getByRole('textbox',{name:'一句介绍',exact:true}),submit=form.getByRole('button',{name:'创建项目',exact:true});
    await name.fill('cloud-only-project');await description.fill('Retain this description after failure');await page.evaluate(()=>window.failCreate=true);await submit.click();await page.locator('.local-workspace .live-error').waitFor();assert.equal(await name.inputValue(),'cloud-only-project');assert.equal(await description.inputValue(),'Retain this description after failure');
    await page.evaluate(()=>{window.failCreate=false;window.holdCreate=true;});await submit.click();await page.waitForFunction(()=>typeof window.finishCreate==='function');assert.equal(await submit.isDisabled(),true);await page.evaluate(()=>window.finishCreate());await page.locator('.detail-hero h1').waitFor();assert.equal(await page.locator('.detail-hero h1').innerText(),'cloud-only-project');
    const calls=await page.evaluate(()=>window.calls);assert.equal(calls.filter(c=>c.method==='createRepo').length,2);assert.equal(calls.filter(c=>c.method==='createRepo').at(-1).args[2],true,'Cloud projects default to private');assert.equal(calls.filter(c=>['chooseFolder','localCreate','localPublish'].includes(c.method)).length,0,'Cloud creation cannot pick or publish local files');assert.equal(await page.evaluate(()=>window.data.api.localList().then(links=>links.length)),3);
    await openNew();await page.evaluate(()=>{window.holdCreate=false;window.folderPath='selected';});await form.getByRole('button',{name:'选择文件夹',exact:true}).click();await form.getByRole('button',{name:'取消选择文件夹',exact:true}).click();await name.fill('public-cloud-project');await description.fill('A public project with no local folder');await form.getByRole('button',{name:/所有人/}).click();await submit.click();await page.locator('.detail-hero h1').waitFor();assert.equal(await page.locator('.detail-hero h1').innerText(),'public-cloud-project');const publicCall=await page.evaluate(()=>window.calls.filter(c=>c.method==='createRepo').at(-1));assert.equal(publicCall.args[2],false);assert.equal(await page.evaluate(()=>window.data.api.localList().then(links=>links.length)),3,'Clearing a chosen folder still creates only a cloud project');await page.evaluate(()=>window.folderPath=null);
    await openNew();await form.getByRole('button',{name:'选择文件夹',exact:true}).click();assert.equal(await name.inputValue(),'');await name.fill('local-project-fixture');await page.evaluate(()=>window.folderPath='C:\\Fixtures\\local-project-fixture');await form.getByRole('button',{name:'选择文件夹',exact:true}).click();await submit.click();await page.locator('.local-project-card').waitFor();assert.equal(await page.locator('.local-project-card').count(),1);await page.getByRole('textbox',{name:'这次改了什么？',exact:true}).waitFor();assert.equal((await page.evaluate(()=>window.calls)).filter(c=>c.method==='localPublish').length,0,'Folder creation still requires explicit file selection before publishing');
    await openNew();assert.equal(await page.locator('.local-project-card').count(),0,'A second new-project visit cannot show the previously created local project');assert.equal(await name.inputValue(),'');assert.equal(await form.getByRole('button',{name:/只有我/}).getAttribute('aria-pressed'),'true');
    await name.fill('unsent-project-draft');await description.fill('Keep this while visiting settings');await nav('设置').click();await nav('我的项目').click();assert.equal(await name.inputValue(),'unsent-project-draft');assert.equal(await description.inputValue(),'Keep this while visiting settings');await form.getByRole('button',{name:'选择文件夹',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await form.getByRole('button',{name:/只有我/}).evaluate(el=>el===document.activeElement),true,'Creation fields remain keyboard reachable');
    await reset('en','compact','demo');await openNew('en');await page.locator('.live-create-form').getByRole('textbox',{name:'Project Name',exact:true}).fill('demo-cloud-project');await page.locator('.live-create-form').getByRole('button',{name:'Create Project',exact:true}).click();await page.locator('.detail-hero h1').waitFor();assert.equal(await page.locator('.detail-hero h1').innerText(),'demo-cloud-project');
  }
  assert.deepEqual(errors,[]);await writeFile(join(output,scenario+'-result.json'),JSON.stringify({passed:true,scenario,layouts,errors,scope:'real workspace with isolated memory bridge; demo separately; external network blocked; no real-account writes'},null,2));console.log(`New project ${scenario} passed (${layouts.length} layout states).`);
}catch(error){await(await app?.firstWindow())?.screenshot({path:join(output,scenario+'-failure.png'),scale:'css'});throw error;}
finally{await app?.close();await server.close();await rm(profile,{recursive:true,force:true});}
