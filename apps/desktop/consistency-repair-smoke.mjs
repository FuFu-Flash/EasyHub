import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out/consistency-repair');
await mkdir(output, { recursive: true });
const fixture = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import App from '/src/App.tsx';import{createDemoBridge}from'/src/demo/demoBridge.ts';
import{LanguageContext}from'/src/i18n.ts';import{PageActivityContext}from'/src/components/NavigationPages.tsx';
import{LocalWorkspace}from'/src/LocalWorkspace.tsx';import{AiSettingsPanel}from'/src/components/AiSettingsPanel.tsx';
import{BinaryAnalysisPanel}from'/src/components/BinaryAnalysisPanel.tsx';import{ReleaseEditPanel}from'/src/components/ReleaseEditPanel.tsx';
import{PullRequestsPanel}from'/src/components/PullRequestsPanel.tsx';import{PullReviewGroups}from'/src/components/PullReviewGroups.tsx';
import '/src/styles.css';
const params=new URLSearchParams(location.search),kind=params.get('case')||'offline',language=params.get('language')||'zh';
localStorage.clear();localStorage.setItem('easyhub:language',language);localStorage.setItem('easyhub:welcome-choice','login');
const demo=createDemoBridge(),api=demo.api;window.easyHub=api;window.calls=[];window.fail=false;window.signedIn=false;
const now='2026-10-14T12:00:00Z',repo={id:1,name:'sample',full_name:'owner/sample',private:true,owner:{login:'owner'},permissions:{push:true,admin:true},default_branch:'main',updated_at:now};
const link={id:'local',repositoryId:1,name:'sample',owner:'owner',localPath:'C:/isolated-sample'};
const release={id:1,name:'Release fixture',tag_name:'v1',body:'Description',assets:[],draft:false,prerelease:false,published_at:now};
let pull={id:1,number:1,title:'Review fixture',state:'open',draft:false,body:'Changes to review',created_at:now,user:{login:'contributor'},head:{sha:'a'.repeat(40),ref:'feature'},base:{sha:'b'.repeat(40),ref:'main',repo:{id:1}}};
const originalGithub=api.github;
api.github=async(action,...args)=>{window.calls.push({action,args});
 if(action==='pullRequestsPage'||action==='pullRequests'){if(window.fail)throw Error('Network error');return[{...pull,title:args[1]+' review'}]}
 if(action==='pullRequest')return pull;
 if(action==='pullReviewContext')return{repository:repo,pullRequest:pull,files:[],filesTruncated:false};
 if(action==='pullChecks')return{headSha:pull.head.sha,checkRuns:{state:'available',items:[],nextPage:null},statuses:{state:'available',items:[],nextPage:null}};
 if(action==='rejectPullRequest'){pull={...pull,state:'closed'};return pull}
 if(action==='comments')return[];
 return originalGithub(action,...args);
};
api.authStatus=async()=>{window.calls.push({action:'authStatus'});return window.signedIn?{state:'signed-in',user:demo.user,clientId:'fixture'}:{state:'offline',user:null,clientId:'fixture'}};
api.localList=async()=>[link];api.localStatus=async()=>({files:[],needsReview:false,pendingPublish:false});api.localReadIntroduction=async()=>'';api.localCheckSync=async()=>({state:'current'});
api.editRelease=async()=>{if(window.fail)throw Error('Network error');return release};
api.aiSettings=async()=>({providerId:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-4o-mini',hasApiKey:true});api.aiSaveSettings=async()=>api.aiSettings();
api.binaryAnalysisStatus=async()=>({installed:false,state:'missing'});api.binaryAnalysisInstall=async()=>({installed:true,state:'ready',engineVersion:'Fixture'});
function Groups(){const[counts,setCounts]=useState({});window.publishCounts=()=>setCounts({1:{issues:0,pullRequests:1,closedPullRequests:0},2:{issues:0,pullRequests:2,closedPullRequests:0},3:{issues:0,pullRequests:0,closedPullRequests:0}});return <PullReviewGroups repos={[repo,{...repo,id:2,name:'second'},{...repo,id:3,name:'empty'}]} counts={counts} onOpen={()=>{}} logo={()=>null}/>}
function Notices(){const[active,setActive]=useState(true);return <><button id="page-switch" onClick={()=>setActive(v=>!v)}>Switch page</button><PageActivityContext.Provider value={active}><div hidden={!active} id="tested-panel">{
kind==='local'?<LocalWorkspace mode="list" repos={[repo]} selectedRepo={repo} initialLocalId="local" onBack={()=>{}} onCreated={async()=>{}} onDownloadProject={async()=>{}} downloadBusy={false}/>:
kind==='ai'?<AiSettingsPanel language={language}/>:
kind==='binary'?<BinaryAnalysisPanel language={language}/>:
kind==='release'?<ReleaseEditPanel repo={repo} release={release} onUpdated={()=>{}} onClose={()=>{}}/>:
<PullRequestsPanel repo={repo} currentUser="owner" language={language}/>
}</div></PageActivityContext.Provider></>}
createRoot(document.getElementById('root')).render(<LanguageContext.Provider value={language}>{kind==='offline'?<App/>:<div className="app-shell" data-layout={params.get('density')||'comfortable'}><main className="page-content" style={{gridColumn:'1/-1'}}>{kind==='groups'?<Groups/>:<Notices/>}</main></div>}</LanguageContext.Provider>);
`;
const server = await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'consistency-fixture',
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/consistency-test')) return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(await server.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/@id/virtual:consistency.jsx"></script>'));
  }); },
  resolveId(id) { if (id === 'virtual:consistency.jsx') return '\0' + id; },
  async load(id) { if (id === '\0virtual:consistency.jsx') return (await transformWithEsbuild(fixture, 'consistency.jsx', { loader: 'jsx', jsx: 'automatic' })).code; },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
const results = [];
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/consistency-test`;
  const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const onlyAi = process.argv.includes('--ai-only');
  if (!onlyAi) {
    for (const language of ['zh', 'en']) for (const width of [1440, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${base}?case=offline&language=${language}`);
      await page.locator('.offline-start').waitFor();
      assert.equal(await page.locator('.profile-trigger,.home-shortcuts,.dashboard-intro').count(), 0);
      const heading = await page.getByRole('heading', { level: 1 }).innerText();
      assert.match(heading, language === 'zh' ? /还没有可显示的项目数据/ : /No project data/);
      assert.ok(!/新建项目|New Project/.test(await page.locator('body').innerText()));
      await page.getByRole('button', { name: language === 'zh' ? '网络修复' : 'Network repair', exact: true }).click();
      await page.locator('.github-proxy-panel').waitFor();
      await page.locator('.github-proxy-panel').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(output, `offline-${language}-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: language === 'zh' ? '重试' : 'Retry', exact: true }).click();
      await page.waitForFunction(() => window.calls.filter(c => c.action === 'authStatus').length === 2);
      await page.evaluate(() => { window.signedIn = true; });
      await page.getByRole('button', { name: language === 'zh' ? '重试' : 'Retry', exact: true }).click();
      await page.locator('.sidebar-nav').waitFor();
      results.push({ case: 'offline-no-cache', language, width, retryToRealWorkspace: true });
    }
    await page.goto(`${base}?case=groups`);
    await page.evaluate(() => window.publishCounts());
    const groups = page.locator('.issue-project-group');
    await page.waitForFunction(() => document.querySelectorAll('.issue-project-header[aria-expanded="true"]').length === 2);
    await page.getByRole('button', { name: /sample review/ }).waitFor();
    await page.getByRole('button', { name: /second review/ }).waitFor();
    await groups.nth(0).locator('.issue-project-header').click();
    await page.evaluate(() => window.publishCounts());
    assert.equal(await groups.nth(0).locator('.issue-project-header').getAttribute('aria-expanded'), 'false');
    assert.equal(await groups.nth(1).locator('.issue-project-header').getAttribute('aria-expanded'), 'true');
    results.push({ case: 'groups', asynchronousCounts: true, pendingExpanded: 2, manualCollapseRetained: true });
  }
  for (const kind of onlyAi ? ['ai'] : ['local', 'ai', 'binary', 'release', 'pull']) {
    console.log('Checking timed feedback: ' + kind);
    await page.goto(`${base}?case=${kind}`);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    if (kind === 'local') await page.getByRole('button', { name: '获取最新', exact: true }).click();
    if (kind === 'ai') {
      await page.locator('[aria-controls="ai-settings-details"]').click();
      await page.getByRole('button', { name: '保存授权', exact: true }).click();
      assert.equal(await page.locator('[aria-controls="ai-settings-details"]').getAttribute('aria-expanded'), 'false');
    }
    if (kind === 'binary') await page.getByRole('button', { name: '安装组件', exact: true }).click();
    if (kind === 'release') await page.getByRole('button', { name: '保存发行版介绍', exact: true }).click();
    if (kind === 'pull') {
      await page.getByRole('button', { name: /sample review/ }).click();
      await page.getByRole('button', { name: '拒绝', exact: true }).click();
      await page.getByRole('button', { name: '确认拒绝并关闭', exact: true }).click();
    }
    const notice = page.locator('#tested-panel .feedback-notice');
    try { await notice.waitFor({ state: 'visible' }); }
    catch (error) { await writeFile(join(output, 'notice-failure.txt'), await page.locator('body').innerText()); throw error; }
    await notice.hover(); await page.clock.runFor(4500);
    assert.equal(await notice.count(), 1, `${kind}: hover must pause expiry`);
    await notice.focus(); await page.mouse.move(0, 0); await page.clock.runFor(4500);
    assert.equal(await notice.count(), 1, `${kind}: focus must pause expiry`);
    await page.locator('#page-switch').focus(); await page.clock.runFor(4100);
    await notice.waitFor({ state: 'detached' });
    results.push({ case: 'notice-' + kind, autoDismissed: true, hoverAndFocusPause: true });
    await page.clock.resume();
  }
  if (!onlyAi) {
    await page.goto(`${base}?case=local`);
    const notice = page.locator('#tested-panel .feedback-notice');
    await page.getByRole('button', { name: '获取最新', exact: true }).click();
    await notice.waitFor();
    await notice.getByRole('button', { name: '关闭提示', exact: true }).click();
    assert.equal(await notice.count(), 0, 'The user can dismiss a success immediately');
    await page.getByRole('button', { name: '获取最新', exact: true }).click();
    await notice.waitFor();
    await page.locator('#page-switch').click(); await page.locator('#page-switch').click();
    assert.equal(await notice.count(), 0, 'A retained page must not resurrect an old notice');
    await page.goto(`${base}?case=release`);
    await page.evaluate(() => { window.fail = true; });
    await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 100));
    await page.getByRole('button', { name: '保存发行版介绍', exact: true }).click();
    await page.locator('#tested-panel .live-error').waitFor();
    await page.clock.runFor(9000);
    assert.equal(await page.locator('#tested-panel .live-error').count(), 1, 'Errors remain visible until addressed');
    await page.clock.resume();
    results.push({ case: 'notice-controls', manualClose: true, pageChangeClears: true, errorsDoNotExpire: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ results, errors, isolated: true }, null, 2));
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser?.close(); await server.close(); }
