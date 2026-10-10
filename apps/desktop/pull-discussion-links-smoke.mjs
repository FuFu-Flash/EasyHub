import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Exercise the production discussion renderer without GitHub or shell access.
const root = dirname(fileURLToPath(import.meta.url));
const fixture = `
import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {PullRequestsPanel} from '/src/components/PullRequestsPanel.tsx';
import '/src/styles.css';
import '/src/v2.css';
const repo={id:1,name:'sample',full_name:'tester/sample',private:true,default_branch:'main',owner:{login:'tester'},permissions:{pull:true}};
const pull={id:1,number:1,title:'A discussion',body:'[Read documentation](docs/guide.md)\\n\\n[Unsafe](javascript:alert(1))',state:'open',created_at:'2026-10-08T00:00:00Z',user:{login:'contributor'},head:{sha:'a'.repeat(40)},base:{ref:'main',sha:'b'.repeat(40)}};
window.opened=[];
window.easyHub={platform:${JSON.stringify(process.platform)},onAiReviewProgress:()=>()=>{},openExternalLink:async(url)=>{window.opened.push(url)},github:async(action,...args)=>{
 if(action==='pullRequests')return [pull];
 if(action==='pullRequest')return pull;
 if(action==='pullChecks')return {headSha:args[3].headSha,checkRuns:{state:'available',items:[],nextPage:null},statuses:{state:'available',items:[],nextPage:null}};
 if(action==='pullReviewContext')return {repository:repo,pullRequest:pull,files:[],filesTruncated:false};
 if(action==='comments')return [{id:2,user:{login:'tester'},created_at:'2026-10-08T01:00:00Z',body:'[More information](https://example.com/help)'}];
 throw Error('Unexpected read: '+action);
}};
createRoot(document.getElementById('root')).render(createElement(PullRequestsPanel,{repo,currentUser:'reader',language:'zh'}));
`;
const server = await createServer({
  configFile: false, root: join(root, 'src/renderer'),
  plugins: [react(), {
    name: 'discussion-link-fixture',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== '/discussion-test') return next();
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(await server.transformIndexHtml(request.url, '<div id="root"></div><script type="module" src="/@id/virtual:discussion.jsx"></script>'));
      });
    },
    resolveId(id) { if (id === 'virtual:discussion.jsx') return '\0' + id; },
    load(id) { if (id === '\0virtual:discussion.jsx') return fixture; },
  }], server: {host:'127.0.0.1',port:0},
});
let browser;
try {
  await server.listen();
  const address=server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const url=`http://127.0.0.1:${address.port}/discussion-test`;
  const executablePath=process.env.EASYHUB_TEST_BROWSER ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser=await chromium.launch({...(executablePath?{executablePath}:{}),headless:true});
  const page=await browser.newPage();
  page.setDefaultTimeout(7000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin ? route.continue():route.abort());
  await page.goto(url);
  await page.getByRole('button',{name:/A discussion/}).click();
  await page.getByRole('link',{name:'Read documentation',exact:true}).click({noWaitAfter:true});
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(()=>window.opened),['https://github.com/tester/sample/blob/main/docs/guide.md'],'Discussion links must use the controlled opener instead of attempting window navigation');
  await page.getByRole('link',{name:'More information',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.opened),['https://github.com/tester/sample/blob/main/docs/guide.md','https://example.com/help']);
  assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
  assert.deepEqual(errors,[]);
  process.stdout.write('Pull request body/comment links and unsafe link filtering passed.\n');
} finally { await browser?.close(); await server.close(); }
