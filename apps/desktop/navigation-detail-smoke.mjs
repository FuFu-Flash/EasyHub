import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchUpstreamFixture } from './upstream-smoke-runtime.mjs';
import { installDownloadFixture } from './download-fixture.mjs';

// The actual renderer and preload with deny-by-default IPC and blocked network.
// This checks detail/context retention without touching GitHub, credentials, or AI.
const desktop = dirname(fileURLToPath(import.meta.url));
const packaged = process.argv.includes('--packaged');
const onlyPendingCase = process.argv.find(value => value.startsWith('--pending-case='))?.slice(15);
const output = join(desktop, 'out', 'navigation-detail-smoke');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'isolated-'));
const { app, executable, renderer } = await launchUpstreamFixture(desktop, {
  profile: join(run, 'profile'), launcher: join(run, 'launch.cjs'),
  registerName: 'registerNavigationFixture', rejectedName: 'rejectedNavigationIPC', title: 'Navigation detail fixture',
  allowedFlags: process.argv.slice(2).filter(value => value.startsWith('--pending-case='))
});
const completed = [];
let lastExpectedScroll = null;
try {
  await app.evaluate(({ ipcMain, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const fixture = globalThis.navigationDetailFixture = { requests: [], blocked: [], commentRevision: 1, delayNextComments: false, releaseComments: null, completedCommentRevisions: [], readmeRevision: 1, delayNextReadme: false, releaseReadme: null, completedReadmeRevisions: [] };
    const mock = (channel, handler) => { ipcMain.removeHandler(channel); globalThis.registerNavigationFixture(channel, (_event, ...args) => handler(...args)); };
    const now = new Date().toISOString();
    const own = ['project-a', 'project-b'].map((name, index) => ({ id: index + 1, name, full_name: `tester/${name}`, owner: { login: 'tester', avatar_url: '' },
      description: `Own ${name}`, private: true, archived: false, default_branch: 'main', updated_at: now, open_issues_count: 1, permissions: { push: true, admin: true } }));
    const publicRepo = { ...own[0], id: 100, name: 'public-project', full_name: 'writer/public-project', private: false, owner: { login: 'writer', avatar_url: '' }, permissions: undefined };
    const repository = name => [...own, publicRepo].find(repo => repo.name === name);
    const issue = repo => ({ id: repo.id * 100 + 7, number: 7, title: `${repo.name} remembered issue`,
      body: Array.from({ length: 20 }, (_, i) => `## Issue section ${i}\n\nDetailed issue report for ${repo.name}.`).join('\n\n'),
      state: 'open', created_at: now, user: { login: 'issue-author' }, comments: 2 });
    mock('easyhub:auth-status', () => ({ user: { id: 1, login: 'tester', name: 'Tester', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:ai-settings', () => ({ providerId: 'deepseek', baseUrl: '', model: 'deepseek-chat', hasApiKey: false }));
    mock('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', platform: 'win32', arch: 'x64' }));
    mock('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false, system: { mode: 'off' } }));
    mock('easyhub:github', async (action, ...args) => {
      fixture.requests.push({ action, args });
      if (action === 'repos') return args[0] === 1 ? own : [];
      if (action === 'activityCounts') return Object.fromEntries(args[0].map(repo => [repo.id, { issues: 1, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }]));
      if (action === 'isStarred') return false;
      if (action === 'readme') {
        const revision = fixture.readmeRevision;
        if (fixture.delayNextReadme) { fixture.delayNextReadme = false; await new Promise(resolve => { fixture.releaseReadme = resolve; }); }
        fixture.completedReadmeRevisions.push(revision);
        return `# README for ${args[1]} revision ${revision}\n\n` + Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\nProject documentation.`).join('\n\n');
      }
      if (action === 'issuesPage') return { items: [issue(repository(args[1]))], nextPage: null };
      if (action === 'comments') {
        const revision = fixture.commentRevision;
        if (fixture.delayNextComments) { fixture.delayNextComments = false; await new Promise(resolve => { fixture.releaseComments = resolve; }); }
        fixture.completedCommentRevisions.push(revision);
        return [1, 2].map(id => ({ id, body: `Comment ${id} on ${args[1]} revision ${revision}.\n\n` + Array.from({ length: 8 }, (_, i) => `Paragraph ${i}: conversation details.`).join('\n\n'), created_at: now, user: { login: 'comment-author' } }));
      }
      if (action === 'commentsPage' || action === 'commitsPage') return { items: [], nextPage: null };
      if (action === 'commits') return [];
      if (action === 'trending') return { items: [publicRepo], page: args[1] ?? 1, hasNextPage: false };
      if (action === 'publicRepo' || action === 'repository') return repository(args[1]);
      if (action === 'searchPublicReposPage' || action === 'searchUsersPage') return { items: [], page: 1, totalCount: 0, hasNextPage: false, incompleteResults: false };
      if (action === 'appUpdate') return { state: 'latest', currentVersion: '1.2.0', latestVersion: '1.2.0' };
      fixture.blocked.push(action);
      throw new Error('Write or unexpected GitHub action blocked: ' + action);
    });
  });
  await installDownloadFixture(app, []);
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), renderer);
  await page.locator('.live-connected').waitFor();
  await page.setViewportSize({ width: 1060, height: 700 });
  const nav = name => page.locator('.sidebar-nav').getByRole('button', { name: name === '问题' ? /^问题/ : name, exact: name !== '问题' });
  const scroll = async top => {
    await page.locator('.main-column').evaluate((node, target) => { node.scrollTop = target; }, top);
    await page.waitForTimeout(100);
    return page.locator('.main-column').evaluate(node => node.scrollTop);
  };
  const assertScroll = async (position, reason) => {
    lastExpectedScroll = { position, reason };
    await page.waitForFunction(target => Math.abs(document.querySelector('.main-column').scrollTop - target) < 5, position);
    assert.ok(Math.abs(await page.locator('.main-column').evaluate(node => node.scrollTop) - position) < 5, reason);
  };
  const assertVerticalMarkdown = async scope => {
    const positions = await page.locator(scope).locator('.message-box').first().evaluate(node => {
      const rects = selector => [...node.querySelectorAll(selector)].slice(0, 2).map(element => {
        const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height };
      });
      return { headings: rects('h2'), paragraphs: rects('p') };
    });
    for (const [kind, rows] of Object.entries(positions)) {
      assert.equal(rows.length, 2, `${scope} fixture requires two Markdown ${kind}.`);
      assert.ok(rows.every(row => row.height > 0), `${scope} Markdown ${kind} must have rendered dimensions.`);
      assert.ok(rows[1].top >= rows[0].bottom - 1, `${scope} Markdown ${kind} must flow vertically, not as horizontal header columns: ${JSON.stringify(rows)}`);
    }
  };

  await nav('发现').click();
  await page.locator('.trending-card').filter({ hasText: 'public-project' }).click();
  await page.locator('.public-browser-tabs').getByRole('button', { name: /^问题/ }).click();
  await page.locator('.public-list-row').filter({ hasText: 'public-project remembered issue' }).click();
  await page.locator('#public-issue-reply').fill('Public reply retained across sidebar navigation');
  await assertVerticalMarkdown('.public-issue-detail');
  const publicPosition = await scroll(550);
  assert.ok(publicPosition >= 500, 'Fixture must have enough issue content to exercise scrolling.');
  await nav('设置').click();
  await page.locator('#ai-settings-heading').waitFor();
  await nav('发现').click();
  await page.locator('.public-issue-detail .issue-title h1').waitFor();
  assert.equal(await page.locator('.public-issue-detail .issue-title h1').innerText(), 'public-project remembered issue');
  assert.equal(await page.locator('#public-issue-reply').inputValue(), 'Public reply retained across sidebar navigation');
  await assertScroll(publicPosition, 'Public issue detail scroll position must survive Settings.');
  assert.equal(await page.locator('.public-browser-hero').count(), 0, 'Restoring a public issue must keep the conversation view, not the README hero.');
  completed.push('public-issue-detail-settings-return');
  await page.getByRole('button', { name: '返回问题', exact: true }).evaluate(node => node.click());
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  await page.locator('.back-link').evaluate(node => node.click());
  await page.locator('.public-issue-detail .issue-title h1').waitFor();
  assert.equal(await page.locator('#public-issue-reply').inputValue(), 'Public reply retained across sidebar navigation');
  await assertScroll(publicPosition, 'Back must restore the original public issue visit after Settings.');
  await page.getByRole('button', { name: '返回问题', exact: true }).evaluate(node => node.click());
  assert.match(await page.locator('.public-browser-tabs button.selected').innerText(), /^问题/);
  await page.locator('.public-list-row').filter({ hasText: 'public-project remembered issue' }).waitFor();
  completed.push('public-issues-tab-retained');

  await nav('问题').click();
  await page.locator('.issue-project-header').filter({ hasText: 'project-a' }).click();
  await page.locator('.issue-row').filter({ hasText: 'project-a remembered issue' }).click();
  await page.locator('#live-reply').fill('Own A7 draft must stay with project A');
  await assertVerticalMarkdown('.issue-detail');
  const ownPosition = await scroll(640);
  await nav('首页').click();
  await page.locator('.home-project-row').filter({ hasText: 'project-b' }).getByRole('button', { name: '打开项目', exact: true }).click();
  await page.locator('.detail-hero h1').filter({ hasText: 'project-b' }).waitFor();
  await page.locator('.readme-markdown').filter({ hasText: 'README for project-b' }).waitFor();
  await nav('问题').click();
  await page.locator('#live-reply').waitFor();
  assert.equal(await page.locator('.issue-title h1').innerText(), 'project-a remembered issue', 'Another project must not replace the retained issue.');
  assert.match(await page.locator('.issue-title p').innerText(), /^project-a ·/);
  assert.equal(await page.locator('#live-reply').inputValue(), 'Own A7 draft must stay with project A');
  assert.match(await page.locator('.conversation').innerText(), /Comment 1 on project-a/);
  assert.doesNotMatch(await page.locator('.conversation').innerText(), /project-b/);
  await assertVerticalMarkdown('.issue-detail');
  await assertScroll(ownPosition, 'Own issue detail position must survive opening a different project from Home.');
  completed.push('own-issue-context-and-reply-restored');
  // DOM clicks avoid Playwright scrolling the offscreen Back button to the top
  // before the application records the current reading position.
  await page.getByRole('button', { name: '返回问题', exact: true }).evaluate(node => node.click());
  await page.locator('.detail-hero h1').filter({ hasText: 'project-b' }).waitFor();
  await page.locator('.back-link').evaluate(node => node.click());
  await page.locator('.home-dashboard').waitFor();
  await page.locator('.back-link').evaluate(node => node.click());
  await page.locator('.issue-title h1').filter({ hasText: 'project-a remembered issue' }).waitFor();
  assert.equal(await page.locator('#live-reply').inputValue(), 'Own A7 draft must stay with project A', 'Returning to the earlier issue visit keeps its own draft.');
  await assertScroll(ownPosition, 'Back restores the original issue visit and reading position.');
  await page.locator('.back-link').evaluate(node => node.click());
  assert.equal(await page.locator('.filter-project').count(), 0, 'Returning from the restored global issue should restore the global issue list.');
  assert.equal(await page.locator('.issue-project-header').filter({ hasText: 'project-a' }).getAttribute('aria-expanded'), 'true');
  await page.locator('.issue-row').filter({ hasText: 'project-a remembered issue' }).waitFor();
  completed.push('own-issue-return-context-restored');

  if (onlyPendingCase !== 'project') {
  await app.evaluate(() => { const fixture = globalThis.navigationDetailFixture; fixture.commentRevision = 2; fixture.delayNextComments = true; fixture.releaseComments = null; });
  await page.locator('.issue-row').filter({ hasText: 'project-a remembered issue' }).click();
  await app.evaluate(async () => { while (!globalThis.navigationDetailFixture.releaseComments) await new Promise(resolve => setTimeout(resolve, 10)); });
  await page.locator('#live-reply').fill('Draft while own comments are still loading');
  const loadingPosition = await scroll(540);
  await nav('设置').click();
  await app.evaluate(() => { globalThis.navigationDetailFixture.commentRevision = 3; });
  await nav('问题').click();
  await page.locator('.conversation').filter({ hasText: 'Comment 1 on project-a revision 3' }).waitFor();
  assert.equal(await page.locator('#live-reply').inputValue(), 'Draft while own comments are still loading');
  await assertScroll(loadingPosition, 'Pending issue read restoration must retain the reading position.');
  await app.evaluate(() => { globalThis.navigationDetailFixture.releaseComments(); });
  await app.evaluate(async () => { while (!globalThis.navigationDetailFixture.completedCommentRevisions.includes(2)) await new Promise(resolve => setTimeout(resolve, 10)); });
  await page.waitForTimeout(120);
  assert.doesNotMatch(await page.locator('.conversation').innerText(), /revision 2/);
  assert.match(await page.locator('.conversation').innerText(), /Comment 1 on project-a revision 3/);
  completed.push('pending-own-comments-reloaded-and-late-result-discarded');
  }

  if (onlyPendingCase !== 'comments') {
  await nav('首页').click();
  await app.evaluate(() => { const fixture = globalThis.navigationDetailFixture; fixture.readmeRevision = 2; fixture.delayNextReadme = true; fixture.releaseReadme = null; });
  await page.locator('.home-project-row').filter({ hasText: 'project-a' }).getByRole('button', { name: '打开项目', exact: true }).click();
  await page.locator('.detail-hero h1').filter({ hasText: 'project-a' }).waitFor();
  await app.evaluate(async () => { while (!globalThis.navigationDetailFixture.releaseReadme) await new Promise(resolve => setTimeout(resolve, 10)); });
  await nav('设置').click();
  await app.evaluate(() => { globalThis.navigationDetailFixture.readmeRevision = 3; });
  await nav('我的项目').click();
  await page.locator('.readme-markdown').filter({ hasText: 'README for project-a revision 3' }).waitFor();
  await app.evaluate(() => { globalThis.navigationDetailFixture.releaseReadme(); });
  await app.evaluate(async () => { while (!globalThis.navigationDetailFixture.completedReadmeRevisions.includes(2)) await new Promise(resolve => setTimeout(resolve, 10)); });
  await page.waitForTimeout(120);
  assert.equal(await page.locator('.detail-hero h1').innerText(), 'project-a');
  assert.match(await page.locator('.readme-markdown').innerText(), /README for project-a revision 3/);
  assert.doesNotMatch(await page.locator('.readme-markdown').innerText(), /revision 2/);
  completed.push('pending-project-introduction-reloaded-and-late-result-discarded');
  }

  // Every Back step follows its actual origin, including the scoped issue list.
  await nav('首页').click();
  await page.locator('.home-dashboard').waitFor();
  const homePosition = await scroll(120);
  await page.locator('.home-project-row').filter({ hasText: 'project-a' }).getByRole('button', { name: '打开项目', exact: true }).click();
  await page.locator('.detail-hero h1').filter({ hasText: 'project-a' }).waitFor();
  await page.getByRole('button', { name: '查看问题', exact: true }).click();
  await page.locator('.filter-project').filter({ hasText: 'project-a' }).waitFor();
  await page.locator('.issue-row').filter({ hasText: 'project-a remembered issue' }).click();
  await page.locator('#live-reply').waitFor();
  await page.locator('.back-link').evaluate(node => node.click());
  assert.match(await page.locator('.filter-project').innerText(), /project-a/, 'Back restores the project-scoped issue list.');
  await page.locator('.issue-row').filter({ hasText: 'project-a remembered issue' }).waitFor();
  await page.locator('.back-link').evaluate(node => node.click());
  await page.locator('.detail-hero h1').filter({ hasText: 'project-a' }).waitFor();
  await page.locator('.back-link').evaluate(node => node.click());
  await page.locator('.home-dashboard').waitFor();
  await assertScroll(homePosition, 'The complete issue Back chain restores its Home origin position.');
  completed.push('own-home-project-issues-detail-back-chain');

  assert.deepEqual(errors, []);
  assert.deepEqual(await app.evaluate(() => globalThis.navigationDetailFixture.blocked), []);
  assert.deepEqual(await app.evaluate(() => globalThis.rejectedNavigationIPC), []);
  await page.screenshot({ path: join(output, packaged ? 'packaged-restored-issues.png' : 'restored-issues.png') });
  await writeFile(join(output, packaged ? 'packaged-result.json' : 'result.json'), JSON.stringify({ passed: true, completed, requests: await app.evaluate(() => globalThis.navigationDetailFixture.requests) }, null, 2));
  process.stdout.write('Detailed sidebar navigation regression passed: public issue/tab/scroll, own issue/context/draft/scroll, and pending read restoration.\n');
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => undefined);
  await writeFile(join(output, 'failure.json'), JSON.stringify({ completed, error: error.message, lastExpectedScroll, readingPosition: await page.locator('.main-column').evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight })), requests: await app.evaluate(() => globalThis.navigationDetailFixture.requests) }, null, 2));
  throw error;
} finally { await app.close(); }
