import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

// Real signed-in renderer, isolated profile, default-deny IPC and no network.
const desktop = dirname(fileURLToPath(import.meta.url));
const output = join(desktop, 'out', 'program-review-notice-smoke');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, 'isolated-'));
const profile = join(directory, 'profile');
await mkdir(profile);
const preload = await readFile(join(desktop, 'src', 'preload', 'index.ts'), 'utf8');
const channels = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\(([^,\r\n]*)/g)].map(match => {
  const literal = /^'(easyhub:[^']+)'\s*\)?\s*$/.exec(match[1]);
  assert.ok(literal, 'Every preload invoke must be explicitly covered by the fixture.');
  return literal[1];
}))];
assert.ok(channels.length > 40);
const executableArgument = process.argv.find(value => value.startsWith('--executable='));
const executable = executableArgument?.slice('--executable='.length)
  ?? (process.argv.includes('--packaged') ? join(desktop, 'release', 'win-unpacked', 'EasyHub.exe') : null);
if (executableArgument) assert.ok(isAbsolute(executable), '--executable must be an absolute path.');
const baseline = process.argv.includes('--baseline');
const preferenceKey = 'easyhub:program-review-install-prompts:v1';
const preferenceEvent = 'easyhub:program-review-notice-changed';
const componentStatusEvent = 'easyhub:program-review-components-changed';
const launcher = join(directory, 'launch.cjs');
if (!executable) await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Program review notice fixture</title>';
globalThis.programNoticeRegister = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => globalThis.programNoticeRegister(channel, channel.startsWith('easyhub:') ? () => {
  throw new Error('Unmocked program notice fixture IPC: ' + channel);
} : handler);
require(${JSON.stringify(join(desktop, 'out', 'main', 'index.js'))});
`, 'utf8');

const started = Date.now();
let checks = 0;
const check = (condition, label) => { checks++; assert.ok(condition, label); };
const app = await electron.launch({ executablePath: executable || electronPath,
  args: executable ? ['--user-data-dir=' + profile] : [launcher], cwd: desktop,
  env: { ...process.env, EASYHUB_PROXY_APP_ONLY_TEST: '1' } });
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await app.evaluate(({ BrowserWindow, ipcMain, session }, channels) => {
    const renderer = BrowserWindow.getAllWindows()[0].webContents;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
    const register = globalThis.programNoticeRegister ?? ipcMain.handle.bind(ipcMain);
    const fixture = globalThis.programNoticeFixture = { forbidden: [], reads: [], statusCalls: 0, reviews: [], mode: 'missing', pending: [] };
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      register(channel, (event, ...args) => {
        if (event.sender !== renderer) throw new Error('Unexpected fixture renderer');
        return handler(event, ...args);
      });
    };
    for (const channel of channels) mock(channel, () => {
      fixture.forbidden.push(channel);
      throw new Error('Write or unknown program notice fixture IPC blocked: ' + channel);
    });
    const now = new Date().toISOString();
    const repository = { id: 7981, name: 'notice-project', full_name: 'notice-owner/notice-project', description: 'Isolated review fixture.',
      private: false, archived: false, owner: { login: 'notice-owner', avatar_url: '' }, default_branch: 'main', updated_at: now,
      pushed_at: now, permissions: { pull: true, push: true, admin: true }, open_issues_count: 0, stargazers_count: 1 };
    const file = (filename, status = 'added', patch) => ({ filename, status, additions: patch ? 1 : 0, deletions: 0,
      sha: 'c'.repeat(40), ...(patch ? { patch } : {}) });
    const text = file('src/check.ts', 'modified', '@@ -1 +1 @@\n-old()\n+new()');
    const program = file('bin/helper.dll');
    const cases = [
      { title: 'Mixed changes', files: [text, program] },
      { title: 'Program only', files: [program] },
      { title: 'Text only', files: [text] },
      { title: 'Deleted program', files: [file('bin/deleted.exe', 'removed')] },
      { title: 'Empty program', files: [{ ...file('bin/empty.exe'), sha: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' }] },
      { title: 'Text program patch', files: [file('bin/text.bin', 'modified', '@@ -1 +1 @@\n-old\n+new')] },
    ];
    const requests = cases.map((item, index) => ({ id: 79000 + index, number: index + 1, title: item.title, body: 'Check these changes.',
      state: 'open', draft: false, merged: false, merged_at: null, created_at: now,
      html_url: `https://github.com/notice-owner/notice-project/pull/${index + 1}`, user: { login: 'contributor' }, comments: 0,
      changed_files: item.files.length, head: { ref: 'change', label: 'contributor:change', sha: String(index + 1).repeat(40) },
      base: { ref: 'main', sha: 'a'.repeat(40) } }));
    mock('easyhub:auth-status', () => ({ user: { login: 'notice-owner', name: 'Notice Fixture', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => []);
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:ai-cancel-review', () => undefined);
    mock('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'fixture-model', hasApiKey: true }));
    mock('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    mock('easyhub:binary-analysis-status', () => {
      fixture.statusCalls++;
      if (fixture.mode === 'failure') throw new Error('Fixture status is unavailable.');
      if (fixture.mode === 'pending') return new Promise(resolve => fixture.pending.push(resolve));
      return { installed: fixture.mode === 'ready', state: fixture.mode === 'ready' ? 'ready' : 'missing', engineVersion: '12.1.2' };
    });
    mock('easyhub:ai-review-pull', async (_event, input) => {
      fixture.reviews.push(input);
      assertConsent(input);
      return { headSha: input.headSha, summary: input.language === 'en' ? 'Text reviewed; program skipped.' : '已审查文本修改，程序文件已跳过。',
        reviewedFiles: 1, totalFiles: 2, findings: [], limitations: [input.language === 'en'
          ? 'bin/helper.dll: Program review components are not installed; this file was not reviewed.'
          : 'bin/helper.dll：程序文件审查组件未安装，本次未审查。'] };
    });
    function assertConsent(input) {
      if (!input.consentToSend || input.providerBaseUrl !== 'https://api.openai.com/v1') throw new Error('Explicit AI consent is required.');
    }
    mock('easyhub:github', (_event, action, ...args) => {
      fixture.reads.push(action);
      if (action === 'repos') return args[0] === 1 ? [repository] : [];
      if (action === 'activityCounts') return { 7981: { issues: 0, closedIssues: 0, pullRequests: 6, closedPullRequests: 0 } };
      if (action === 'readme') return '# Notice project\n\nReview fixture.';
      if (action === 'isStarred') return false;
      if (action === 'releases' || action === 'issues' || action === 'commits' || action === 'comments' || action === 'starredRepos') return [];
      if (action === 'issuesPage' || action === 'releasesPage' || action === 'commentsPage') return { items: [], nextPage: null };
      if (action === 'pullRequests' || action === 'pullRequestsPage') return requests;
      if (action === 'pullRequest') return requests.find(request => request.number === args[2]);
      if (action === 'pullChecks') return { headSha: args[3].headSha, checkRuns: { state: 'available', items: [], nextPage: null }, statuses: { state: 'available', items: [], nextPage: null } };
      if (action === 'pullReviewContext') return { repository, pullRequest: requests.find(request => request.number === args[2]),
        filesTruncated: false, files: cases[args[2] - 1].files };
      fixture.forbidden.push('github:' + action);
      throw new Error('Write or unexpected GitHub action: ' + action);
    });
  }, channels);
  const page = await app.firstWindow();
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (!executable) await app.evaluate(async ({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].loadFile(file), join(desktop, 'out', 'renderer', 'index.html'));
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('easyhub:language', 'zh'); localStorage.setItem('easyhub:auto-translate', 'false');
  });
  await page.reload();
  const panel = page.locator('.pull-requests-panel');
  const componentNotice = panel.locator('.program-review-component-notice');
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const openProject = async () => {
    await page.locator('.live-connected').waitFor();
    await page.locator('.sidebar-nav').getByRole('button', { name: /^(我的项目|My Projects)$/ }).click();
    await page.getByRole('button', { name: /我的云端项目|Cloud Projects/ }).click();
    await page.locator('.cloud-row').filter({ hasText: 'notice-project' }).getByRole('button', { name: /^(查看|View)$/ }).click();
    await page.getByRole('button', { name: /^(查看问题|View Issues)$/ }).click();
    await page.getByRole('tab', { name: /合并请求审查|Pull Request Review/ }).click();
    const rememberedRequest = panel.getByRole('button', { name: /^(返回合并请求审查|Back to Pull Request Reviews)$/ });
    if (await rememberedRequest.isVisible()) await rememberedRequest.click();
    await panel.locator('.public-list-row').first().waitFor();
  };
  const openRequest = async title => {
    await panel.locator('.public-list-row').filter({ hasText: title }).click();
    await panel.locator('.pull-file-change').first().waitFor();
    await panel.getByRole('button', { name: /^(AI 审查|AI review)$/ }).waitFor();
    await settle();
  };
  const back = () => panel.getByRole('button', { name: /^(返回合并请求审查|Back to Pull Request Reviews)$/ }).click();
  const mode = async value => app.evaluate((_electron, value) => { globalThis.programNoticeFixture.mode = value; }, value);
  await openProject();
  await openRequest('Mixed changes');
  await page.screenshot({ path: join(output, baseline ? 'before-missing-zh.png' : 'after-missing-zh.png') });
  if (baseline) {
    const before = { notices: await componentNotice.count(), files: await panel.locator('.pull-file-change').count(),
      reviews: await app.evaluate(() => globalThis.programNoticeFixture.reviews.length),
      statusCalls: await app.evaluate(() => globalThis.programNoticeFixture.statusCalls) };
    await writeFile(join(output, 'before.json'), JSON.stringify(before, null, 2));
    check(before.notices === 1, 'Missing components must show a nonmodal installation notice before review.');
  } else {
    await componentNotice.waitFor();
    check(await page.getByRole('dialog').count() === 0, 'Viewing a program change never opens an installation popup.');
    check(await componentNotice.getByRole('button', { name: /前往安装|安装组件/ }).count() === 1, 'Notice offers the component settings destination.');
    check(await componentNotice.getByRole('button', { name: /永久忽略/ }).count() === 1, 'Notice offers persistent suppression.');
    check(await app.evaluate(() => globalThis.programNoticeFixture.reviews.length) === 0, 'Showing the notice must not trigger AI.');
    const missingReadCount = await app.evaluate(() => globalThis.programNoticeFixture.statusCalls);
    await back();
    for (const title of ['Text only', 'Deleted program', 'Empty program', 'Text program patch']) {
      await openRequest(title);
      check(await componentNotice.count() === 0, `${title} must not ask for program components.`);
      await back();
    }
    check(await app.evaluate(() => globalThis.programNoticeFixture.statusCalls) === missingReadCount, 'Nonprogram changes do not check or prompt for program components.');
    await mode('ready');
    await openRequest('Program only');
    await page.waitForTimeout(80);
    check(await componentNotice.count() === 0, 'Installed components do not show an install reminder.');
    await back();
    await mode('failure');
    await openRequest('Program only');
    await page.waitForTimeout(80);
    check(await componentNotice.count() === 0, 'Status read failure must not be reported as missing components.');
    await back();
    await mode('pending');
    await openRequest('Program only');
    check(await app.evaluate(() => globalThis.programNoticeFixture.pending.length) === 1, 'The delayed status request is active.');
    await back();
    await mode('ready');
    await openRequest('Mixed changes');
    await page.waitForTimeout(80);
    await app.evaluate(() => { const f = globalThis.programNoticeFixture; for (const resolve of f.pending.splice(0)) resolve({ installed: false, state: 'missing', engineVersion: '12.1.2' }); });
    await settle();
    check(await componentNotice.count() === 0, 'A late missing status cannot override a newer request with installed components.');
    await back();
    await mode('pending');
    await openRequest('Program only');
    await back();
    await mode('ready');
    await openRequest('Text only');
    await app.evaluate(() => { const f = globalThis.programNoticeFixture; for (const resolve of f.pending.splice(0)) resolve({ installed: false, state: 'missing', engineVersion: '12.1.2' }); });
    await settle();
    check(await componentNotice.count() === 0, 'A late missing status from a previous request cannot appear in a new text request.');
    await back();
    await mode('missing');
    await openRequest('Mixed changes');
    await componentNotice.waitFor();
    await componentNotice.getByRole('button', { name: /永久忽略/ }).click();
    await componentNotice.waitFor({ state: 'hidden' });
    await panel.getByRole('button', { name: 'AI 审查', exact: true }).click();
    const consent = page.getByRole('dialog', { name: '使用 AI 审查这次改进？', exact: true });
    await consent.waitFor();
    check(await app.evaluate(() => globalThis.programNoticeFixture.reviews.length) === 0, 'Permanent ignore must not bypass explicit AI consent.');
    await consent.getByRole('button', { name: '取消', exact: true }).click();
    check(await app.evaluate(() => globalThis.programNoticeFixture.reviews.length) === 0, 'Canceling consent still prevents AI requests.');
    await panel.getByRole('button', { name: 'AI 审查', exact: true }).click();
    await consent.getByRole('button', { name: '同意并开始审查', exact: true }).click();
    const report = panel.getByRole('region', { name: 'AI 审查结果', exact: true });
    await report.getByText('已审查文本修改，程序文件已跳过。', { exact: true }).waitFor();
    check(await report.getByText('bin/helper.dll：程序文件审查组件未安装，本次未审查。', { exact: true }).count() === 1,
      'Suppression only hides the reminder; skipped program files stay in review coverage.');
    check(await app.evaluate(() => globalThis.programNoticeFixture.reviews.length) === 1, 'One consent results in one combined review.');
    await back();
    await openRequest('Program only');
    await page.waitForTimeout(80);
    check(await componentNotice.count() === 0, 'Ignore applies to subsequent program requests.');
    await page.reload();
    await openProject();
    await openRequest('Program only');
    await page.waitForTimeout(80);
    check(await componentNotice.count() === 0, 'Permanent ignore survives renderer reload.');
    await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click();
    const ordinarySettingsToggle = page.locator('.binary-settings-panel').getByRole('button', { name: /程序文件审查/ });
    check(await ordinarySettingsToggle.getAttribute('aria-expanded') === 'false', 'Ordinary settings navigation keeps the optional component section collapsed.');
    await ordinarySettingsToggle.click();
    const restore = page.getByRole('checkbox', { name: '显示组件安装提示', exact: true });
    await restore.waitFor();
    check(await restore.isChecked() === false, 'Settings accurately reflect persistent ignore.');
    await restore.check();
    check(await restore.isChecked(), 'The user can restore future installation notices.');
    await page.evaluate(key => {
      localStorage.setItem(key, 'false');
      window.dispatchEvent(new StorageEvent('storage', { key: 'easyhub:unrelated-setting', storageArea: localStorage }));
    }, preferenceKey);
    await settle();
    check(await restore.isChecked(), 'Storage changes for unrelated preferences do not alter the component notice toggle.');
    await page.evaluate(key => window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'false', storageArea: localStorage })), preferenceKey);
    await settle();
    check(await restore.isChecked() === false, 'A relevant storage event synchronizes the component preference.');
    await page.evaluate(key => {
      localStorage.removeItem(key);
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    }, preferenceKey);
    await settle();
    check(await restore.isChecked(), 'Storage clear events restore the enabled default.');
    await page.evaluate(({ key, event }) => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'false', storageArea: sessionStorage }));
      window.dispatchEvent(new CustomEvent(event, { detail: { enabled: 'false' } }));
    }, { key: preferenceKey, event: preferenceEvent });
    await settle();
    check(await restore.isChecked(), 'Other storage areas and malformed preference events are ignored.');
    await openProject();
    await openRequest('Program only');
    await componentNotice.waitFor();
    check(await componentNotice.count() === 1, 'Restoring the setting displays missing-component notices again.');
    await page.evaluate(({ key, event }) => {
      localStorage.setItem(key, 'false');
      window.dispatchEvent(new CustomEvent(event, { detail: { enabled: false } }));
    }, { key: preferenceKey, event: preferenceEvent });
    await componentNotice.waitFor({ state: 'hidden' });
    check(await componentNotice.count() === 0, 'Same-window preference changes immediately hide the current notice.');
    await page.evaluate(({ key, event }) => {
      localStorage.setItem(key, 'true');
      window.dispatchEvent(new CustomEvent(event, { detail: { enabled: true } }));
    }, { key: preferenceKey, event: preferenceEvent });
    await componentNotice.waitFor();
    check(await componentNotice.count() === 1, 'Same-window restoration immediately restores the current notice.');
    await mode('ready');
    await page.evaluate(event => window.dispatchEvent(new Event(event)), componentStatusEvent);
    await componentNotice.waitFor({ state: 'hidden' });
    check(await componentNotice.count() === 0, 'Successful component installation removes the current prompt after authoritative status refresh.');
    await mode('missing');
    await page.evaluate(event => window.dispatchEvent(new Event(event)), componentStatusEvent);
    await componentNotice.waitFor();
    check(await componentNotice.count() === 1, 'Component removal is reflected without reopening the current request.');
    for (const language of ['zh', 'en']) for (const width of [1060, 1440]) for (const layout of ['comfortable', 'compact']) {
      await page.evaluate(({ language, layout }) => {
        localStorage.setItem('easyhub:language', language); localStorage.setItem('easyhub:layout-preference', layout);
      }, { language, layout });
      await page.setViewportSize({ width, height: width === 1060 ? 700 : 900 });
      await page.reload();
      await openProject();
      await openRequest('Mixed changes');
      await componentNotice.waitFor();
      const geometry = await componentNotice.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const panel = element.closest('.pull-requests-panel').getBoundingClientRect();
        const actions = [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect());
        return { fits: element.scrollWidth <= element.clientWidth + 1 && rect.right <= panel.right + 1,
          actionsFit: actions.every(button => button.left >= rect.left - 1 && button.right <= rect.right + 1),
          text: element.innerText };
      });
      check(geometry.fits && geometry.actionsFit, `${language}/${width}/${layout}: component notice and buttons fit without overflow.`);
      check(language === 'en' ? !/[\u3400-\u9fff]/u.test(geometry.text) : /组件/.test(geometry.text), `${language}: component reminder uses the current language.`);
      await componentNotice.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, `after-${language}-${width}-${layout}.png`) });
    }
    await componentNotice.getByRole('button', { name: /Go to install|Install components/ }).click();
    const programSettingsToggle = page.locator('.binary-settings-panel').getByRole('button', { name: /Program file review/ });
    await programSettingsToggle.waitFor();
    check(await programSettingsToggle.getAttribute('aria-expanded') === 'true', 'The installation shortcut opens the component section directly.');
    await page.getByRole('checkbox', { name: 'Show component installation prompts', exact: true }).waitFor();
    check(await page.locator('.binary-analysis-panel').count() > 0, 'The install action opens component settings without installing automatically.');
    check(await page.locator('.binary-analysis-panel').getByRole('button', { name: 'Install components', exact: true }).isVisible(),
      'The install action exposes the install button immediately.');
    await settle();
    check(await programSettingsToggle.evaluate(element => element === document.activeElement), 'A fresh component settings target receives keyboard focus.');
    await programSettingsToggle.click();
    check(await programSettingsToggle.getAttribute('aria-expanded') === 'false', 'The user can collapse the component settings section.');
    await openProject();
    await openRequest('Mixed changes');
    await componentNotice.waitFor();
    await componentNotice.getByRole('button', { name: 'Install components', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Show component installation prompts', exact: true }).waitFor();
    await settle();
    check(await programSettingsToggle.getAttribute('aria-expanded') === 'true', 'A repeated shortcut reopens a previously collapsed component settings section.');
    check(await programSettingsToggle.evaluate(element => element === document.activeElement), 'A repeated component settings target receives keyboard focus.');
  }
  const fixtureState = await app.evaluate(() => ({ forbidden: globalThis.programNoticeFixture.forbidden, reviews: globalThis.programNoticeFixture.reviews,
    statusCalls: globalThis.programNoticeFixture.statusCalls }));
  check(fixtureState.forbidden.length === 0, `All unexpected/writing IPC remains blocked: ${JSON.stringify(fixtureState.forbidden)}`);
  check(errors.length === 0, `Renderer errors: ${JSON.stringify(errors)}`);
  await writeFile(join(output, 'result.json'), JSON.stringify({ checks, milliseconds: Date.now() - started, statusCalls: fixtureState.statusCalls,
    reviews: fixtureState.reviews.length, errors, forbidden: fixtureState.forbidden, channels: channels.length }, null, 2));
  process.stdout.write(`Program review installation reminder: ${checks} checks passed; consent and coverage retained; isolated ${channels.length}-channel fixture.\n`);
} finally {
  await app.close();
}
