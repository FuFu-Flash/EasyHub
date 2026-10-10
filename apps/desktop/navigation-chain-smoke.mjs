import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { installDownloadFixture } from './download-fixture.mjs';

// The actual renderer and preload with deny-by-default IPC and blocked network.
// This checks detail/context retention without touching GitHub, credentials, or AI.
const desktop = dirname(fileURLToPath(import.meta.url));
const packaged = process.argv.includes('--packaged');
const chainCase = process.argv.find(value => value.startsWith('--case='))?.slice(7) ?? 'issue-release';
const programmaticScroll = process.argv.includes('--programmatic-scroll');
const product = packaged ? join(desktop, 'release', 'win-unpacked', 'resources', 'app.asar') : desktop;
const output = join(desktop, 'out', 'navigation-chain-smoke');
await mkdir(output, { recursive: true });
const run = await mkdtemp(join(output, 'isolated-'));
const launcher = join(run, 'launch.cjs');
await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(join(run, 'profile'))});
process.env.EASYHUB_PROXY_APP_ONLY_TEST = '1';
process.env.ELECTRON_RENDERER_URL = 'data:text/html,Navigation chain fixture';
globalThis.registerChainFixture = ipcMain.handle.bind(ipcMain);
globalThis.rejectedChainIPC = [];
ipcMain.handle = (channel, handler) => globalThis.registerChainFixture(channel, channel.startsWith('easyhub:') ? () => {
  globalThis.rejectedChainIPC.push(channel);
  throw new Error('Unexpected navigation fixture IPC: ' + channel);
} : handler);
require(${JSON.stringify(join(product, 'out', 'main', 'index.js'))});
`);
const app = await electron.launch({ executablePath: electronPath, args: [launcher], cwd: desktop });
const completed = [];
let lastExpectedScroll = null;
try {
  await app.evaluate(({ ipcMain, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const fixture = globalThis.navigationChainFixture = { requests: [], blocked: [], commentRevision: 1, delayNextComments: false, releaseComments: null, completedCommentRevisions: [], readmeRevision: 1, delayNextReadme: false, releaseReadme: null, completedReadmeRevisions: [] };
    const mock = (channel, handler) => { ipcMain.removeHandler(channel); globalThis.registerChainFixture(channel, (_event, ...args) => handler(...args)); };
    const now = new Date().toISOString();
    const own = ['project-a', 'project-b'].map((name, index) => ({ id: index + 1, name, full_name: `tester/${name}`, owner: { login: 'tester', avatar_url: '' },
      description: `Own ${name}`, private: true, archived: false, default_branch: 'main', updated_at: now, open_issues_count: 1, permissions: { push: true, admin: true } }));
    const publicRepo = { ...own[0], id: 100, name: 'public-project', full_name: 'writer/public-project', private: false, owner: { login: 'writer', avatar_url: '' }, permissions: undefined };
    const otherPublic = { ...publicRepo, id: 101, name: 'other-public', full_name: 'writer/other-public' };
    const repository = name => [...own, publicRepo, otherPublic].find(repo => repo.name === name);
    const issue = repo => ({ id: repo.id * 100 + 7, number: 7, title: `${repo.name} remembered issue`,
      body: `[Project release](https://github.com/${repo.full_name}/releases)\n\n` + Array.from({ length: 20 }, (_, i) => `## Issue section ${i}\n\nDetailed issue report for ${repo.name}.`).join('\n\n'),
      state: 'open', created_at: now, user: { login: 'issue-author' }, comments: 2 });
    const pull = (repo, number) => ({ id: repo.id * 1000 + number, number, title: `Enhancement ${number}`, body: Array.from({ length: 20 }, (_, i) => `## Proposal section ${i}\n\nA detailed reason to improve this project.`).join('\n\n'), state: 'open', draft: false, created_at: now, user: { login: 'contributor' }, head: { sha: 'a'.repeat(40), ref: 'feature' }, base: { sha: 'b'.repeat(40), ref: 'main', repo: { id: repo.id } } });
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
      if (action === 'pullRequests' || action === 'pullRequestsPage') return Array.from({ length: 25 }, (_, index) => pull(repository(args[1]), index + 7));
      if (action === 'pullRequest') return pull(repository(args[1]), args[2]);
      if (action === 'pullReviewContext') return { repository: repository(args[1]), pullRequest: pull(repository(args[1]), args[2]), files: [{ filename: 'src/example.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old line\n+improved line' }], filesTruncated: false };
      if (action === 'pullChecks') return { headSha: args[3].headSha, checkRuns: { state: 'available', items: [], nextPage: null }, statuses: { state: 'available', items: [], nextPage: null } };
      if (action === 'isStarred') return false;
      if (action === 'readme') {
        const revision = fixture.readmeRevision;
        if (fixture.delayNextReadme) { fixture.delayNextReadme = false; await new Promise(resolve => { fixture.releaseReadme = resolve; }); }
        fixture.completedReadmeRevisions.push(revision);
        return `[Other project release](https://github.com/writer/other-public/releases)\n\n# README for ${args[1]} revision ${revision}\n\n` + Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\nProject documentation.`).join('\n\n');
      }
      if (action === 'issuesPage') return { items: [issue(repository(args[1])), ...Array.from({ length: 24 }, (_, index) => ({ ...issue(repository(args[1])), id: repository(args[1]).id * 100 + index + 20, number: index + 20, title: `Additional reported problem ${index + 20}` }))], nextPage: null };
      if (action === 'comments') {
        const revision = fixture.commentRevision;
        if (fixture.delayNextComments) { fixture.delayNextComments = false; await new Promise(resolve => { fixture.releaseComments = resolve; }); }
        fixture.completedCommentRevisions.push(revision);
        return [1, 2].map(id => ({ id, body: `Comment ${id} on ${args[1]} revision ${revision}.\n\n` + Array.from({ length: 8 }, (_, i) => `Paragraph ${i}: conversation details.`).join('\n\n'), created_at: now, user: { login: 'comment-author' } }));
      }
      if (action === 'commentsPage' || action === 'commitsPage' || action === 'releasesPage') return { items: [], nextPage: null };
      if (action === 'commits') return [];
      if (action === 'releases') return [{ id: 501, tag_name: 'v1.0.0', name: 'First version', body: 'Published release', draft: false, prerelease: false, assets: [], published_at: now, html_url: `https://github.com/${args[0]}/${args[1]}/releases/tag/v1.0.0` }];
      if (action === 'trending') return { items: [publicRepo], page: args[1] ?? 1, hasNextPage: false };
      if (action === 'publicRepo' || action === 'repository') return repository(args[1]);
      if (action === 'searchUsersPage') return { items: [{ id: 901, login: 'writer', avatar_url: '', html_url: '' }], page: 1, totalCount: 1, hasNextPage: false, incompleteResults: false };
      if (action === 'searchPublicReposPage') return { items: [], page: 1, totalCount: 0, hasNextPage: false, incompleteResults: false };
      if (action === 'profile') return { id: 901, login: 'writer', name: 'Writer', avatar_url: '', html_url: '', bio: 'Profile fixture', followers: 1, following: 2, public_repos: 1 };
      if (action === 'contributions') {
        const year = Number(args[1].slice(0, 4));
        return { total: 20, years: [2026, 2025], weeks: [{ contributionDays: [{ date: `${year}-01-02`, contributionCount: 20, color: '#00bb00' }] }], repositories: Array.from({ length: 20 }, (_, index) => ({ fullName: 'writer/public-project', count: 20 - index, isPrivate: false, kind: `Activity ${index}` })) };
      }
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
  await app.evaluate(async ({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), join(product, 'out', 'renderer', 'index.html'));
  await page.locator('.live-connected').waitFor();
  await page.setViewportSize({ width: 1060, height: 700 });
  const nav = name => page.locator('.sidebar-nav').getByRole('button', { name: name === '问题' ? /^问题/ : name, exact: name !== '问题' });
  const scroll = async top => {
    if (!programmaticScroll) {
      await page.locator('.main-column').hover({ position: { x: 40, y: 200 } });
      await page.mouse.wheel(0, 1);
      await page.waitForTimeout(50);
    }
    await page.locator('.main-column').evaluate((node, target) => { node.scrollTop = target; }, top);
    await page.waitForTimeout(100);
    return page.locator('.main-column').evaluate(node => node.scrollTop);
  };
  const assertScroll = async (position, reason) => {
    lastExpectedScroll = { position, reason };
    await page.waitForFunction(target => Math.abs(document.querySelector('.main-column').scrollTop - target) < 5, position);
    assert.ok(Math.abs(await page.locator('.main-column').evaluate(node => node.scrollTop) - position) < 5, reason);
  };
  if (chainCase === 'issue-release') {
  await nav('发现').click();
  await page.locator('.trending-card').filter({ hasText: 'public-project' }).click();
  await page.locator('.public-browser-content .readme-markdown').first().waitFor();
  const introPosition = await scroll(730);
  await page.locator('.public-browser-tabs').getByRole('button', { name: /^问题/ }).evaluate(node => node.click());
  await page.locator('.public-list-row').filter({ hasText: 'Additional reported problem 43' }).waitFor();
  const issueListPosition = await scroll(370);
  await page.locator('.public-list-row').filter({ hasText: 'public-project remembered issue' }).evaluate(node => node.click());
  await page.locator('#public-issue-reply').fill('Keep my public issue reply through the release subpage');
  await page.locator('.conversation').filter({ hasText: 'Comment 1 on public-project' }).waitFor();
  const publicPosition = await scroll(550);
  assert.ok(publicPosition >= 500, 'Issue fixture needs long content.');
  await page.locator('.public-issue-detail').getByRole('link', { name: 'Project release', exact: true }).evaluate(node => node.click());
  await page.locator('[data-testid="release-downloads"]').waitFor();
  await page.getByRole('button', { name: '返回项目', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.public-issue-detail').count(), 1, 'Returning from a release opened inside an issue must restore that issue, not jump to project README.');
  assert.equal(await page.locator('.public-issue-detail .issue-title h1').innerText(), 'public-project remembered issue');
  assert.equal(await page.locator('#public-issue-reply').inputValue(), 'Keep my public issue reply through the release subpage');
  await assertScroll(publicPosition, 'Release return must restore the issue reading position.');
  completed.push('issue-release-issue-detail-and-scroll-return');
  await page.getByRole('button', { name: '返回问题', exact: true }).click();
  assert.match(await page.locator('.public-browser-tabs button.selected').innerText(), /^问题/);
  await page.locator('.public-list-row').filter({ hasText: 'public-project remembered issue' }).waitFor();
  await assertScroll(issueListPosition, 'Returning from an issue must restore the issues list reading position.');
  completed.push('issue-detail-issues-tab-and-position-return');
  await page.locator('.public-browser > .back-link').click();
  assert.match(await page.locator('.public-browser-tabs button.selected').innerText(), /项目介绍/);
  await page.locator('.public-browser-content .readme-markdown').first().waitFor();
  await assertScroll(introPosition, 'The issues-list back button must restore the previous project introduction reading position.');
  completed.push('issues-list-project-introduction-position-return');
  await page.locator('.public-browser > .back-link').click();
  await page.locator('.trending-card').filter({ hasText: 'public-project' }).waitFor();
  completed.push('project-search-list-return');

  } else if (chainCase === 'cross-release') {
  await nav('我的项目').click();
  await page.locator('.cloud-row').filter({ hasText: 'project-a' }).getByRole('button', { name: '查看', exact: true }).click();
  await page.locator('.detail-hero h1').filter({ hasText: 'project-a' }).waitFor();
  await page.locator('.readme-markdown').filter({ hasText: 'README for project-a' }).waitFor();
  const sourcePosition = await scroll(510);
  await page.locator('.readme-markdown').getByRole('link', { name: 'Other project release', exact: true }).evaluate(node => node.click());
  await page.locator('[data-testid="release-downloads"]').waitFor();
  await page.getByRole('button', { name: '返回项目', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.detail-hero h1').innerText(), 'project-a', 'Returning from another project release opened in my README must restore my source project.');
  assert.match(await page.locator('.readme-markdown').innerText(), /README for project-a/);
  await assertScroll(sourcePosition, 'Cross-project release return must restore the source README reading position.');
  completed.push('cross-project-release-source-readme-return');
  await page.getByRole('button', { name: '所有项目', exact: true }).click();
  await page.locator('.cloud-row').filter({ hasText: 'project-a' }).waitFor();
  completed.push('source-project-project-list-return');
  } else if (chainCase === 'profile') {
  await nav('发现').click();
  await page.getByRole('button', { name: '用户搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索用户', exact: true }).fill('writer');
  await page.getByRole('button', { name: '查看 writer 的主页', exact: true }).click();
  await page.locator('.contribution-years').getByRole('button', { name: '2025', exact: true }).click();
  await page.locator('.contribution-cell').first().click();
  await page.locator('.profile-repositories h2').filter({ hasText: '2025-01-02 的项目与社交活动' }).waitFor();
  const profilePosition = await scroll(560);
  await page.locator('.profile-repo-row').first().evaluate(node => node.click());
  await page.locator('.public-browser-hero h1').filter({ hasText: 'writer/public-project' }).waitFor();
  await page.locator('.public-browser > .back-link').click();
  await page.locator('.profile-page').waitFor();
  assert.equal(await page.locator('.contribution-years button.selected').innerText(), '2025', 'Returning from the profile repository must retain selected contribution year.');
  assert.match(await page.locator('.profile-repositories h2').innerText(), /2025-01-02 的项目与社交活动/, 'Returning from the profile repository must retain selected contribution date.');
  await assertScroll(profilePosition, 'Repository return must restore the profile reading position.');
  completed.push('profile-repository-profile-year-day-position-return');
  await page.locator('.profile-page').getByRole('button', { name: '返回', exact: true }).click();
  await page.locator('.user-search-card').waitFor();
  assert.equal(await page.getByRole('textbox', { name: '搜索用户', exact: true }).inputValue(), 'writer');
  completed.push('profile-user-search-query-return');
  } else if (chainCase === 'public-pull') {
  await nav('发现').click();
  await page.locator('.trending-card').filter({ hasText: 'public-project' }).click();
  await page.locator('.public-browser-content .readme-markdown').first().waitFor();
  const introPosition = await scroll(730);
  await page.locator('.public-browser-tabs').getByRole('button', { name: /^合并请求审查/ }).evaluate(node => node.click());
  await page.locator('.pull-requests-panel .public-list-row').filter({ hasText: 'Enhancement 31' }).waitFor();
  const listPosition = await scroll(350);
  const request = () => page.locator('.pull-requests-panel .public-list-row').filter({ hasText: 'Enhancement 7' });
  await request().evaluate(node => node.click());
  await page.locator('.pull-file-change').waitFor();
  await page.locator('#pull-reply').fill('Unsent merge request reply retained on return');
  await scroll(510);
  await page.locator('.public-browser > .back-link').evaluate(node => node.click());
  assert.equal(await page.locator('#pull-reply').count(), 0, 'The public top back button must leave PR detail for its list first.');
  await request().waitFor();
  await assertScroll(listPosition, 'The public top back button must restore the PR list reading position.');
  completed.push('public-top-back-pull-detail-list-position-return');
  await request().evaluate(node => node.click());
  await page.locator('.pull-file-change').waitFor();
  assert.equal(await page.locator('#pull-reply').inputValue(), 'Unsent merge request reply retained on return');
  await page.locator('.public-browser > .back-link').evaluate(node => node.click());
  await request().waitFor();
  await page.locator('.public-browser > .back-link').evaluate(node => node.click());
  assert.match(await page.locator('.public-browser-tabs button.selected').innerText(), /项目介绍/);
  await assertScroll(introPosition, 'PR list back must restore the previous README position.');
  completed.push('public-pull-list-project-introduction-position-return');
  await page.locator('.public-browser > .back-link').click();
  await page.locator('.trending-card').filter({ hasText: 'public-project' }).waitFor();
  completed.push('public-pull-project-discovery-return');
  } else if (chainCase === 'chronological') {
  await nav('发现').click();
  await page.locator('.trending-card').filter({ hasText: 'public-project' }).click();
  await page.locator('.public-browser-content .readme-markdown').first().waitFor();
  const introPosition = await scroll(730);
  await page.locator('.public-browser-tabs').getByRole('button', { name: /^问题/ }).evaluate(node => node.click());
  await page.locator('.public-list-row').filter({ hasText: 'Additional reported problem 43' }).waitFor();
  const listPosition = await scroll(370);
  await page.locator('.public-list-row').filter({ hasText: 'public-project remembered issue' }).evaluate(node => node.click());
  await page.locator('.conversation').filter({ hasText: 'Comment 1 on public-project' }).waitFor();
  await page.locator('#public-issue-reply').fill('Chronological return must preserve my reply');
  const detailPosition = await scroll(550);
  await nav('设置').click();
  await page.locator('#ai-settings-heading').waitFor();
  const settingsPosition = await scroll(130);
  await nav('发现').click();
  await page.locator('#public-issue-reply').waitFor();
  await assertScroll(detailPosition, 'Sidebar restoration must return to the public issue position.');
  await page.locator('.public-issue-page > .back-link').evaluate(node => node.click());
  assert.equal(await page.locator('#ai-settings-heading').isVisible(), true, 'After returning by sidebar, Back must restore the chronologically previous Settings page before walking earlier issue pages.');
  assert.equal(await nav('设置').getAttribute('class'), 'active', 'Chronological Back must activate the Settings sidebar category.');
  await assertScroll(settingsPosition, 'Chronological return must restore Settings position.');
  completed.push('public-issue-sidebar-return-back-settings');
  await page.locator('.live-page > .v2-page-transition > .back-link').click();
  await page.locator('#public-issue-reply').waitFor();
  assert.equal(await page.locator('#public-issue-reply').inputValue(), 'Chronological return must preserve my reply');
  await assertScroll(detailPosition, 'Settings Back must restore the earlier public issue.');
  completed.push('settings-back-public-issue-detail');
  await page.locator('.public-issue-page > .back-link').evaluate(node => node.click());
  await page.locator('.public-list-row').filter({ hasText: 'public-project remembered issue' }).waitFor();
  await assertScroll(listPosition, 'Earlier public issue Back must restore the issue list position.');
  completed.push('chronological-issue-list-return');
  await page.locator('.public-browser > .back-link').evaluate(node => node.click());
  assert.match(await page.locator('.public-browser-tabs button.selected').innerText(), /项目介绍/);
  await assertScroll(introPosition, 'Earlier issue list Back must restore the README position.');
  completed.push('chronological-issue-list-introduction-return');
  } else throw new Error('Unknown chain case: ' + chainCase);

  assert.deepEqual(errors, []);
  assert.deepEqual(await app.evaluate(() => globalThis.navigationChainFixture.blocked), []);
  assert.deepEqual(await app.evaluate(() => globalThis.rejectedChainIPC), []);
  await page.screenshot({ path: join(output, `${packaged ? 'packaged-' : ''}${chainCase}-restored.png`) });
  await writeFile(join(output, `${packaged ? 'packaged-' : ''}${chainCase}${programmaticScroll ? '-programmatic' : ''}-result.json`), JSON.stringify({ passed: true, packaged, chainCase, programmaticScroll, completed, requests: await app.evaluate(() => globalThis.navigationChainFixture.requests) }, null, 2));
  process.stdout.write(`Navigation chain regression passed: ${chainCase}.\n`);
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: join(output, `${packaged ? 'packaged-' : ''}${chainCase}-failure.png`) }).catch(() => undefined);
  await writeFile(join(output, `${packaged ? 'packaged-' : ''}${chainCase}${programmaticScroll ? '-programmatic' : ''}-failure.json`), JSON.stringify({ packaged, chainCase, programmaticScroll, completed, error: error.message, lastExpectedScroll, readingPosition: await page.locator('.main-column').evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight })), requests: await app.evaluate(() => globalThis.navigationChainFixture.requests) }, null, 2));
  throw error;
} finally { await app.close(); }
