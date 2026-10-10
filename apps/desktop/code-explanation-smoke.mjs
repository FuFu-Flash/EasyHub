import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out/code-explanation-smoke');
await mkdir(output, { recursive: true });
const maliciousExplanation = '## 代码说明\n\n这个函数计算总和。\n\n<script>window.aiExplanationPwned=true</script>\n\n[危险地址](javascript:window.aiExplanationPwned=true)\n\n<img src=x onerror="window.aiExplanationPwned=true">';

// The actual component is served by Vite. Credentials, network and repositories
// are replaced only at the bridge boundary; no real AI request is sent.
const fixture = `
import {createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CodeExplanation,selectedCodeText} from '/src/components/CodeExplanation.tsx';
import {PullFileChanges} from '/src/components/PullFileChanges.tsx';
import '/src/styles.css';
import '/src/v2.css';
import '/src/components/local-change-selector.css';
window.calls={settings:0,explain:[],cancel:[]};window.pending=[];window.hold=false;window.fail=false;window.connected=true;
window.fixtureSettings={providerId:'deepseek',baseUrl:'https://api.deepseek.com',model:'fixture-model',hasApiKey:true};
window.fixtureMarkdown=${JSON.stringify(maliciousExplanation)};
window.localSource={kind:'local',projectId:'fixture-local',snapshot:'a'.repeat(64),path:'src/total.ts'};
window.pullSource={kind:'pull',owner:'fixture-owner',repo:'fixture-project',number:7,headSha:'b'.repeat(40),path:'src/value.ts'};
window.fixturePullFile={filename:'src/value.ts',status:'modified',additions:1,deletions:1,changes:2,patch:'@@ -1,2 +1,2 @@\\n const value = compute();\\n-return value;\\n+return value + 1;'};
window.fixtureResult=request=>({explanation:window.fixtureMarkdown,model:'fixture-model'});
window.fixtureSelectionHelper=selectedCodeText;
window.easyHub={platform:${JSON.stringify(process.platform)},
aiSettings:async()=>{window.calls.settings++;return {...window.fixtureSettings,hasApiKey:window.connected}},
aiExplainCode:async request=>{window.calls.explain.push(request);if(window.fail){window.fail=false;throw Error("Error invoking remote method 'easyhub:ai-explain-code': Error: 服务暂时不可用，请重试。")}if(window.hold)return new Promise((resolve,reject)=>window.pending.push({request,resolve,reject}));return window.fixtureResult(request)},
aiCancelReview:async requestId=>{window.calls.cancel.push(requestId)},
openExternalLink:async url=>{window.openedUrl=url},
};
function App(){const[language,setLanguage]=useState('zh');const[localCode,setLocalCode]=useState('function total(a, b) {\\n  return a + b;\\n}');window.setFixtureCode=setLocalCode;window.setFixtureLanguage=setLanguage;return h('div',{className:'app-shell','data-layout':'compact'},h('main',{className:'main-column',style:{paddingTop:0,marginLeft:0}},h('div',{className:'page-content'},
h('p',{id:'outside-code'},'这段是普通说明文字，不能发送给代码说明。'),
h(CodeExplanation,{source:window.localSource,language},h('div',{id:'local-file',className:'local-diff-lines','data-code-selection-region':true,tabIndex:0},localCode.split('\\n').map((text,index)=>h('div',{key:index,className:'local-diff-line added'},h('span',{'aria-hidden':true},String(index+101)),h('span',{'aria-hidden':true},String(index+101)),h('span',{'aria-hidden':true},'+'),h('code',{'data-explain-code':true},text))))),
h('div',{id:'pull-file'},h(PullFileChanges,{file:window.fixturePullFile,owner:'fixture-owner',repo:'fixture-project',number:7,headSha:'b'.repeat(40),language,downloadControl:null,onOpenLink:()=>{}}))))) }
createRoot(document.getElementById('root')).render(h(App));
`;

const server = await createServer({ configFile: false, root: join(desktop, 'src/renderer'), plugins: [react(), {
  name: 'code-explanation-fixture',
  configureServer(server) { server.middlewares.use(async (request, response, next) => {
    if (request.url !== '/code-explanation-test') return next();
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(await server.transformIndexHtml(request.url, '<div id="root"></div><script type="module" src="/@id/virtual:code-explanation.js"></script>'));
  }); },
  resolveId(id) { if (id === 'virtual:code-explanation.js') return '\0' + id; },
  load(id) { if (id === '\0virtual:code-explanation.js') return fixture; },
}], server: { host: '127.0.0.1', port: 0 } });

async function select(page, selector, endSelector = selector) {
  // Wait for React to finish any fixture language/content change before
  // constructing a selection; a remount replaces the selected DOM nodes.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(({ selector, endSelector }) => {
    const first = document.querySelectorAll(selector)[0]; const last = [...document.querySelectorAll(endSelector)].at(-1);
    if (!first || !last) throw new Error('Missing selection fixture nodes');
    const textNodes = (node) => { const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); const list = []; let current; while ((current = walker.nextNode())) list.push(current); return list; };
    const start = textNodes(first)[0]; const end = textNodes(last).at(-1);
    const range = document.createRange(); range.setStart(start, 0); range.setEnd(end, end.textContent.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    last.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { selector, endSelector });
}

// Measure glyphs, then perform actual pointer gestures. Never assign a DOM
// Selection here: Range.addRange would bypass user-select CSS and hide regressions.
async function mouseSelect(page, firstSelector, from, lastSelector, to) {
  // Collapse the preceding selection with a real click. Starting a new gesture
  // inside highlighted text would otherwise begin native drag-and-drop.
  await page.locator(lastSelector).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator(firstSelector).scrollIntoViewIfNeeded();
  await page.locator(lastSelector).scrollIntoViewIfNeeded();
  const points = await page.evaluate(({ firstSelector, from, lastSelector, to }) => {
    const point = (selector, offset, end) => {
      const element = document.querySelector(selector); const node = element.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) throw new Error('Expected a fixture text node');
      const range = document.createRange();
      if (offset === 'trailing-space') {
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect(); const box = element.getBoundingClientRect();
        if (box.right - text.right < 24) throw new Error('Fixture line needs visible blank space after the code');
        return { x: Math.min(text.right + 36, box.right - 6), y: text.top + text.height / 2 };
      }
      const position = end ? offset - 1 : offset;
      range.setStart(node, position); range.setEnd(node, position + 1);
      const bounds = range.getBoundingClientRect();
      return { x: end ? bounds.right - 0.25 : bounds.left + 0.25, y: bounds.top + bounds.height / 2 };
    };
    return { first: point(firstSelector, from, false), last: point(lastSelector, to, true) };
  }, { firstSelector, from, lastSelector, to });
  await page.mouse.move(points.first.x, points.first.y); await page.mouse.down();
  await page.mouse.move(points.last.x, points.last.y, { steps: 12 }); await page.mouse.up();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

let browser;
try {
  await server.listen(); const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
  const executablePath = process.env.EASYHUB_TEST_BROWSER ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 620 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === `http://127.0.0.1:${address.port}` ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${address.port}/code-explanation-test`);
  await page.locator('.pull-file-toggle').click();
  const trigger = () => page.getByRole('button', { name: /让 AI 详细说明|Explain.*AI|AI.*explain/i });
  const dialog = () => page.getByRole('dialog');
  const start = () => dialog().getByRole('button', { name: /开始说明|Start explanation|Explain code/i });
  async function open(selector) { await select(page, selector); await trigger().click(); await dialog().waitFor(); }
  async function close() { await dialog().getByRole('button', { name: /^(关闭|Close)$/i }).click(); await dialog().waitFor({ state: 'hidden' }); }
  const localFirst = '#local-file .local-diff-line:nth-child(1) code';
  const localSecond = '#local-file .local-diff-line:nth-child(2) code';
  const pullFirst = '#pull-file .pull-diff-context code';
  const pullSecond = '#pull-file .pull-diff-remove code';
  assert.equal(await mouseSelect(page, '#outside-code', 0, '#outside-code', 8), '', 'Ordinary UI remains unselectable during real mouse dragging');
  const localGutter = '#local-file .local-diff-line:first-child > span:first-child';
  assert.equal(await mouseSelect(page, localGutter, 0, localGutter, 3), '101', 'The entire diff region, including line-number gutters, supports mouse selection');
  assert.equal(await trigger().count(), 0, 'Selecting only line numbers does not enable AI explanation');
  const actualLocalSelection = await mouseSelect(page, localFirst, 9, localSecond, 14);
  assert.ok(actualLocalSelection.includes('total(a, b)') && actualLocalSelection.includes('return a +'), `Real local code dragging must select across lines; got ${JSON.stringify(actualLocalSelection)}`);
  assert.equal(await trigger().count(), 1, 'Real mouse selection exposes the local explanation action');
  assert.equal(await page.locator(localFirst).evaluate(node => getComputedStyle(node).cursor), 'text', 'Code uses the text-selection cursor');
  await trigger().click(); await dialog().waitFor();
  assert.match(await dialog().locator('.code-explanation-selection').innerText(), /total\(a, b\)/);
  assert.doesNotMatch(await dialog().locator('.code-explanation-selection').innerText(), /101|102/);
  await close();
  const actualPullSelection = await mouseSelect(page, pullFirst, 6, pullSecond, 12);
  assert.ok(actualPullSelection.includes('value = compute()') && actualPullSelection.includes('return value'), `Real change-request code dragging must select across lines; got ${JSON.stringify(actualPullSelection)}`);
  assert.equal(await trigger().count(), 1, 'Real mouse selection exposes the change-request explanation action');
  assert.equal(await page.locator(pullFirst).evaluate(node => getComputedStyle(node).cursor), 'text');
  await page.screenshot({ path: join(output, 'real-mouse-selected-pull-code.png'), animations: 'disabled' });
  await mouseSelect(page, '#outside-code', 0, '#outside-code', 8);
  await select(page, '#outside-code');
  assert.equal(await trigger().count(), 0, 'Ordinary description text does not enable code explanation');
  await select(page, '#local-file code', '#pull-file [data-explain-code]');
  assert.equal(await trigger().count(), 0, 'Selections across separate files must be rejected');
  const selectedLines = await page.evaluate(() => {
    const container = document.createElement('div'); container.setAttribute('data-code-selection-region', 'true'); container.innerHTML = '<span>12 +</span><code data-explain-code>first line</code><span>13 -</span><code data-explain-code>second line</code>'; document.body.append(container);
    const blocks = container.querySelectorAll('code'); const range = document.createRange(); range.setStart(blocks[0].firstChild, 6); range.setEnd(blocks[1].firstChild, 6);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const result = window.fixtureSelectionHelper(container, selection); selection.removeAllRanges(); container.remove(); return result;
  });
  assert.equal(selectedLines, 'line\nsecond', 'Partial selections across lines preserve code only, without line numbers or diff signs');
  await page.evaluate(() => window.setFixtureCode('a'.repeat(12001))); await select(page, '#local-file code');
  assert.equal(await trigger().isDisabled(), true, 'Oversized selections cannot be sent');
  assert.equal(await page.evaluate(() => window.calls.explain.length), 0);
  await page.evaluate(() => window.setFixtureCode('function total(a, b) {\n  return a + b;\n}'));
  await open('#local-file code');
  await dialog().getByText(/fixture-model/).waitFor();
  assert.match(await dialog().innerText(), /DeepSeek/);
  assert.equal(await page.evaluate(() => window.calls.explain.length), 0, 'Selecting code and opening the dialog never sends it without confirmation');
  for (const [width, layout] of [[800, 'compact'], [1060, 'comfortable']]) {
    await page.setViewportSize({ width, height: 620 });
    await page.locator('.app-shell').evaluate((node, value) => node.setAttribute('data-layout', value), layout);
    const overflow = await dialog().evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth, right: node.getBoundingClientRect().right, viewport: innerWidth }));
    assert.ok(overflow.scroll <= overflow.width + 2 && overflow.right <= overflow.viewport + 1, `The confirmation dialog fits at ${width}px`);
    await page.screenshot({ path: join(output, `confirmation-${layout}-${width}x620.png`), animations: 'disabled' });
  }
  await start().click(); await dialog().getByRole('heading', { name: '代码说明', exact: true }).waitFor();
  const first = await page.evaluate(() => window.calls.explain[0]);
  assert.equal(first.language, 'zh'); assert.equal(first.consentToSend, true); assert.equal(first.source.kind, 'local');
  assert.equal(first.providerBaseUrl, 'https://api.deepseek.com'); assert.equal(first.text, 'function total(a, b) {\n  return a + b;\n}');
  assert.equal(first.text.includes('101'), false, 'Displayed line numbers are excluded from the selected code');
  assert.equal(await page.evaluate(() => window.aiExplanationPwned === true), false);
  assert.equal(await dialog().locator('script, [onerror], a[href^="javascript:"]').count(), 0, 'AI output never becomes executable HTML or a JavaScript URL');
  await close();

  await page.evaluate(() => { window.setFixtureLanguage('en'); window.fixtureMarkdown = '## Explanation result\n\nThis statement calls compute.'; });
  await open('#pull-file [data-explain-code]'); await start().click(); await dialog().getByRole('heading', { name: 'Explanation result', exact: true }).waitFor();
  const english = await page.evaluate(() => window.calls.explain.at(-1)); assert.equal(english.language, 'en'); assert.equal(english.source.kind, 'pull'); assert.equal(english.source.headSha, 'b'.repeat(40)); await close();

  await page.evaluate(() => { window.hold = true; }); await open('#local-file code'); await start().click();
  await page.waitForFunction(() => window.pending.length === 1);
  const requestId = await page.evaluate(() => window.pending[0].request.requestId);
  await dialog().getByRole('button', { name: /取消说明|取消|Cancel explanation|Cancel/i, exact: true }).click();
  await page.waitForFunction((id) => window.calls.cancel.includes(id), requestId);
  await page.evaluate(async () => { window.pending[0].resolve({ explanation: 'LATE EXPLANATION MUST NOT APPEAR', model: 'fixture-model' }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); window.hold = false; });
  assert.equal(await page.getByText('LATE EXPLANATION MUST NOT APPEAR', { exact: true }).count(), 0, 'A canceled request cannot overwrite the current view');
  if (await dialog().count()) await close();

  await page.evaluate(() => { window.hold = true; }); await open('#pull-file [data-explain-code]'); await start().click(); await page.waitForFunction(() => window.pending.length === 2);
  const oldLanguageRequest = await page.evaluate(() => window.pending[1].request.requestId);
  await page.evaluate(() => window.setFixtureLanguage('zh')); await dialog().waitFor({ state: 'hidden' }); await page.waitForFunction((id) => window.calls.cancel.includes(id), oldLanguageRequest);
  await page.evaluate(async () => { window.pending[1].resolve({ explanation: 'OLD LANGUAGE RESULT MUST NOT APPEAR', model: 'fixture-model' }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); window.hold = false; });
  assert.equal(await page.getByText('OLD LANGUAGE RESULT MUST NOT APPEAR', { exact: true }).count(), 0);

  await page.evaluate(() => { window.setFixtureLanguage('zh'); window.fail = true; }); await open('#local-file code'); await start().click();
  await dialog().getByText('服务暂时不可用，请重试。', { exact: true }).waitFor();
  assert.equal((await dialog().innerText()).includes('Error invoking'), false);
  const failedCount = await page.evaluate(() => window.calls.explain.length);
  await dialog().getByRole('button', { name: /重新说明|Try again/i }).click();
  await page.waitForFunction((before) => window.calls.explain.length === before + 1, failedCount);
  await dialog().getByRole('heading', { name: 'Explanation result', exact: true }).waitFor(); await close();

  const beforeUnconfigured = await page.evaluate(() => { window.connected = false; return window.calls.explain.length; });
  await open('#local-file code');
  await dialog().getByText(/请先.*设置|Connect.*Settings/).waitFor();
  assert.equal(await page.evaluate(() => window.calls.explain.length), beforeUnconfigured);
  await close();
  await page.evaluate(() => { window.connected = true; });
  async function verifyRegionRequest(expected) {
    assert.equal(await trigger().count(), 1, 'A region selection that intersects code enables AI explanation');
    await trigger().click(); await dialog().waitFor(); await dialog().getByText(/fixture-model/).waitFor();
    assert.equal(await dialog().locator('.code-explanation-selection pre').innerText(), expected, 'Confirmation displays code only, without gutters or hunk metadata');
    const before = await page.evaluate(() => window.calls.explain.length);
    await start().click(); await page.waitForFunction((count) => window.calls.explain.length === count + 1, before);
    assert.equal(await page.evaluate(() => window.calls.explain.at(-1).text), expected, 'Only selected code is sent to the AI service');
    await dialog().locator('.code-explanation-result').waitFor(); await close();
  }
  const gutterSelection = await mouseSelect(page, localGutter, 0, localSecond, 15);
  assert.match(gutterSelection, /101/); assert.match(gutterSelection, /return a \+ b;/);
  await verifyRegionRequest('function total(a, b) {\n  return a + b;');
  const blankSelection = await mouseSelect(page, localFirst, 'trailing-space', localSecond, 15);
  assert.match(blankSelection, /return a \+ b;/);
  await verifyRegionRequest('return a + b;');
  const hunk = '#pull-file .pull-diff-hunk code';
  const hunkOnly = await mouseSelect(page, hunk, 0, hunk, 8); assert.ok(hunkOnly.includes('@@'));
  assert.equal(await trigger().count(), 0, 'Selecting hunk metadata alone never sends it to AI');
  const hunkSelection = await mouseSelect(page, hunk, 0, pullSecond, 12); assert.ok(hunkSelection.includes('@@'));
  if (await trigger().count() !== 1) {
    process.stdout.write(JSON.stringify(await page.evaluate(() => { const selection = window.getSelection(); const range = selection.getRangeAt(0); const root = document.querySelector('#pull-file .code-explanation'); return { text: selection.toString(), start: range.startContainer.parentElement?.outerHTML, end: range.endContainer.parentElement?.outerHTML, extracted: window.fixtureSelectionHelper(root, selection) }; }), null, 2) + '\n');
    await page.screenshot({ path: join(output, 'hunk-selection-failure.png'), animations: 'disabled' });
  }
  await verifyRegionRequest('const value = compute();\nreturn value');
  for (const selector of ['#local-file', '#pull-file .pull-diff-scroll']) {
    assert.equal(await page.locator(selector).evaluate((node) => [node, ...node.querySelectorAll('*')].every((child) => getComputedStyle(child).cursor === 'text')), true, 'The whole code region, gutters, blank space and hunk rows use an I-beam cursor');
  }
  assert.equal(await page.locator('#outside-code').evaluate(node => getComputedStyle(node).cursor), 'default');
  assert.equal(await mouseSelect(page, '#outside-code', 0, '#outside-code', 8), '', 'Selection stays disabled outside code regions');
  await mouseSelect(page, hunk, 0, pullSecond, 12);
  await page.screenshot({ path: join(output, 'whole-region-hunk-selection.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
  process.stdout.write('Whole diff-region mouse selection, gutter/blank/hunk starts, code-only requests, I-beam regions, UI exclusion, consent, language, cancellation, escaping, retry and narrow dialogs passed.\n');
} finally { await browser?.close(); await server.close(); }
