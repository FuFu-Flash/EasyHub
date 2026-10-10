import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = dirname(fileURLToPath(import.meta.url));
// Production public/PR components with isolated IPC fixtures; no remote write/network.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PublicProjectBrowser} from '/src/components/PublicProjectBrowser.tsx';
import {PullRequestsPanel} from '/src/components/PullRequestsPanel.tsx';
import {LiveWorkspace} from '/src/LiveWorkspace.tsx';
import {createDomLocalizer} from '/src/i18n.ts';
import '/src/styles.css'; import '/src/v2.css';
const now='2026-10-08T00:00:00Z';
const repo={id:1,name:'sample',full_name:'author/sample',private:false,default_branch:'main',owner:{login:'author'},permissions:{pull:true},updated_at:now};
const otherRepo={...repo,id:2,name:'another-project',full_name:'author/another-project'};
const issue=n=>({id:n,number:n,title:'Discussion '+n,body:'Body '+n,state:'open',created_at:now,user:{login:'contributor'},comments:125});
const pull={...issue(3),title:'Change request',head:{sha:'a'.repeat(40),ref:'fix',label:'contributor:fix'},base:{ref:'main',sha:'b'.repeat(40)}};
const comment=n=>({id:n,body:'Reply '+n,created_at:now,user:{login:'reader'}});
const commit=n=>({sha:String(n).padStart(40,'0'),commit:{message:'Version '+n,author:{name:'reader',date:now}}});
window.reads=[];window.failMore=false;window.holdMore=false;window.releaseMore=null;window.sent=[];
window.easyHub={platform:${JSON.stringify(process.platform)},onAiReviewProgress:()=>()=>{},onReleaseProgress:()=>()=>{},onLocalStatus:()=>()=>{},onLocalProgress:()=>()=>{},onArchiveProgress:()=>()=>{},onDownloadsChanged:()=>()=>{},downloadsList:async()=>[],localList:async()=>[],openExternalLink:async()=>{},github:async(action,...args)=>{
 window.reads.push({action,args});
 if(action==='readme')return '# Project';
 if(action==='repos')return args[0]===1?[repo,otherRepo]:[];
 if(action==='isStarred')return false;
 if(action==='activityCounts')return {1:{issues:2,pullRequests:1,closedIssues:0,closedPullRequests:0},2:{issues:2,pullRequests:0,closedIssues:0,closedPullRequests:0}};
 if(action==='issuesPage')return {items:[issue(1),issue(2)],nextPage:null};
 if(action==='comments')return Array.from({length:100},(_,i)=>comment(i+1));
 if(action==='commentsPage'){
   if(window.failMore){window.failMore=false;throw Error('simulated retry');}
   if(window.holdMore)await new Promise(resolve=>{window.releaseMore=resolve});
   return {items:[comment(100),...Array.from({length:25},(_,i)=>comment(i+101))],nextPage:null};
 }
 if(action==='commits')return Array.from({length:100},(_,i)=>commit(i+1));
 if(action==='commitsPage')return {items:[commit(101)],nextPage:null};
 if(action==='searchDiscussions')return {items:[issue(200)],page:1,totalCount:1,hasNextPage:false,incompleteResults:false};
 if(action==='pullRequests'||action==='pullRequestsPage')return [pull];
 if(action==='pullRequest')return pull;
 if(action==='pullChecks')return {headSha:args[3].headSha,checkRuns:{state:'available',items:[],nextPage:null},statuses:{state:'available',items:[],nextPage:null}};
 if(action==='pullReviewContext')return {repository:repo,pullRequest:pull,files:[],filesTruncated:false};
 if(action==='createComment'){window.sent.push(args);return comment(126);}
 throw Error('Unexpected fixture action '+action);
}};
const params=new URLSearchParams(location.search);window.fixtureUser=params.get('account')||'reader';window.fixtureRepo=repo;
const root=createRoot(document.getElementById('root'));
window.localizeFixture=()=>createDomLocalizer().apply(document.getElementById('root'),'en');
window.renderFixture=()=>{const currentUser=window.fixtureUser;const selectedRepo=window.fixtureRepo;root.render(params.has('own')?React.createElement(LiveWorkspace,{user:{id:10,login:currentUser,name:currentUser,avatar_url:''},onLogout:()=>{}}):params.has('pull')?React.createElement(PullRequestsPanel,{repo:selectedRepo,currentUser,language:'zh'}):React.createElement(PublicProjectBrowser,{repo:selectedRepo,currentUser,language:'zh',onBack:()=>{},onOpenLink:()=>{},onDownload:()=>{},onForkReady:()=>{},downloadBusy:false}));};
window.changeFixtureRepo=()=>{window.fixtureRepo=otherRepo;window.renderFixture();};window.renderFixture();
`;
const server = await createServer({ configFile: false, root: join(root, 'src/renderer'), plugins: [react(), {
  name: 'discussion-pagination-fixture',
  configureServer(server) { server.middlewares.use(async (request, response, next) => { if (!request.url.startsWith('/discussion-test')) return next(); response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(await server.transformIndexHtml(request.url, '<div id="root"></div><script type="module" src="/@id/virtual:pagination.jsx"></script>')); }); },
  resolveId(id) { if (id === 'virtual:pagination.jsx') return '\0' + id; }, load(id) { if (id === '\0virtual:pagination.jsx') return fixture; },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen(); const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/discussion-test`;
  const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  const openIssues = async () => { await page.locator('.public-browser-tabs').getByRole('button', { name: /^问题/ }).click(); };
  const openIssue = async number => { await page.locator('.public-list-row').filter({ hasText: `Discussion ${number}` }).click(); await page.locator('#public-issue-reply').waitFor(); await page.getByRole('button', { name: '加载更多回复', exact: true }).waitFor(); };
  await page.goto(url); await openIssues(); await openIssue(1);
  assert.equal(await page.locator('.conversation > .message').count(), 101);
  await page.evaluate(() => { window.failMore = true; });
  await page.getByRole('button', { name: '加载更多回复', exact: true }).click();
  await page.locator('.discussion-pagination [role=alert]').waitFor();
  assert.equal(await page.locator('.conversation > .message').count(), 101);
  await page.locator('.discussion-pagination').getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText('Reply 125', { exact: true }).waitFor();
  assert.equal(await page.locator('.conversation > .message').count(), 126, 'Duplicate boundary comment must be deduplicated');
  assert.equal(await page.locator('.discussion-pagination').count(), 0);
  await page.locator('#public-issue-reply').fill('Persistent public draft');
  await page.getByRole('button', { name: '返回问题', exact: true }).click(); await openIssue(2);
  assert.equal(await page.locator('#public-issue-reply').inputValue(), '');
  await page.reload(); await openIssues(); await openIssue(1);
  assert.equal(await page.locator('#public-issue-reply').inputValue(), 'Persistent public draft');
  await page.getByRole('button', { name: '发送回复', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#public-issue-reply').value === '');
  assert.equal(await page.evaluate(() => window.sent.length), 1);
  await page.reload(); await openIssues(); await openIssue(1); assert.equal(await page.locator('#public-issue-reply').inputValue(), '');
  // Ignore a late second page once a different discussion is open.
  await page.evaluate(() => { window.holdMore = true; });
  await page.getByRole('button', { name: '加载更多回复', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.releaseMore));
  await page.getByRole('button', { name: '返回问题', exact: true }).click(); await openIssue(2);
  await page.evaluate(() => window.releaseMore()); await page.waitForTimeout(100);
  assert.equal(await page.getByText('Reply 125', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '返回问题', exact: true }).click();
  assert.equal(await page.locator('.discussion-search input').count(), 0, 'Discussion search starts as an icon');
  await page.getByRole('button', { name: '搜索讨论', exact: true }).click();
  assert.equal(await page.locator('.discussion-search input').evaluate(element => document.activeElement === element), true, 'Expanded search takes keyboard focus');
  await page.locator('.discussion-search input').fill('#200'); await page.locator('.discussion-search').getByRole('button', { name: '搜索', exact: true }).click();
  await page.locator('.discussion-search .public-list-row').filter({ hasText: 'Discussion 200' }).waitFor();
  assert.equal(await page.evaluate(() => window.reads.filter(read => read.action === 'searchDiscussions').at(-1).args[2].kind), 'issue');
  await page.locator('.discussion-search input').fill('#200 draft');
  await page.locator('.discussion-search .public-list-row').click(); await page.locator('#public-issue-reply').waitFor();
  await page.getByRole('button', { name: '返回问题', exact: true }).click();
  await page.locator('.discussion-search .public-list-row').waitFor();
  assert.equal(await page.locator('.discussion-search input').inputValue(), '#200 draft', 'Returning must retain unsent input as well as the submitted query');
  assert.equal(await page.evaluate(() => window.reads.filter(read => read.action === 'searchDiscussions').at(-1).args[2].query), '#200');
  await page.locator('.discussion-search input').press('Escape');
  assert.equal(await page.locator('.discussion-search input').count(), 0);
  await page.getByRole('button', { name: /Discussion 1/ }).waitFor();
  // Closing search restores its trigger on the next native animation frame.
  // Wait for that actual focus change instead of racing the synchronous DOM update.
  await page.waitForFunction(() => document.activeElement === document.querySelector('.discussion-search-toggle'));
  assert.equal(await page.getByRole('button', { name: '搜索讨论', exact: true }).evaluate(element => document.activeElement === element), true, 'Closing search returns focus and restores the original list');
  await page.locator('.public-browser-tabs').getByRole('button', { name: '历史版本', exact: true }).click();
  assert.equal(await page.locator('.public-list-row').count(), 100);
  await page.locator('.discussion-pagination button').click(); await page.getByText('Version 101', { exact: true }).waitFor();
  assert.equal(await page.locator('.public-list-row').count(), 101);
  // Shared PR discussion also supports paging, drafts and remote search.
  await page.goto(url + '?pull=1'); await page.getByRole('button', { name: /Change request/ }).click();
  await page.getByRole('button', { name: '加载更多回复', exact: true }).click(); await page.getByText('Reply 125', { exact: true }).waitFor();
  await page.locator('#pull-reply').fill('Persistent PR reply'); await page.reload(); await page.getByRole('button', { name: /Change request/ }).click();
  assert.equal(await page.locator('#pull-reply').inputValue(), 'Persistent PR reply');
  await page.goto(url + '?pull=1&account=different-reader'); await page.getByRole('button', { name: /Change request/ }).click();
  assert.equal(await page.locator('#pull-reply').inputValue(), '', 'Another account must not inherit the reply draft');
  await page.getByRole('button', { name: '返回合并请求审查', exact: true }).click();
  await page.getByRole('button', { name: '搜索讨论', exact: true }).click();
  await page.locator('.discussion-search input').fill('proposal'); await page.locator('.discussion-search').getByRole('button', { name: '搜索', exact: true }).click();
  await page.locator('.discussion-search .public-list-row').waitFor();
  assert.equal(await page.evaluate(() => window.reads.filter(read => read.action === 'searchDiscussions').at(-1).args[2].kind), 'pr');
  await page.locator('.discussion-search .public-list-row').click(); await page.locator('#pull-reply').waitFor();
  await page.getByRole('button', { name: '返回合并请求审查', exact: true }).click();
  await page.locator('.discussion-search .public-list-row').waitFor();
  assert.equal(await page.locator('.discussion-search input').inputValue(), 'proposal');
  await page.getByRole('button', { name: '收起搜索', exact: true }).click();
  assert.equal(await page.locator('.discussion-search input').count(), 0);
  await page.getByRole('button', { name: /Change request/ }).waitFor();
  // Scope changes are tested without a renderer reload, so local component state
  // cannot accidentally make another account/project inherit the previous search.
  for (const mode of ['', '?pull=1']) {
    await page.goto(url + mode); if (!mode) await openIssues();
    await page.getByRole('button', { name: '搜索讨论', exact: true }).click();
    await page.locator('.discussion-search input').fill('private search');
    await page.locator('.discussion-search').getByRole('button', { name: '搜索', exact: true }).click();
    await page.locator('.discussion-search .public-list-row').waitFor();
    await page.evaluate(() => { window.fixtureUser = 'new-account'; window.renderFixture(); });
    if (!mode) { await page.locator('.public-browser-tabs > button.selected').filter({ hasText: '项目介绍' }).waitFor(); await openIssues(); }
    await page.getByRole('button', { name: '搜索讨论', exact: true }).waitFor();
    assert.equal(await page.locator('.discussion-search input').count(), 0);
    await page.getByRole('button', { name: '搜索讨论', exact: true }).click();
    await page.locator('.discussion-search input').fill('project-specific');
    await page.evaluate(() => window.changeFixtureRepo());
    if (!mode) { await page.locator('.public-browser-tabs > button.selected').filter({ hasText: '项目介绍' }).waitFor(); await openIssues(); }
    await page.getByRole('button', { name: '搜索讨论', exact: true }).waitFor();
    assert.equal(await page.locator('.discussion-search input').count(), 0);
  }
  await page.goto(url + '?own=1');
  await page.locator('.sidebar-nav').getByRole('button', { name: /^问题/ }).click();
  await page.getByRole('button', { name: '搜索讨论', exact: true }).click();
  await page.getByRole('combobox', { name: '搜索项目', exact: true }).selectOption('2');
  await page.locator('.discussion-search input').fill('#200');
  await page.locator('.discussion-search').getByRole('button', { name: '搜索', exact: true }).click();
  await page.locator('.discussion-search .public-list-row').click(); await page.locator('#live-reply').waitFor();
  await page.getByRole('button', { name: '返回问题', exact: true }).click();
  await page.locator('.discussion-search .public-list-row').waitFor();
  assert.equal(await page.locator('.discussion-search input').inputValue(), '#200');
  assert.equal(await page.getByRole('combobox', { name: '搜索项目', exact: true }).inputValue(), '2', 'Returning to all projects must retain the project selected in the search');
  assert.equal(await page.evaluate(() => window.reads.filter(read => read.action === 'searchDiscussions').at(-1).args[1]), 'another-project');
  await page.goto(url);
  await page.locator('.public-browser-tabs').getByRole('button', { name: /^合并请求审查/ }).waitFor();
  await page.evaluate(() => window.localizeFixture());
  await page.locator('.public-browser-tabs').getByRole('button', { name: /^Pull Request Reviews/ }).waitFor();
  await page.goto(url + '?pull=1');
  await page.getByRole('heading', { name: '合并请求审查', exact: true }).waitFor();
  await page.evaluate(() => window.localizeFixture());
  await page.getByRole('heading', { name: 'Pull Request Reviews', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Discussion pagination passed: 125 comments, retry, late-page isolation, history page 2, persistent drafts, own/public/PR search return and account/project isolation.');
} finally { await browser?.close(); await server.close(); }
