import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Real workspace components with an isolated account fixture. Never connects to
// GitHub or changes native account, proxy, files, or AI settings.
const desktop = dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2] ?? 'after';
assert.ok(['before', 'cascade', 'after'].includes(phase));
const output = join(desktop, 'out/style-consolidation', phase);
await mkdir(output, { recursive: true });
await writeFile(join(output,'scenarios.json'),JSON.stringify([
  {goal:'Keep primary screens readable',steps:'Home / Projects / Discover / Issues / Pull requests / Settings / project / local',expected:'No new horizontal overflow, clipped group background or displaced window controls'},
  {goal:'Preserve both presentation modes',steps:'Chinese and English; comfortable and compact; 1440 and 1000 CSS px',expected:'Same layout structure; differences limited to the agreed token and breakpoint normalization'},
  {goal:'Detect accidental cascade changes',steps:'Compare screenshots plus each visible element’s computed styles and geometry',expected:'Structural consolidation is pixel-identical; deliberate typography, palette, shape and elevation changes remain reviewable'},
],null,2));
const profile = await mkdtemp(join(tmpdir(), 'easyhub-styles-'));
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import App from'/src/App.tsx';import{createDemoBridge}from'/src/demo/demoBridge.ts';import '/src/tokens.css';import '/src/styles.css';
const data=createDemoBridge();Object.defineProperty(window,'easyHub',{value:Object.freeze({...data.api,authStatus:async()=>({state:'signed-in',user:data.user,clientId:'fixture'})})});createRoot(document.getElementById('root')).render(React.createElement(App));`;
const server = await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'style-review-fixture',
  resolveId(id) { if (id === 'virtual:style-review.jsx') return '\0' + id; },
  load(id) { if (id === '\0virtual:style-review.jsx') return fixture; },
  configureServer(s) { s.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/style-review')) return next();
    res.setHeader('content-type', 'text/html;charset=utf-8');
    res.end(await s.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/@id/virtual:style-review.jsx"></script>'));
  }); },
}], server: { host: '127.0.0.1', port: 0 } });
let app;
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/style-review`;
  const bootstrap = join(profile, 'bootstrap.cjs');
  await writeFile(bootstrap, `const{app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(join(profile,'data'))});app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest((d,c)=>c({cancel:!/^https?:\\/\\/127.0.0.1:|^ws:\\/\\/127.0.0.1:/.test(d.url)}));new BrowserWindow({width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}).loadURL(${JSON.stringify(url)});});`);
  const env = { ...process.env, NODE_OPTIONS: '' }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath, args: [bootstrap], env });
  const page = await app.firstWindow(), errors = [], captures = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForURL(url);
  await page.clock.setFixedTime(new Date('2026-10-15T03:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const nav = name => page.locator('.sidebar-nav').getByRole('button', { name:new RegExp('^'+name+'(?:\\s|$)','i') });
  if(process.argv.includes('--compare-only')) captures.push(...JSON.parse(await readFile(join(output,'result.json'),'utf8')).captures);
  else for (const language of ['zh', 'en']) for (const density of ['comfortable', 'compact']) for (const width of [1440, 1000]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 900), width);
    await page.evaluate(({ language, density }) => { localStorage.clear(); localStorage.setItem('easyhub:language', language); localStorage.setItem('easyhub:layout-preference', density); }, { language, density });
    await page.goto(url); await page.locator('.live-connected').waitFor();
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.demo-workspace').count(), 0);
    if (!captures.length) await writeFile(join(output, 'stylesheet-order.json'), JSON.stringify(await page.locator('style[data-vite-dev-id]').evaluateAll(els => els.map(el => el.getAttribute('data-vite-dev-id'))), null, 2));
    const labels = language === 'zh' ? ['首页','我的项目','发现','问题','合并请求','设置'] : ['Home','My Projects','Discover','Issues','Pull requests','Settings'];
    const capture = async (name) => {
      await page.locator('.live-spin').waitFor({ state: 'hidden' });
      await page.waitForTimeout(100);
      const nameKey = `${language}-${density}-${width}-${name}`;
      const styles = await page.evaluate(() => {
        const props = ['color','backgroundColor','borderTopColor','borderTopLeftRadius','fontSize','fontWeight','padding','margin','gap','boxShadow','display','gridTemplateColumns'];
        return [...document.querySelectorAll('.app-shell *')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height).map(el => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return { tag: el.tagName, cls: typeof el.className === 'string' ? el.className : '', rect: [r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100), ...Object.fromEntries(props.map(p=>[p,s[p]])) };
        });
      });
      const measurement = await page.evaluate(() => { const area=document.querySelector('.main-column'), r=document.querySelector('.windows-window-controls').getBoundingClientRect();return { width:innerWidth,overflow:area.scrollWidth-area.clientWidth,controlsTop:r.top,controlsRight:r.right }; });
      assert.ok(measurement.overflow <= 2 && measurement.controlsTop === 0 && Math.abs(width-measurement.controlsRight) <= 1, nameKey+JSON.stringify(measurement));
      await page.mouse.move(1, 1);
      await page.screenshot({ path:join(output,nameKey+'.png'),scale:'css' });
      await writeFile(join(output,nameKey+'.json'),JSON.stringify(styles));
      captures.push({ name:nameKey,...measurement });
    };
    for (let i=0;i<labels.length;i++) {
      await nav(labels[i]).click();
      if (i===4) { const row=page.locator('.issue-project-header').first();await row.click(); const gap=await row.evaluate(el=>el.parentElement.getBoundingClientRect().width-el.getBoundingClientRect().width); assert.ok(gap<=2); }
      await capture(['home','projects','discover','issues','pulls','settings'][i]);
    }
    await nav(labels[0]).click();
    await page.locator('.home-project-row').filter({hasText:'MyTool'}).getByRole('button',{name:language==='zh'?'打开项目':'Open Project',exact:true}).click();
    await page.locator('.readme-markdown').first().waitFor();
    await capture('project');
    await nav(labels[1]).click(); await nav(labels[1]).click();
    await page.locator('.toolbar .segmented').getByRole('button',{name:language==='zh'?/^这台电脑/:/^This computer/i}).click();
    await page.locator('.project-card').first().getByRole('button',{name:language==='zh'?'打开项目':'Open Project',exact:true}).click();
    await capture('local');
  }
  assert.deepEqual(errors,[]);
  const result={passed:true,captures,errors,scope:'signed-in UI; in-memory fixture; external network blocked; no real-account or paid calls'};
  await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));
  if (phase !== 'before') {
    const before=join(desktop,'out/style-consolidation/before');
    const differences=[];
    for (const {name} of captures) {
      const old=JSON.parse(await readFile(join(before,name+'.json'),'utf8')),now=JSON.parse(await readFile(join(output,name+'.json'),'utf8'));
      const styleChanges={};let geometry=0;
      assert.equal(now.length,old.length,`${name}: visible element count`);
      for(let i=0;i<now.length;i++){assert.equal(now[i].tag,old[i].tag);for(const key of Object.keys(now[i]))if(JSON.stringify(now[i][key])!==JSON.stringify(old[i][key])){if(key==='rect')geometry++;else styleChanges[key]=(styleChanges[key]??0)+1;}}
      for(const key of ['tag','cls','display','gridTemplateColumns','gap']) assert.equal(styleChanges[key]??0,0,`${name}: unexpected structural change to ${key}`);
      const {diffPng,...pixels}=await app.evaluate(({nativeImage},{before,after})=>{
        const a=nativeImage.createFromPath(before),b=nativeImage.createFromPath(after),size=a.getSize();
        if(JSON.stringify(size)!==JSON.stringify(b.getSize()))throw Error('Screenshot dimensions changed');
        const ab=a.toBitmap(),bb=b.toBitmap(),out=Buffer.from(bb);let changed=0,total=0,max=0;
        for(let i=0;i<ab.length;i+=4){let delta=0;for(let c=0;c<3;c++){const d=Math.abs(ab[i+c]-bb[i+c]);total+=d;delta=Math.max(delta,d);}max=Math.max(max,delta);if(delta>12){changed++;out[i]=80;out[i+1]=30;out[i+2]=240;out[i+3]=255;}}
        return{diffPng:nativeImage.createFromBitmap(out,size).toPNG().toString('base64'),changedPercent:changed/(size.width*size.height)*100,meanChannelDifference:total/(size.width*size.height*3),maxChannelDifference:max};
      },{before:join(before,name+'.png'),after:join(output,name+'.png'),diff:join(output,name+'-diff.png')});
      await writeFile(join(output,name+'-diff.png'),Buffer.from(diffPng,'base64'));
      differences.push({name,geometry,styleChanges,...pixels});
      if(phase==='cascade'){assert.equal(geometry,0,`${name}: consolidation must preserve geometry`);assert.deepEqual(styleChanges,{},`${name}: consolidation must preserve computed styles`);assert.equal(pixels.changedPercent,0);}
    }
    await writeFile(join(output,'comparison.json'),JSON.stringify(differences,null,2));
    const cards=differences.map(d=>`<section data-name="${d.name}"><h2>${d.name}</h2><p>Pixels with channel difference &gt;12: ${d.changedPercent.toFixed(2)}%. Mean channel difference: ${d.meanChannelDifference.toFixed(2)}/255.</p><div class="pair"><figure><figcaption>Before</figcaption><img loading="lazy" src="before/${d.name}.png"></figure><figure><figcaption>After</figcaption><img loading="lazy" src="${phase}/${d.name}.png"></figure></div><details><summary>Difference overlay</summary><img loading="lazy" src="${phase}/${d.name}-diff.png"></details></section>`).join('');
    await writeFile(join(desktop,'out/style-consolidation/index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>EasyHub · Style comparison</title><style>body{font:14px/1.5 system-ui;margin:24px;color:#19304b;background:#f5f7fb}header{position:sticky;top:0;padding:16px;background:white;border:1px solid #e3eaf3;border-radius:12px;z-index:1}h1{margin:0;font-size:24px}select{margin-top:12px;padding:8px;max-width:100%;font:inherit}section{margin:20px 0}section[hidden]{display:none}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{max-width:100%;border:1px solid #e3eaf3}figcaption{font-weight:600;margin-bottom:8px}details{margin-top:12px}@media(max-width:850px){.pair{grid-template-columns:1fr}}</style><header><h1>EasyHub · Before / After</h1><p>64 signed-in workspace views, isolated data, external network blocked. Intended changes: type/weight/radius/elevation scales, palette normalization, three viewport boundaries. Structural consolidation was pixel-identical. Pixel percentages are diagnostic, not a visual quality verdict.</p><select aria-label="Choose view">${differences.map(d=>`<option>${d.name}</option>`).join('')}</select></header>${cards}<script>const select=document.querySelector('select');function show(){document.querySelectorAll('section').forEach(el=>el.hidden=el.dataset.name!==select.value)}select.addEventListener('change',show);show()</script></html>`);
    console.log(JSON.stringify({phase,pages:captures.length,meanPixelChange:differences.reduce((a,d)=>a+d.changedPercent,0)/differences.length,maxPixelChange:Math.max(...differences.map(d=>d.changedPercent))}));
  } else console.log(`Saved ${captures.length} baseline screenshots.`);
} catch(error) { await (await app?.firstWindow())?.screenshot({path:join(output,'failure.png')});throw error; }
finally { await app?.close();await server.close();await rm(profile,{recursive:true,force:true}); }
