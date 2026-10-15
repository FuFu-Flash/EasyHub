import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(desktopDirectory, 'out', 'source-history-smoke');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'isolated-'));
const profileDirectory = join(runDirectory, 'profile');
await mkdir(profileDirectory);
const preload = await readFile(join(desktopDirectory, 'src', 'preload', 'index.ts'), 'utf8');
const bridgeChannels = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\(([^,\r\n]*)/g)].map(match => {
  const channel = /^'(easyhub:[^']+)'\s*\)?\s*$/.exec(match[1]);
  assert.ok(channel, 'Every exposed IPC invocation must use a known literal channel before this fixture can isolate it.');
  return channel[1];
}))];
assert.ok(bridgeChannels.length >= 40, 'The fixture must discover the full EasyHub IPC bridge.');
const executableArgument = process.argv.find(value => value.startsWith('--executable='));
const executable = executableArgument?.slice('--executable='.length)
  ?? (process.argv.includes('--packaged') ? join(desktopDirectory, 'release', 'win-unpacked', 'EasyHub.exe') : null);
if (executableArgument && (!executable || !isAbsolute(executable))) throw new Error('--executable requires an absolute path.');
const launcher = join(runDirectory, 'launch.cjs');
if (!executable) await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profileDirectory)});
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Isolated layout fixture</title>';
globalThis.layoutRegisterMock = ipcMain.handle.bind(ipcMain);
globalThis.layoutRejectedIpc = [];
ipcMain.handle = (channel, handler) => globalThis.layoutRegisterMock(channel, channel.startsWith('easyhub:') ? () => {
  globalThis.layoutRejectedIpc.push(channel);
  throw new Error('Unmocked isolated layout fixture IPC: ' + channel);
} : handler);
require(${JSON.stringify(join(desktopDirectory, 'out', 'main', 'index.js'))});
`, 'utf8');

const started = Date.now();
const app = await electron.launch({ executablePath: executable || electronPath,
  args: executable ? ['--user-data-dir=' + profileDirectory] : [launcher], cwd: desktopDirectory,
  env: { ...process.env, EASYHUB_PROXY_APP_ONLY_TEST: '1' } });
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profileDirectory);
  await app.evaluate(({ BrowserWindow, ipcMain, session }, bridgeChannels) => {
    const renderer = BrowserWindow.getAllWindows()[0].webContents;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const register = globalThis.layoutRegisterMock ?? ipcMain.handle.bind(ipcMain);
    const fixture = globalThis.layoutFixture = { forbidden: [], reads: [], repositories: [], localLinks: [] };
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      register(channel, (event, ...args) => {
        if (event.sender !== renderer) throw new Error('Fixture bridge called from another renderer');
        return handler(...args);
      });
    };
    // Deny every exposed real handler first, including packaged executables; allow only the explicit local reads below.
    for (const channel of bridgeChannels) mock(channel, () => {
      fixture.forbidden.push(channel);
      throw new Error('External and write actions are blocked by this layout fixture: ' + channel);
    });
    const now = new Date().toISOString();
    const repository = (id, name) => ({ id, name, full_name: `layout-fixture/${name}`, description: 'Windows/Android GitHub client for newbies: Publish source code and releases on Windows, manage issues, pull request reviews, and support AI code reviews. Beginner-friendly GitHub client for Windows desktop and Android: source publishing, release management, issues, pull request reviews and optional AI code review.',
      private: false, archived: false, owner: { login: 'layout-fixture', avatar_url: '' }, default_branch: 'main', updated_at: now, pushed_at: now,
      permissions: { pull: true, push: true, admin: true }, open_issues_count: 1, stargazers_count: 3, language: 'TypeScript' });
    const longName = 'EasyHub' + 'UnbrokenRepositoryName'.repeat(4);
    const repos = [repository(4201, 'layout-project-with-a-readable-name'),
      { ...repository(4202, longName), description: 'UnbrokenDescription'.repeat(18).slice(0, 350) },
      { ...repository(4203, 'layout-without-description'), description: null },
      repository(4204, 'Local' + 'UnbrokenRepositoryName'.repeat(4))];
    const publicOwner = { login: 'other-layout-fixture', avatar_url: '' };
    const publicRepos = [
      { ...repository(4301, 'public-long-description'), owner: { ...publicOwner, avatar_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1cAAAAASUVORK5CYII=' } },
      { ...repository(4302, longName), owner: publicOwner, description: 'UnbrokenDescription'.repeat(18).slice(0, 350) },
      { ...repository(4303, 'public-without-description'), owner: publicOwner, description: null },
    ].map(repo => ({ ...repo, full_name: `${repo.owner.login}/${repo.name}`, permissions: { pull: true, push: false, admin: false } }));
    fixture.repositories = [...repos, ...publicRepos];
    fixture.localLinks = [{ id: 'layout-local', repositoryId: repos[3].id, owner: 'layout-fixture', name: repos[3].name,
      localPath: `C:\\Projects\\${repos[3].name}\\${'local-path-segment-'.repeat(3)}`, lastOpenedAt: now }];
    const issue = { id: 42011, number: 1, title: 'Fixture issue with a readable title', body: 'A read-only fixture discussion.', state: 'open',
      created_at: now, user: { login: 'fixture-author' }, comments: 0 };
    mock('easyhub:auth-status', () => ({ user: { login: 'layout-fixture', name: 'Layout Fixture', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => fixture.localLinks);
    mock('easyhub:local-status', () => ({ files: [], needsReview: false }));
    mock('easyhub:local-check-sync', () => ({ state: 'current', files: [] }));
    mock('easyhub:local-read-introduction', () => '# Local fixture\n\nA local project introduction remains available.\n\n'
      + '| Long value | Notes |\n| --- | --- |\n| ' + 'T'.repeat(210) + ' | A table scrolls in its own area. |\n\n'
      + '```text\n' + 'C'.repeat(350) + '\n```');
    mock('easyhub:local-preview-changes', () => ({ files: [], needsReview: false, snapshot: 'layout-read-only-snapshot' }));
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false }));
    mock('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    mock('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', engineVersion: '12.1.2' }));

    fixture.aiRequests = []; fixture.aiCancelled = []; fixture.aiConfigured = true;
    mock('easyhub:ai-settings', () => ({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', hasApiKey: fixture.aiConfigured }));
    mock('easyhub:ai-explain-commit', input => { fixture.aiRequests.push(input); if (fixture.aiPaused) return new Promise(resolve => { fixture.finishAi = resolve; }); return { explanation: '# 改动说明\n\n删除 old，增加 new。', model: 'deepseek-chat', includedFiles: 3, partial: true }; });
    mock('easyhub:ai-cancel-review', id => { fixture.aiCancelled.push(id); fixture.finishAi?.({ explanation: 'Late answer must stay hidden', model: 'deepseek-chat', includedFiles: 1, partial: false }); });
    const sha = index => index.toString(16).padStart(40, '0');
    const historyCommit = index => ({ sha: sha(index), commit: { message: 'Commit ' + index, author: { name: 'History Author', date: now } }, author: { login: 'history-author' } });
    fixture.retry = true;
    mock('easyhub:github', (action, ...args) => {
      if (action === 'branchesPage') return { items: ['main', 'dev', 'empty', 'retry'].map(name => ({ name, commit: { sha: sha(1) }, protected: false })), nextPage: null };
      if (action === 'sourceHistory') {
        const query = args[2]; fixture.reads.push({ action, owner: args[0], branch: query.branch, path: query.path, page: query.page });
        if (query.branch === 'retry' && fixture.retry) { fixture.retry = false; throw new Error('History fixture retry'); }
        if (query.branch === 'empty') return { items: [], nextPage: null };
        if (query.branch === 'dev') return { items: [historyCommit(201)], nextPage: null };
        if (query.path) return { items: [historyCommit(301)], nextPage: null };
        return { items: query.page === 1 ? Array.from({ length: 100 }, (_, index) => historyCommit(index + 1)) : [historyCommit(101)], nextPage: query.page === 1 ? 2 : null };
      }
      if (action === 'commitChangesPage') {
        const commit = historyCommit(parseInt(args[2], 16));
        return { commit: { ...commit, stats: { additions: 2, deletions: 1 }, files: args[3] === 1 ? [
          { filename: 'src/main.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' },
          { filename: 'binary.exe', status: 'added', additions: 0, deletions: 0 },
          { filename: 'src/' + 'long-name-'.repeat(35) + '.ts', previous_filename: 'old-name.ts', status: 'renamed', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+renamed' }
        ] : [{ filename: 'second-page.ts', status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+second' }] }, nextPage: args[3] === 1 ? 2 : null, limited: false };
      }

      fixture.reads.push(action);
      if (action === 'repos') return args[0] === 1 ? repos : [];
      if (action === 'searchPublicReposPage') return { items: publicRepos, totalCount: publicRepos.length, hasNextPage: false };
      if (action === 'trending') return { items: publicRepos, page: args[1] ?? 1, hasNextPage: false };
      if (action === 'repository' || action === 'publicRepo') {
        const repo = fixture.repositories.find(item => item.owner.login === args[0] && item.name === args[1]);
        if (!repo) throw new Error('Unknown read-only fixture repository');
        return repo;
      }
      if (action === 'activityCounts') return Object.fromEntries(fixture.repositories.map(repo => [repo.id,
        { issues: repo.id === 4201 ? 1 : 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }]));
      if (action === 'readme') return '# Layout fixture\n\nProject introductions and controls remain usable as the window changes size.';
      if (action === 'issuesPage') return { items: args[1] === repos[0].name ? [issue] : [], nextPage: null };
      if (action === 'isStarred') return args[0] === 'layout-fixture' && args[1] === repos[0].name;
      if (action === 'commits' || action === 'comments' || action === 'releases' || action === 'pullRequests') return [];
      if (action === 'releasesPage' || action === 'commentsPage' || action === 'pullRequestsPage') return { items: [], nextPage: null };
      fixture.forbidden.push('github:' + action);
      throw new Error('Unexpected mock GitHub action: ' + action);
    });
  }, bridgeChannels);
  const page = await app.firstWindow();
  page.setDefaultTimeout(12_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (!executable) await app.evaluate(async ({ BrowserWindow }, renderer) => { await BrowserWindow.getAllWindows()[0].loadFile(renderer); }, join(desktopDirectory, 'out', 'renderer', 'index.html'));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('easyhub-language', 'zh'); localStorage.setItem('easyhub-auto-translate', 'false'); });
  await page.reload();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const count = async (locator, number) => { await page.waitForFunction(({ selector, number }) => [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length).length === number, { selector: locator, number }); };
  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: /我的云端项目/ }).click();
  await page.locator('.cloud-row').first().getByRole('button', { name: '查看', exact: true }).click();
  const icon = page.getByRole('button', { name: '源码历史', exact: true });
  await icon.waitFor(); await settle();
  const location = await icon.evaluate(button => { const r = button.getBoundingClientRect(); const hero = button.closest('.detail-hero').getBoundingClientRect(); return { right: hero.right - r.right, top: r.top - hero.top, width: r.width }; });
  assert.ok(location.top < 15 && location.right < 15 && location.width >= 30, 'History icon sits in the requested top-right corner');
  await page.screenshot({ path: join(outputDirectory, 'own-project-icon.png') });
  await icon.click(); await count('.source-history-row', 100);
  await page.getByRole('button', { name: '加载更多提交', exact: true }).click(); await count('.source-history-row', 101);
  const row = page.getByRole('button', { name: /^Commit 30 / });
  await row.scrollIntoViewIfNeeded(); await settle();
  const before = await page.locator('.main-column').evaluate(element => element.scrollTop);
  await row.click(); await page.getByRole('button', { name: '解释改动', exact: true }).waitFor();
  const explain = page.getByRole('button', { name: '解释改动', exact: true });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '解释改动' && !button.disabled));
  await explain.click(); const dialog = page.getByRole('dialog', { name: '改动说明', exact: true }); await dialog.waitFor();
  assert.equal(await app.evaluate(() => globalThis.layoutFixture.aiRequests.length), 0, 'Opening confirmation does not incur an API call');
  await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent === '解释改动');
  await explain.click(); await dialog.getByRole('button', { name: '开始解释', exact: true }).click();
  await dialog.getByRole('heading', { name: '改动说明', exact: true, level: 1 }).waitFor();
  const sent = await app.evaluate(() => globalThis.layoutFixture.aiRequests[0]);
  assert.equal(sent.sha, (30).toString(16).padStart(40, '0')); assert.equal(sent.language, 'zh'); assert.equal(sent.consentToSend, true); assert.equal(sent.owner, 'layout-fixture');
  assert.ok(await dialog.getByText('说明仅覆盖已提供的改动', { exact: false }).isVisible());
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await explain.click(); await dialog.getByRole('heading', { name: '改动说明', exact: true, level: 1 }).waitFor(); assert.equal(await app.evaluate(() => globalThis.layoutFixture.aiRequests.length), 1, 'Opening an existing explanation does not request again');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.pull-file-toggle').filter({ hasText: 'src/main.ts' }).click();
  const diff = page.locator('.source-history-diff').first();
  await diff.waitFor(); assert.equal(await diff.evaluate(element => getComputedStyle(element).cursor), 'text');
  const selected = await diff.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element.querySelector('tbody')); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString(); });
  assert.ok(selected.includes('old') && selected.includes('new'), 'Entire diff accepts native selection');
  await page.locator('.pull-file-toggle').filter({ hasText: 'binary.exe' }).click();
  assert.ok(await page.getByText('GitHub 未提供文字差异', { exact: false }).isVisible(), 'Binary is not labeled as an empty text file');
  await page.getByRole('button', { name: '加载更多文件', exact: true }).click(); await page.locator('.pull-file-toggle').filter({ hasText: 'second-page.ts' }).waitFor();
  await page.getByRole('button', { name: '文件历史 src/main.ts', exact: true }).click(); await count('.source-history-row', 1);
  assert.equal(await page.locator('.source-history-path>span').textContent(), 'src/main.ts');
  await page.locator('.source-history-page>.back-link').click(); await page.locator('.pull-file-toggle').filter({ hasText: 'second-page.ts' }).waitFor();
  await page.locator('.source-history-page>.back-link').click(); await count('.source-history-row', 101); await settle();
  const restored = await page.locator('.main-column').evaluate(element => element.scrollTop); assert.ok(Math.abs(restored - before) < 5, `Return restores scroll: ${before} -> ${restored}`);
  const branch = async name => { await page.getByRole('combobox', { name: '选择分支' }).click(); await page.getByRole('option', { name, exact: true }).click(); };
  await branch('dev'); await count('.source-history-row', 1); await page.getByRole('button', { name: /^Commit 201 / }).waitFor();
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click(); await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: /^Commit 201 / }).waitFor(); assert.equal(await page.getByRole('combobox', { name: '选择分支' }).textContent(), 'dev');
  await branch('retry'); await page.getByRole('alert').filter({ hasText: 'History fixture retry' }).waitFor(); await page.getByRole('button', { name: '重试', exact: true }).click(); await count('.source-history-row', 100);
  await branch('empty'); await page.getByText('这个分支还没有提交记录。', { exact: true }).waitFor();
  await branch('dev'); await page.getByRole('button', { name: /^Commit 201 / }).click();
  await app.evaluate(() => { globalThis.layoutFixture.aiConfigured = false; });
  await explain.click(); await dialog.getByRole('alert').filter({ hasText: '请先在设置中连接你的 AI 服务。' }).waitFor(); await page.keyboard.press('Escape');
  await app.evaluate(() => { globalThis.layoutFixture.aiConfigured = true; globalThis.layoutFixture.aiPaused = true; });
  await explain.click(); await dialog.getByRole('button', { name: '开始解释', exact: true }).click(); await dialog.getByRole('button', { name: '取消说明', exact: true }).waitFor();
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate(() => globalThis.layoutFixture.aiCancelled.length), 1, 'Escape aborts the API operation');
  assert.equal(await page.getByText('Late answer must stay hidden', { exact: true }).count(), 0);
  await app.evaluate(() => { globalThis.layoutFixture.aiPaused = false; });
  const other = await app.evaluate(() => globalThis.layoutFixture.repositories.find(repo => repo.owner.login === 'other-layout-fixture'));
  await page.locator('.topbar-search input').fill(`https://github.com/${other.owner.login}/${other.name}`);
  await page.locator('.topbar-search input').press('Enter');
  await page.locator('.public-browser-hero').waitFor(); await icon.click(); await count('.source-history-row', 100);
  await page.getByRole('button', { name: /^Commit 1 / }).click(); await explain.waitFor();
  assert.equal(await page.getByRole('button', { name: '发布发行版', exact: true }).count(), 0);
  await page.setViewportSize({ width: 1060, height: 740 }); await settle();
  for (const button of await page.locator('.pull-file-toggle').all()) await button.click();
  assert.ok(await page.locator('.main-column').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Narrow page has no horizontal overflow');
  await page.screenshot({ path: join(outputDirectory, 'public-commit-compact.png') });
  await page.locator('.language-trigger').click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Explain changes', exact: true }).click();
  const englishDialog = page.getByRole('dialog', { name: 'Change explanation', exact: true });
  await englishDialog.getByRole('button', { name: 'Explain changes', exact: true }).click(); await englishDialog.getByRole('heading', { name: '改动说明', exact: true, level: 1 }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.layoutFixture.aiRequests.at(-1).language), 'en');
  assert.equal(await app.evaluate(() => globalThis.layoutFixture.aiRequests.at(-1).owner), 'other-layout-fixture');
  const outcome = await app.evaluate(() => ({ forbidden: [...globalThis.layoutFixture.forbidden, ...(globalThis.layoutRejectedIpc ?? [])], reads: globalThis.layoutFixture.reads, requests: globalThis.layoutFixture.aiRequests }));
  assert.deepEqual(outcome.forbidden, []); assert.deepEqual(errors, []);
  await writeFile(join(outputDirectory, executable ? 'packaged-results.json' : 'results.json'), JSON.stringify({ passed: true, durationMs: Date.now() - started, location, scroll: { before, restored }, ...outcome }, null, 2));
  console.log('Source history and AI explanation UI passed (isolated fixtures; no remote writes or paid API calls).');
} finally { await app.close(); }
