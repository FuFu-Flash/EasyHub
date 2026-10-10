import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchUpstreamFixture } from './upstream-smoke-runtime.mjs';

// Real LiveWorkspace renderer; every GitHub request is an in-memory fixture.
// Unknown IPC and all network traffic are blocked, so this cannot post a real reply.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out', 'issue-workspace-smoke');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, 'isolated-'));
const profile = join(directory, 'profile');
await mkdir(profile);
const { app, executable, renderer } = await launchUpstreamFixture(desktop, {
  profile: profile, launcher: join(directory, 'launch.cjs'),
  registerName: 'issueRegister', rejectedName: 'issueRejected', title: 'Issue regression fixture',
  allowedFlags: process.argv.slice(2).filter(value => value.startsWith('--case='))
});
const mode = process.argv.find(value => value.startsWith('--case='))?.slice(7) ?? 'all';
const failures = [];
try {
  await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
    const renderer = BrowserWindow.getAllWindows()[0].webContents;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const fixture = globalThis.issueFixture = { revision: 1, reads: [], forbidden: [], delayed: false, release: null, completed: [], externalLinks: [] };
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      globalThis.issueRegister(channel, (event, ...args) => {
        if (event.sender !== renderer) throw new Error('Unexpected renderer');
        return handler(...args);
      });
    };
    const now = new Date().toISOString();
    const repos = ['project-a', 'project-b'].map((name, index) => ({ id: 8101 + index, name, full_name: `issue-fixture/${name}`,
      description: 'Issue regression fixture', private: true, archived: false, owner: { login: 'issue-fixture', avatar_url: '' },
      default_branch: 'main', updated_at: now, pushed_at: now, permissions: { pull: true, push: true, admin: true }, open_issues_count: 2 }));
    const issue = (repo, number) => ({ id: repo.id * 10 + number, number, title: `${repo.name} issue ${number} revision ${fixture.revision}`,
      body: `Description for ${repo.name} issue ${number}\n\n[Issue reference](https://example.com/issue)`, state: 'open', created_at: now, user: { login: 'fixture-author' }, comments: 1 });
    mock('easyhub:auth-status', () => ({ user: { id: 81, login: 'issue-fixture', name: 'Issue Fixture', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:open-external-link', (url) => { fixture.externalLinks.push(url); });
    mock('easyhub:github', async (action, ...args) => {
      fixture.reads.push({ action, args });
      if (action === 'repos') return args[0] === 1 ? repos : [];
      if (action === 'activityCounts') return Object.fromEntries(repos.map(repo => [repo.id, { issues: 2, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }]));
      if (action === 'issuesPage') return { items: [issue(repos.find(repo => repo.name === args[1]), 1), issue(repos.find(repo => repo.name === args[1]), 2)], nextPage: null };
      if (action === 'comments') {
        if (fixture.delayed && args[1] === 'project-a' && args[2] === 1) await new Promise(resolve => { fixture.release = resolve; });
        fixture.completed.push(args[1] + '/' + args[2]);
        return [{ id: args[2], body: `Comment for ${args[1]} issue ${args[2]}\n\n[Comment reference](https://example.com/comment)`, created_at: now, user: { login: 'comment-author' } }];
      }
      if (action === 'searchDiscussions') return { items: [issue(repos.find(repo => repo.name === args[1]), 200)], page: 1, totalCount: 1, hasNextPage: false, incompleteResults: false };
      if (action === 'commits') return [];
      if (action === 'readme') return '# Fixture';
      fixture.forbidden.push(action);
      throw new Error('Write or unexpected GitHub action blocked: ' + action);
    });
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].loadFile(file), renderer);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('easyhub:language', 'zh'); localStorage.setItem('easyhub:auto-translate', 'false'); });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  const globalIssues = async () => {
    await page.locator('.sidebar-nav').getByRole('button', { name: /^问题/ }).click();
  };
  const expand = async name => {
    const header = page.locator('.issue-project-header').filter({ hasText: name });
    if (await header.getAttribute('aria-expanded') !== 'true') await header.click();
    await page.locator('.issue-project-group').filter({ hasText: name }).locator('.issue-row').first().waitFor();
  };
  const open = async (repo, number) => {
    await globalIssues();
    await expand(repo);
    await page.locator('.issue-row').filter({ hasText: `${repo} issue ${number}` }).click();
    await page.locator('#live-reply').waitFor();
  };
  const run = async (name, test) => {
    if (mode !== 'all' && mode !== name) return;
    try { await test(); process.stdout.write('PASS: ' + name + '\n'); }
    catch (error) { failures.push(name + ': ' + error.message); process.stdout.write('FAIL: ' + name + ': ' + error.message + '\n'); }
  };
  await run('refresh', async () => {
    await globalIssues(); await expand('project-b'); await expand('project-a');
    await app.evaluate(() => { globalThis.issueFixture.revision = 2; });
    await page.getByRole('button', { name: '刷新 GitHub 数据', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.sidebar-refresh').disabled);
    const titles = await page.locator('.issue-row').allTextContents();
    assert.ok(titles.some(value => value.includes('project-a issue 1 revision 2')), 'Refreshing the expanded group must replace its cached issue rows');
    assert.ok(!titles.some(value => value.includes('revision 1')), 'Old issue rows must not survive refresh');
    await expand('project-b');
    assert.ok((await page.locator('.issue-row').allTextContents()).some(value => value.includes('project-b issue 1 revision 2')), 'A previously cached collapsed group must be fetched again on expansion');
  });
  await run('drafts', async () => {
    await open('project-a', 1);
    await page.locator('#live-reply').fill('Draft for A1 only');
    await open('project-a', 2);
    assert.equal(await page.locator('#live-reply').inputValue(), '', 'Another issue must start with its own draft');
    await page.locator('#live-reply').fill('Draft for A2 only');
    await open('project-b', 1);
    assert.equal(await page.locator('#live-reply').inputValue(), '', 'The same issue number in another repository must not inherit a draft');
    await page.locator('#live-reply').fill('Draft for B1 only');
    await open('project-a', 1);
    assert.equal(await page.locator('#live-reply').inputValue(), 'Draft for A1 only', 'Returning to an issue must restore its draft');
    await open('project-a', 2);
    assert.equal(await page.locator('#live-reply').inputValue(), 'Draft for A2 only');
    await page.reload();
    await page.locator('.live-connected').waitFor();
    await open('project-a', 1);
    assert.equal(await page.locator('#live-reply').inputValue(), 'Draft for A1 only', 'Draft must survive renderer restart');
    await open('project-a', 2);
    assert.equal(await page.locator('#live-reply').inputValue(), 'Draft for A2 only');
  });
  await run('server-search', async () => {
    await globalIssues();
    assert.equal(await page.locator('.discussion-search input').count(), 0);
    await page.getByRole('button', { name: '搜索讨论', exact: true }).click();
    await page.locator('.discussion-search input').fill('#200');
    await page.locator('.discussion-search').getByRole('button', { name: '搜索', exact: true }).click();
    await page.locator('.discussion-search .public-list-row').filter({ hasText: 'issue 200' }).waitFor();
    const request = await app.evaluate(() => globalThis.issueFixture.reads.filter(item => item.action === 'searchDiscussions').at(-1));
    assert.equal(request.args[2].query, '#200'); assert.equal(request.args[2].kind, 'issue');
    await page.locator('.discussion-search .public-list-row').click();
    await page.locator('#live-reply').waitFor();
    assert.match(await page.locator('.issue-title h1').innerText(), /issue 200/);
    await page.getByRole('button', { name: '返回问题', exact: true }).click();
    assert.equal(await page.locator('.discussion-search input').inputValue(), '#200', 'Returning from a result preserves the search');
    await page.locator('.discussion-search .public-list-row').filter({ hasText: 'issue 200' }).waitFor();
    await page.getByRole('button', { name: '收起搜索', exact: true }).click();
  });
  await run('late-comments', async () => {
    await app.evaluate(() => { globalThis.issueFixture.delayed = true; globalThis.issueFixture.completed = []; });
    await open('project-a', 1);
    await app.evaluate(async () => { while (!globalThis.issueFixture.release) await new Promise(resolve => setTimeout(resolve, 10)); });
    await open('project-a', 2);
    await page.getByText('Comment for project-a issue 2', { exact: true }).waitFor();
    await app.evaluate(() => { globalThis.issueFixture.release(); });
    await app.evaluate(async () => { while (!globalThis.issueFixture.completed.includes('project-a/1')) await new Promise(resolve => setTimeout(resolve, 10)); });
    await page.waitForTimeout(120);
    assert.equal(await page.getByText('Comment for project-a issue 2', { exact: true }).count(), 1, 'A late response must not replace the current issue comments');
    assert.equal(await page.getByText('Comment for project-a issue 1', { exact: true }).count(), 0);
  });
  await run('links', async () => {
    await app.evaluate(() => { globalThis.issueFixture.delayed = false; });
    await open('project-a', 1);
    await page.getByRole('link', { name: 'Comment reference', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Issue reference', exact: true }).click({ noWaitAfter: true });
    await page.waitForTimeout(80);
    assert.deepEqual(await app.evaluate(() => globalThis.issueFixture.externalLinks), ['https://example.com/issue'], 'Issue body links must use the controlled external-link bridge');
    await page.getByRole('link', { name: 'Comment reference', exact: true }).click({ noWaitAfter: true });
    await page.waitForTimeout(80);
    assert.deepEqual(await app.evaluate(() => globalThis.issueFixture.externalLinks), ['https://example.com/issue', 'https://example.com/comment'], 'Issue and comment links must use the controlled external-link bridge');
    assert.ok(page.url().startsWith('file:'), 'Reading a link must not replace the privileged application page');
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(await app.evaluate(() => globalThis.issueFixture.forbidden), []);
  assert.deepEqual(await app.evaluate(() => globalThis.issueRejected), []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ failures, reads: await app.evaluate(() => globalThis.issueFixture.reads) }, null, 2));
  assert.deepEqual(failures, []);
} finally { await app.close(); }
