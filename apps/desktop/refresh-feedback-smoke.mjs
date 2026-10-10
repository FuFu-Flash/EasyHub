import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

// Real authenticated renderer; every IPC is explicitly mocked, network is blocked,
// and no account credentials, production profile or repository files are touched.
const desktop = dirname(fileURLToPath(import.meta.url));
const product = process.argv.includes('--packaged') ? join(desktop, 'release', 'win-unpacked', 'resources', 'app.asar') : desktop;
const output = join(desktop, 'out', 'refresh-feedback-smoke');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'isolated-'));
const profile = join(run, 'profile');
const launcher = join(run, 'launch.cjs');
await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
process.env.EASYHUB_PROXY_APP_ONLY_TEST = '1';
process.env.ELECTRON_RENDERER_URL = 'data:text/html,Isolated refresh fixture';
globalThis.refreshRegister = ipcMain.handle.bind(ipcMain);
globalThis.refreshForbidden = [];
ipcMain.handle = (channel, handler) => globalThis.refreshRegister(channel, channel.startsWith('easyhub:') ? () => {
  globalThis.refreshForbidden.push(channel); throw new Error('Unmocked refresh IPC: ' + channel);
} : handler);
require(${JSON.stringify(join(product, 'out', 'main', 'index.js'))});
`);
const app = await electron.launch({ executablePath: electronPath, args: [launcher], cwd: desktop });
const checks = [];
const check = (group, name, actual, expected = true) => {
  try { assert.deepEqual(actual, expected); checks.push({ group, name, passed: true }); }
  catch { checks.push({ group, name, passed: false, actual, expected }); }
};
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await app.evaluate(({ ipcMain, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const mock = (channel, handler) => { ipcMain.removeHandler(channel); globalThis.refreshRegister(channel, (_event, ...args) => handler(...args)); };
    const now = '2026-10-10T00:00:00Z';
    const repos = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: `fixture-${index + 1}`, full_name: `refresh-fixture/fixture-${index + 1}`, owner: { login: 'refresh-fixture', avatar_url: '' }, description: 'Stable project during delayed refresh', private: true, default_branch: 'main', updated_at: now, open_issues_count: 1, permissions: { push: true, admin: true } }));
    const readme = '![Stable fixture image](https://example.invalid/refresh-fixture.svg)\n\n[Stable fixture link](https://example.invalid/refresh-fixture)\n\n' + Array.from({ length: 45 }, (_, index) => `## Stable section ${index}\n\nKeep this loaded introduction visible while refreshing.`).join('\n\n');
    const issue = { id: 8, number: 8, title: 'Stable issue during refresh', body: 'Stable issue description', state: 'open', created_at: now, user: { login: 'writer' }, comments: 1 };
    const history = [{ sha: 'a'.repeat(40), commit: { message: 'Stable historical snapshot', author: { name: 'Writer', date: now } }, author: { login: 'writer' } }];
    const comments = [{ id: 90, body: 'Stable existing reply', created_at: now, user: { login: 'writer' } }];
    globalThis.refreshCalls = [];
    globalThis.refreshLinks = [];
    globalThis.refreshMutations = [];
    globalThis.refreshPagination = false;
    globalThis.refreshImmediateFailure = false;
    globalThis.refreshCompletionDelay = 0;
    globalThis.refreshHold = [];
    globalThis.refreshPending = [];
    mock('easyhub:auth-status', () => ({ user: { id: 1, login: 'refresh-fixture', name: 'Refresh Fixture', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:open-external-link', url => { globalThis.refreshLinks.push(url); });
    mock('easyhub:github', (action, ...args) => {
      globalThis.refreshCalls.push({ action, args });
      if (action === 'repos' && globalThis.refreshImmediateFailure) throw new Error('Isolated immediate refresh failure');
      if (action === 'createComment' || action === 'updateIssue') {
        globalThis.refreshMutations.push(action);
        return action === 'createComment' ? { ...comments[0], id: 900, body: args[3] } : { ...issue, state: args[3] };
      }
      const loadedComments = globalThis.refreshPagination ? Array.from({ length: 100 }, (_, index) => ({ ...comments[0], id: index + 100, body: `Loaded reply ${index + 1}` })) : comments;
      const loadedHistory = globalThis.refreshPagination ? Array.from({ length: 100 }, (_, index) => ({ ...history[0], sha: index.toString(16).padStart(40, '0'), commit: { ...history[0].commit, message: `Loaded version ${index + 1}` } })) : history;
      const results = { repos, readme, issuesPage: { items: [issue], nextPage: null }, commits: loadedHistory, commitsPage: { items: [{ ...history[0], sha: 'f'.repeat(40), commit: { ...history[0].commit, message: 'Older page version' } }], nextPage: null }, comments: loadedComments, commentsPage: { items: [{ ...comments[0], id: 800, body: 'Older page reply' }], nextPage: null }, isStarred: false, trending: { items: [], page: 1, hasNextPage: false } };
      if (action === 'activityCounts') return Object.fromEntries(args[0].map(item => [item.id, { issues: 1, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }]));
      if (!(action in results)) throw new Error('Unexpected refresh action: ' + action);
      if (action === 'repos' && globalThis.refreshCompletionDelay > 0) {
        return new Promise(resolve => setTimeout(() => resolve(results[action]), globalThis.refreshCompletionDelay));
      }
      if (!globalThis.refreshHold.includes(action)) return results[action];
      return new Promise((resolve, reject) => globalThis.refreshPending.push({ action, resolve: () => resolve(results[action]), reject: () => reject(new Error('Isolated refresh failure')) }));
    });
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  console.log('System reduced motion:', await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), join(product, 'out', 'renderer', 'index.html'));
  await page.locator('.live-connected').waitFor();
  await page.setViewportSize({ width: 1060, height: 700 });
  const refresh = page.locator('.sidebar-refresh');
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const ready = async () => { await page.waitForFunction(() => !document.querySelector('.sidebar-refresh')?.disabled); await frames(); };
  const hold = async actions => app.evaluate((_electron, next) => { globalThis.refreshCalls = []; globalThis.refreshHold = next; }, actions);
  const pending = async action => {
    for (let i = 0; i < 100; i++) {
      if (await app.evaluate((_electron, next) => globalThis.refreshPending.some(item => item.action === next), action)) return;
      await page.waitForTimeout(20);
    }
    throw new Error('Fixture did not receive delayed ' + action);
  };
  const settle = async (action, fail = false) => {
    await app.evaluate((_electron, { action, fail }) => {
      const items = globalThis.refreshPending.filter(item => item.action === action);
      globalThis.refreshPending = globalThis.refreshPending.filter(item => item.action !== action);
      for (const item of items) item[fail ? 'reject' : 'resolve']();
    }, { action, fail });
    await frames();
  };
  const spinning = async phase => {
    const sample = () => refresh.locator('svg').evaluate(node => ({ animation: getComputedStyle(node).animationName, transform: getComputedStyle(node).transform, running: node.getAnimations().some(animation => animation.playState === 'running') }));
    const before = await sample();
    await page.waitForTimeout(160);
    const after = await sample();
    check('animation', `${phase}: a real running animation`, before.running && before.animation !== 'none');
    check('animation', `${phase}: icon visibly rotates`, before.transform !== after.transform);
    check('animation', `${phase}: repeat click disabled`, await refresh.isDisabled());
  };
  const remember = async selector => page.evaluate(selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error('Missing observed content: ' + selector);
    const area = document.querySelector('.main-column');
    const rect = node.getBoundingClientRect();
    window.refreshObserved = { node, selector, image: node.querySelector('img'), link: node.querySelector('a'), text: node.textContent, top: rect.top, left: rect.left, scroll: area.scrollTop };
  }, selector);
  const retained = async phase => {
    const state = await page.evaluate(() => {
      const saved = window.refreshObserved;
      const node = document.querySelector(saved.selector);
      const rect = node?.getBoundingClientRect();
      return { connected: saved.node.isConnected, sameNode: saved.node === node, sameText: saved.text === node?.textContent, imageTracked: Boolean(saved.image), sameImage: saved.image === node?.querySelector('img'), linkTracked: Boolean(saved.link), sameLink: saved.link === node?.querySelector('a'), deltaTop: rect ? rect.top - saved.top : null, deltaLeft: rect ? rect.left - saved.left : null, deltaScroll: document.querySelector('.main-column').scrollTop - saved.scroll };
    });
    check('content', `${phase}: loaded content stays mounted`, state.connected && state.sameNode && state.sameText);
    if (state.imageTracked) check('content', `${phase}: existing markdown image stays mounted`, state.sameImage);
    if (state.linkTracked) check('content', `${phase}: existing markdown link stays mounted`, state.sameLink);
    check('content', `${phase}: content position stays stable`, state.deltaTop !== null && Math.abs(state.deltaTop) < 2 && Math.abs(state.deltaLeft) < 2 && Math.abs(state.deltaScroll) < 2);
    if (!state.connected || !state.sameNode || !state.sameText || Math.abs(state.deltaTop ?? Infinity) >= 2 || Math.abs(state.deltaScroll) >= 2) checks.at(-1).measurement = state;
  };
  const repeated = async () => {
    await refresh.evaluate(node => { node.click(); node.click(); });
    await frames();
    check('requests', 'One repositories request for repeated refresh clicks', await app.evaluate(() => globalThis.refreshCalls.filter(call => call.action === 'repos').length), 1);
  };
  const reset = async phase => {
    await ready();
    check('animation', `${phase}: spinner stops`, await refresh.locator('svg').evaluate(node => !node.getAnimations().some(animation => animation.playState === 'running')));
    check('animation', `${phase}: refresh available again`, await refresh.isEnabled());
  };

  await ready();
  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  await page.locator('.cloud-row').nth(15).scrollIntoViewIfNeeded();
  // Immediate IPC responses can finish before the first painted frame. Cover that
  // path without holding any request, in both OS motion modes and both outcomes.
  for (const motion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: motion });
    for (const fail of [false, true]) {
      const phase = 'Fast ' + (fail ? 'failure' : 'success') + ' (' + motion + ')';
      await remember('.cloud-row:nth-child(16)');
      await hold([]);
      await app.evaluate((_electron, value) => { globalThis.refreshImmediateFailure = value; }, fail);
      await refresh.evaluate(node => {
        const sampleWindow = window;
        const generation = sampleWindow.fastRefreshGeneration = (sampleWindow.fastRefreshGeneration ?? 0) + 1;
        sampleWindow.fastRefreshStarted = performance.now();
        sampleWindow.fastRefreshVisibleFrames = 0;
        const frame = () => {
          if (sampleWindow.fastRefreshGeneration !== generation) return;
          if (node.getAttribute('aria-busy') === 'true') sampleWindow.fastRefreshVisibleFrames++;
          if (performance.now() - sampleWindow.fastRefreshStarted < 1300) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        node.click();
      });
      const sampleAt = async point => refresh.evaluate(async (node, point) => {
        const remaining = point - (performance.now() - window.fastRefreshStarted);
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        const icon = node.querySelector('svg');
        const animation = icon.getAnimations().find(item => item.playState === 'running');
        const duration = animation?.effect?.getComputedTiming().duration;
        return { elapsed: performance.now() - window.fastRefreshStarted, running: Boolean(animation),
          transform: getComputedStyle(icon).transform, opacity: Number(getComputedStyle(node).opacity),
          color: getComputedStyle(node).color, visibleFrames: window.fastRefreshVisibleFrames,
          completedTurn: typeof animation?.currentTime === 'number' && typeof duration === 'number' && duration > 0 && animation.currentTime >= duration };
      }, point);
      const first = await sampleAt(100);
      await refresh.evaluate(node => { node.click(); node.click(); });
      const next = await sampleAt(300);
      const visible = await sampleAt(600);
      await retained(phase + ': immediate response');
      const turn = await sampleAt(1100);
      check('fast-feedback', phase + ': spinner reaches a rendered frame', visible.visibleFrames > 0);
      check('fast-feedback', phase + ': spinner stays visible long enough to recognize', first.running && next.running && visible.running);
      check('fast-feedback', phase + ': icon visibly rotates', first.transform !== next.transform && next.transform !== visible.transform);
      check('fast-feedback', phase + ': icon completes a visible rotation', turn.running && turn.completedTurn);
      check('fast-feedback', phase + ': active feedback stays opaque', first.opacity >= 0.95);
      const rgb = first.color.match(/\d+/g)?.map(Number) ?? [];
      check('fast-feedback', phase + ': active feedback is visibly blue', rgb.length >= 3 && rgb[2] - rgb[0] > 80 && rgb[2] - rgb[1] > 40);
      check('requests', phase + ': animation blocks repeated requests', await app.evaluate(() => globalThis.refreshCalls.filter(call => call.action === 'repos').length), 1);
      check('isolation', phase + ': no request artificially held', await app.evaluate(() => globalThis.refreshPending.length), 0);
      await ready();
      const stopped = await refresh.evaluate(node => ({ elapsed: performance.now() - window.fastRefreshStarted,
        running: node.querySelector('svg').getAnimations().some(item => item.playState === 'running') }));
      check('fast-feedback', phase + ': completed feedback stops promptly', !stopped.running && stopped.elapsed < 2400);
      await retained(phase + ': finished');
    }
  }
  await app.evaluate(() => { globalThis.refreshImmediateFailure = false; });
  // Removing the busy class mid-turn resets transform to none. Observe the actual
  // final rendered step, including requests that finish between cycle boundaries.
  const stopRecordings = [];
  for (const motion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: motion });
    for (const delay of [0, 1500]) {
      const phase = 'Refresh stop (' + motion + ', ' + delay + 'ms response)';
      await hold([]);
      await app.evaluate((_electron, value) => { globalThis.refreshCompletionDelay = value; }, delay);
      await refresh.evaluate(node => {
        window.refreshStopFrames = [];
        window.refreshStopComplete = false;
        const started = performance.now();
        let active = false;
        let idleFrames = 0;
        const frame = () => {
          const icon = node.querySelector('svg');
          const transform = getComputedStyle(icon).transform;
          const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
          const animation = icon.getAnimations().find(item => item.playState === 'running');
          const state = { time: performance.now() - started, busy: node.getAttribute('aria-busy') === 'true',
            transform, angle: (Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 360) % 360,
            running: Boolean(animation), duration: animation?.effect?.getComputedTiming().duration ?? null };
          window.refreshStopFrames.push(state);
          if (state.busy) active = true;
          if (active && !state.busy) idleFrames++;
          if (idleFrames >= 3 || state.time > 4500) { window.refreshStopComplete = true; return; }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        node.click();
      });
      await page.waitForFunction(() => window.refreshStopComplete);
      const recording = await page.evaluate(() => window.refreshStopFrames);
      const index = recording.findIndex((item, index, items) => index > 0 && items[index - 1].busy && !item.busy);
      const before = index > 0 ? recording[index - 1] : null;
      const after = index > 0 ? recording[index] : null;
      const jump = before && after ? Math.abs(((after.angle - before.angle + 540) % 360) - 180) : null;
      const advance = before && after && typeof before.duration === 'number' && before.duration > 0
        ? (after.time - before.time) * 360 / before.duration : null;
      const measurement = { phase, stoppedAt: after?.time ?? null, finalBusyAngle: before?.angle ?? null,
        jump, allowedJump: advance === null ? null : advance + 3, frames: recording };
      stopRecordings.push(measurement);
      check('stop-continuity', phase + ': final angular step stays continuous', jump !== null && advance !== null && jump <= advance + 3);
      if (!checks.at(-1).passed) checks.at(-1).measurement = { ...measurement, frames: undefined };
      const idle = recording.at(-1);
      check('stop-continuity', phase + ': spinner settles at its resting position', Boolean(after && !idle.running && idle.transform === 'none'));
      await ready();
    }
  }
  await writeFile(join(output, 'stop-continuity.json'), JSON.stringify(stopRecordings, null, 2) + '\n');
  await app.evaluate(() => { globalThis.refreshCompletionDelay = 0; });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await remember('.cloud-row:nth-child(16)');
  await hold(['repos']);
  await refresh.click();
  await pending('repos');
  await spinning('Repository refresh');
  await retained('Repository refresh');
  await repeated();
  await page.screenshot({ path: join(output, 'repositories-pending.png') });
  await settle('repos');
  await reset('Repository success');
  await retained('Repository success');

  // The OS motion preference must still permit a usable in-flight indicator.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await hold(['repos']);
  await refresh.click();
  await pending('repos');
  await frames();
  await spinning('Reduced-motion repository refresh');
  await page.screenshot({ path: join(output, 'reduced-motion-pending.png') });
  await settle('repos');
  await reset('Reduced-motion success');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await hold([]);

  await page.locator('.sidebar-nav').getByRole('button', { name: '问题', exact: false }).click();
  await page.locator('.issue-project-header').first().click();
  await page.locator('.issue-row').first().waitFor();
  await ready();
  await remember('.issue-row');
  await hold(['repos', 'issuesPage']);
  await refresh.click();
  await pending('repos');
  await retained('Expanded issue group repository refresh');
  await settle('repos');
  await pending('issuesPage');
  await retained('Expanded issue group rows refresh');
  await settle('issuesPage');
  await reset('Expanded issue group success');
  await retained('Expanded issue group success');
  await hold([]);

  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();

  await page.locator('.cloud-row').first().getByRole('button', { name: '查看', exact: true }).click();
  await page.locator('.readme-markdown h2').first().waitFor();
  await ready();
  await page.locator('.main-column').evaluate(node => { node.scrollTop = 550; });
  await frames();
  await remember('.readme-markdown');
  await hold(['repos', 'readme', 'issuesPage', 'commits']);
  await refresh.click();
  await pending('repos');
  await retained('Project repositories stage');
  await settle('repos');
  await pending('readme');
  await spinning('Project detail refresh');
  await repeated();
  check('requests', 'One introduction request after the repositories stage', await app.evaluate(() => globalThis.refreshCalls.filter(call => call.action === 'readme').length), 1);
  await retained('Project detail refresh');
  await page.screenshot({ path: join(output, 'project-pending.png') });
  await settle('readme');
  await settle('issuesPage');
  await settle('commits');
  await reset('Project success');
  await retained('Project success');
  await page.locator('.readme-markdown').getByRole('link', { name: 'Stable fixture link', exact: true }).click();
  await frames();
  check('links', 'Preserved markdown link uses its current destination', await app.evaluate(() => globalThis.refreshLinks), ['https://example.invalid/refresh-fixture']);

  await remember('.readme-markdown');
  await hold(['repos', 'readme', 'issuesPage', 'commits']);
  await refresh.click();
  await pending('repos');
  await settle('repos');
  await pending('readme');
  await settle('readme', true);
  await settle('issuesPage', true);
  await settle('commits', true);
  await reset('Project failure');
  await retained('Project failure');

  // A completed request must not return the user to the refreshed destination.
  await hold([]);
  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  if (await page.locator('.cloud-row').count()) await page.locator('.cloud-row').first().getByRole('button', { name: '查看', exact: true }).click();
  await page.locator('.readme-markdown h2').first().waitFor();
  await ready();
  await hold(['repos', 'readme', 'issuesPage', 'commits']);
  await refresh.click();
  await pending('repos');
  await settle('repos');
  await pending('readme');
  await page.locator('.sidebar-nav').getByRole('button', { name: '发现', exact: true }).click();
  await page.locator('.discover-page').waitFor();
  await remember('.discover-page');
  await spinning('Refresh after navigation away');
  await settle('readme');
  await settle('issuesPage');
  await settle('commits');
  await reset('Late project response');
  await retained('Late project response keeps discovery active');
  check('navigation', 'Late project response keeps the selected navigation', await page.locator('.sidebar-nav button.active').innerText(), '发现');

  // Navigation during the first stage must not start the old detail request.
  await hold([]);
  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  if (await page.locator('.cloud-row').count()) await page.locator('.cloud-row').first().getByRole('button', { name: '查看', exact: true }).click();
  await page.locator('.readme-markdown h2').first().waitFor();
  await ready();
  await hold(['repos']);
  await refresh.click();
  await pending('repos');
  await page.locator('.sidebar-nav').getByRole('button', { name: '发现', exact: true }).click();
  await page.locator('.discover-page').waitFor();
  await remember('.discover-page');
  await settle('repos');
  await reset('Late repositories response');
  await retained('Late repositories response keeps discovery active');
  check('navigation', 'Leaving during repositories refresh skips the old project request', await app.evaluate(() => globalThis.refreshCalls.filter(call => call.action === 'readme').length), 0);

  // Reading refresh must preserve drafts and block writes until its snapshot settles.
  // Exhausting page 2 first also checks that replacing page 1 resets its continuation.
  await hold([]);
  await app.evaluate(() => { globalThis.refreshPagination = true; });
  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  if (await page.locator('.cloud-row').count()) await page.locator('.cloud-row').first().getByRole('button', { name: '查看', exact: true }).click();
  await page.locator('.detail-side').getByRole('button', { name: '查看问题', exact: true }).click();
  await page.locator('.issue-row').first().click();
  await page.getByText('Loaded reply 100', { exact: true }).waitFor();
  await ready();
  const moreReplies = page.getByRole('button', { name: '加载更多回复', exact: true });
  await moreReplies.click();
  await page.getByText('Older page reply', { exact: true }).waitFor();
  const reply = page.getByRole('textbox', { name: '写一条回复', exact: true });
  await reply.fill('Draft survives a delayed refresh');
  await hold(['repos', 'readme', 'issuesPage', 'commits', 'comments']);
  await refresh.click();
  await pending('repos');
  await settle('repos');
  await pending('readme');
  await settle('readme');
  await settle('issuesPage');
  await settle('commits');
  await pending('comments');
  await spinning('Issue comments refresh');
  const stateButton = page.locator('.reply-card button').first();
  const sendButton = page.locator('.reply-card button').last();
  check('writes', 'Pending comment refresh preserves the typed draft', await reply.inputValue(), 'Draft survives a delayed refresh');
  check('writes', 'Pending comment refresh disables replying', await sendButton.isDisabled());
  check('writes', 'Pending comment refresh disables issue state changes', await stateButton.isDisabled());
  await page.locator('.reply-card').evaluate(node => { for (const button of node.querySelectorAll('button')) button.click(); });
  await frames();
  check('writes', 'Clicks during comment refresh invoke no write IPC', await app.evaluate(() => globalThis.refreshMutations), []);
  await settle('comments');
  await reset('Issue comments success');
  check('writes', 'Completed comment refresh preserves the typed draft', await reply.inputValue(), 'Draft survives a delayed refresh');
  check('writes', 'Completed comment refresh allows replying', await sendButton.isEnabled());
  check('writes', 'Completed comment refresh allows issue state changes', await stateButton.isEnabled());
  check('pagination', 'Refreshing page 1 resets an exhausted comment continuation', await moreReplies.count(), 1);
  if (await moreReplies.count()) {
    await moreReplies.click();
    await page.getByText('Older page reply', { exact: true }).waitFor();
    check('pagination', 'The next reply request starts from page 2', await app.evaluate(() => globalThis.refreshCalls.filter(call => call.action === 'commentsPage').at(-1).args.at(-1)), 2);
  }

  await hold([]);
  await page.locator('.topbar-brand').click();
  await page.locator('.home-project-actions').first().getByRole('button', { name: '打开项目', exact: true }).click();
  await page.locator('.readme-markdown h2').first().waitFor();
  await ready();
  await page.getByRole('heading', { name: '历史版本', exact: true }).locator('..').getByRole('button', { name: '查看全部', exact: true }).click();
  await page.getByText('Loaded version 100', { exact: true }).waitFor();
  const moreVersions = page.getByRole('button', { name: '加载更多', exact: true });
  await moreVersions.click();
  await page.getByText('Older page version', { exact: true }).waitFor();
  await hold(['repos', 'readme', 'issuesPage', 'commits']);
  await refresh.click();
  await pending('repos');
  await settle('repos');
  await pending('readme');
  await settle('readme');
  await settle('issuesPage');
  await settle('commits');
  await reset('History success');
  check('pagination', 'Refreshing page 1 resets an exhausted history continuation', await moreVersions.count(), 1);
  if (await moreVersions.count()) {
    await moreVersions.click();
    await page.getByText('Older page version', { exact: true }).waitFor();
    check('pagination', 'The next history request starts from page 2', await app.evaluate(() => globalThis.refreshCalls.filter(call => call.action === 'commitsPage').at(-1).args.at(-1)), 2);
  }

  check('isolation', 'No unmocked IPC', await app.evaluate(() => globalThis.refreshForbidden), []);
  check('isolation', 'No renderer errors', errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify(checks, null, 2) + '\n');
  for (const result of checks) console.log(`${result.passed ? 'PASS' : 'FAIL'} [${result.group}] ${result.name}${result.passed ? '' : ' ' + JSON.stringify(result.measurement ?? { actual: result.actual, expected: result.expected })}`);
  const focus = process.argv.find(arg => arg.startsWith('--focus='))?.slice('--focus='.length);
  assert.equal(checks.filter(result => (!focus || result.group === focus) && !result.passed).length, 0, 'Refresh feedback regression; see out/refresh-feedback-smoke/result.json');
} finally { await app.close(); }
