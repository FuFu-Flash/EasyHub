import assert from 'node:assert/strict';
import { isAbsolute, join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const executableArgument = process.argv.find((argument) => argument.startsWith('--executable='));
const executable = executableArgument?.slice('--executable='.length);
if (executableArgument && (!executable || !isAbsolute(executable))) throw new Error('--executable requires an absolute path.');
const profileArgument = `--user-data-dir=${join(process.cwd(), 'out/binary-analysis-smoke-profile')}`;
const app = await electron.launch({ executablePath: executable || electronPath, args: executable ? [profileArgument] : ['.', profileArgument], cwd: process.cwd() });
try {
  await app.evaluate(({ ipcMain }) => {
    const repo = { id: 981, name: 'binary-project', full_name: 'test-owner/binary-project', description: 'Binary analysis fixture', private: false, archived: false, permissions: { admin: true, push: true, pull: true }, updated_at: new Date().toISOString(), default_branch: 'main', owner: { login: 'test-owner' }, open_issues_count: 0 };
    const request = { id: 982, number: 12, title: 'Update program file', body: 'A program file and a text change.', state: 'open', draft: false, merged: false, merged_at: null, created_at: new Date().toISOString(), html_url: 'https://github.com/test-owner/binary-project/pull/12', user: { login: 'contributor' }, comments: 0, changed_files: 2, head: { ref: 'program-update', label: 'contributor:program-update', sha: 'b'.repeat(40) }, base: { ref: 'main', sha: 'a'.repeat(40) } };
    const files = [{ filename: 'bin/helper.dll', status: 'added', additions: 0, deletions: 0, sha: 'c'.repeat(40) }, { filename: 'README.md', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+Updated program' }];
    const release = { id: 983, tag_name: 'v1.0.0', name: 'Program release', body: 'Program release notes.', draft: false, prerelease: false, published_at: new Date().toISOString(), assets: [{ id: 984, name: 'tool.exe', label: null, size: 4096, content_type: 'application/octet-stream', download_count: 0, state: 'uploaded' }, { id: 985, name: 'source.zip', label: null, size: 512, content_type: 'application/zip', download_count: 0, state: 'uploaded' }, { id: 986, name: 'tool-two.exe', label: null, size: 4096, content_type: 'application/octet-stream', download_count: 0, state: 'uploaded' }] };
    let status = { installed: false, state: 'missing', engineVersion: '12.1.2' };
    globalThis.setBinaryDownloadBytes = (downloadBytes) => { status = { ...status, downloadBytes }; };
    const metrics = globalThis.easyhubBinarySmoke = { installs: [], analyses: [], reviews: [], cancels: [], aiCancels: [], chosen: 0, openedFiles: [], pendingInstalls: [], pendingAnalyses: [], pendingReviews: [], pendingCancels: [] };
    const finishCancellation = (requestId) => {
      for (let index = metrics.pendingCancels.length - 1; index >= 0; index -= 1) {
        if (metrics.pendingCancels[index].requestId === requestId) metrics.pendingCancels.splice(index, 1)[0].resolve();
      }
    };
    const handle = (channel, callback) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, callback); };
    handle('easyhub:auth-status', () => ({ user: { login: 'test-owner', name: 'Owner', avatar_url: '', html_url: '' }, clientId: 'test-client' }));
    handle('easyhub:local-list', () => []);
    handle('easyhub:local-discovery-roots', () => []);
    handle('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    handle('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', hasApiKey: true }));
    handle('easyhub:binary-analysis-status', () => structuredClone(status));
    handle('easyhub:binary-analysis-install', async (event, requestId) => {
      metrics.installs.push(requestId);
      status = { ...status, state: 'installing' };
      event.sender.send('easyhub:binary-analysis-progress', { requestId, phase: 'installing', completed: 32 * 1024 * 1024, total: status.downloadBytes ?? 0, unit: 'bytes' });
      return new Promise((resolve) => metrics.pendingInstalls.push({ requestId, resolve }));
    });
    handle('easyhub:binary-analysis-choose-file', () => { metrics.chosen += 1; return { kind: 'local', fileId: `picked-local-program-${metrics.chosen}`, name: metrics.chosen === 1 ? 'sample.exe' : 'sample-two.exe', size: 4096 }; });
    handle('easyhub:binary-analyze', async (event, input) => {
      metrics.analyses.push(input);
      status = { ...status, state: 'analyzing' };
      event.sender.send('easyhub:binary-analysis-progress', { requestId: input.requestId, phase: 'analyzing', completed: 1, total: 3, unit: 'steps' });
      return new Promise((resolve) => metrics.pendingAnalyses.push({ input, resolve }));
    });
    handle('easyhub:binary-analysis-cancel', (_event, requestId) => {
      metrics.cancels.push(requestId);
      const pending = metrics.pendingInstalls.some(item => item.requestId === requestId)
        || metrics.pendingAnalyses.some(item => item.input.requestId === requestId);
      if (pending) return new Promise(resolve => metrics.pendingCancels.push({ requestId, resolve }));
      status = { ...status, state: status.installed ? 'ready' : 'missing' };
    });
    handle('easyhub:binary-ai-review', async (event, input) => {
      metrics.reviews.push(input);
      event.sender.send('easyhub:ai-review-progress', { requestId: input.requestId, phase: 'reviewing', completed: 0, total: 1 });
      return new Promise((resolve) => metrics.pendingReviews.push({ input, resolve }));
    });
    handle('easyhub:ai-cancel-review', (_event, requestId) => { metrics.aiCancels.push(requestId); });
    handle('easyhub:open-downloaded-file', (_event, path) => { metrics.openedFiles.push(path); });
    handle('easyhub:github', (_event, action, ...args) => {
      if (action === 'repos') return [repo];
      if (action === 'activityCounts') return { 981: { issues: 0, closedIssues: 0, pullRequests: 1, closedPullRequests: 0 } };
      if (action === 'readme') return '# Binary analysis fixture\n\nA project with program files.';
      if (action === 'repository' || action === 'publicRepo') return repo;
      if (action === 'releases') return [release];
      if (action === 'issues' || action === 'commits' || action === 'comments') return [];
      if (action === 'issuesPage') return { items: [], nextPage: null };
      if (action === 'pullRequests') return [request];
      if (action === 'pullRequestsPage') return args[2] === 'open' ? [request] : [];
      if (action === 'pullRequest') return request;
      if (action === 'pullFiles') return files;
      if (action === 'pullReviewContext') return { repository: repo, pullRequest: request, files, filesTruncated: false };
      throw new Error(`Unexpected binary analysis mock action: ${action}`);
    });
    globalThis.finishBinaryInstall = () => {
      const pending = metrics.pendingInstalls.shift();
      if (!pending) throw new Error('No pending install');
      const ready = { installed: true, state: 'ready', engineVersion: '12.1.2' };
      if (!metrics.cancels.includes(pending.requestId)) status = ready;
      else status = { ...status, state: status.installed ? 'ready' : 'missing' };
      pending.resolve(ready);
      finishCancellation(pending.requestId);
    };
    globalThis.finishBinaryAnalysis = () => {
      const pending = metrics.pendingAnalyses.shift();
      if (!pending) throw new Error('No pending analysis');
      const canceled = metrics.cancels.includes(pending.input.requestId);
      const en = pending.input.language === 'en';
      const source = pending.input.source;
      const name = source.kind === 'pull' ? source.path.split('/').at(-1) : source.name;
      status = { ...status, state: 'ready' };
      pending.resolve({ id: pending.input.requestId, fileName: name, size: 4096, sha256: 'd'.repeat(64), format: 'Portable Executable (PE)', architecture: 'x86:LE:64:default', functionCount: 3, functions: [{ name: 'entry', address: '00401000', code: 'int entry(void) { return 0; }' }], imports: ['KERNEL32.dll:CreateFileW'], strings: ['example configuration'], summary: canceled ? 'Canceled analysis must stay hidden.' : en ? 'Three functions and a file access import were extracted.' : '已提取三个函数和一个文件访问导入项。', limitations: [en ? 'The program was not run.' : '没有运行该程序。'] });
      finishCancellation(pending.input.requestId);
    };
    globalThis.finishBinaryReview = () => {
      const pending = metrics.pendingReviews.shift();
      if (!pending) throw new Error('No pending review');
      const en = pending.input.language === 'en';
      const canceled = metrics.aiCancels.includes(pending.input.requestId);
      pending.resolve({ analysisId: pending.input.analysisId, summary: canceled ? 'Canceled AI explanation must stay hidden.' : en ? 'Inspect how the program chooses the file path.' : '建议检查程序如何选择文件路径。', findings: [{ severity: 'medium', address: '00401000', description: en ? 'The extracted import can access local files.' : '提取的导入项可以访问本地文件。', suggestion: en ? 'Inspect the surrounding function before deciding.' : '结合周围函数内容进一步检查。' }], limitations: [en ? 'Only extracted content was reviewed.' : '仅检查了提取内容。'] });
    };
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const count = (key) => app.evaluate((_electron, key) => globalThis.easyhubBinarySmoke[key].length, key);
  async function waitCount(key, expected) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await count(key) === expected) return;
      await page.waitForTimeout(50);
    }
    assert.equal(await count(key), expected, key + ' count did not reach ' + expected);
  }
  await page.evaluate(() => { localStorage.setItem('easyhub:language', 'zh'); localStorage.setItem('easyhub:auto-translate', 'false'); });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click();
  const aiSettings = page.getByRole('region', { name: 'AI API 授权', exact: true });
  const aiSettingsToggle = aiSettings.getByRole('button', { name: /AI API 授权/ });
  if (await aiSettingsToggle.getAttribute('aria-expanded') !== 'true') await aiSettingsToggle.click();
  assert.equal(await aiSettings.locator('.binary-settings-panel').count(), 1, 'Program component management must be inside AI Settings');
  const settings = page.getByRole('region', { name: '程序文件审查', exact: true });
  const toggle = settings.getByRole('button', { name: /程序文件审查/ });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await settings.getByRole('button', { name: '安装组件', exact: true }).isVisible(), false);
  assert.equal(await count('installs'), 0);
  await toggle.click();
  await settings.getByText(/首次使用需下载分析组件。/).waitFor();
  assert.equal(await settings.locator('.binary-install-entry').getByText(/\d+(?:\.\d+)? MB/).count(), 0, 'Older status responses must not invent download sizes');
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  const englishSettings = page.getByRole('region', { name: 'Program file review', exact: true });
  await englishSettings.getByText(/Analysis components are downloaded on first use\./).waitFor();
  await app.evaluate(() => globalThis.setBinaryDownloadBytes(143.5 * 1024 * 1024));
  await englishSettings.getByRole('button', { name: 'Check components', exact: true }).click();
  await englishSettings.getByText(/About 143\.5 MB will be downloaded\./).waitFor();
  await page.setViewportSize({ width: 950, height: 800 });
  assert.equal(await englishSettings.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  await page.screenshot({ path: 'out/binary-analysis-download-en-smoke.png' });
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await settings.getByText(/需要下载约 143\.5 MB。/).waitFor();
  assert.equal(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  await page.screenshot({ path: 'out/binary-analysis-download-zh-smoke.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await count('installs'), 0, 'Expanding Settings must not install components');
  assert.equal(await settings.getByText(/MCP|脚本|Java 目录|Ghidra 路径/).count(), 0);
  await settings.getByRole('button', { name: '安装组件', exact: true }).click();
  await settings.getByText('32.0 MB / 143.5 MB', { exact: true }).waitFor();
  await settings.getByRole('button', { name: '取消', exact: true }).click();
  await waitCount('cancels', 1);
  await app.evaluate(() => globalThis.finishBinaryInstall());
  await settings.getByText('已取消。', { exact: true }).waitFor();
  await settings.getByText('尚未安装', { exact: true }).waitFor();
  assert.equal(await settings.getByText(/审查组件已安装/).count(), 0, 'Late install completion must not activate canceled UI state');
  await app.evaluate(() => globalThis.setBinaryDownloadBytes(96 * 1024 * 1024));
  await settings.getByRole('button', { name: '检查组件', exact: true }).click();
  await settings.getByText(/需要下载约 96\.0 MB。/).waitFor();
  await settings.getByRole('button', { name: '安装组件', exact: true }).click();
  await waitCount('installs', 2);
  await app.evaluate(() => globalThis.finishBinaryInstall());
  await settings.getByText('审查组件已安装，可以选择文件开始 AI 审查。', { exact: true }).waitFor();
  assert.equal(await settings.getByRole('button', { name: '安装组件', exact: true }).count(), 0);
  await settings.getByRole('button', { name: '选择本地文件', exact: true }).click();
  await settings.getByText('sample.exe', { exact: true }).waitFor();
  assert.equal(await count('analyses'), 0, 'Choosing a file must not start extraction');
  assert.equal(await count('reviews'), 0, 'Choosing a file must not send AI requests');
  assert.equal(await settings.getByRole('button', { name: /^(开始分析|重新分析|AI 解释)$/ }).count(), 0);
  const reviewButton = settings.getByRole('button', { name: /^(AI 审查|重新审查)$/ });
  const consent = page.getByRole('dialog', { name: '使用 AI 审查这个程序文件？', exact: true });
  async function approveReview(panel, en = false) {
    await panel.getByRole('button', { name: en ? /^(AI review|Review again)$/ : /^(AI 审查|重新审查)$/ }).click();
    const dialog = page.getByRole('dialog', { name: en ? 'Use AI to review this program file?' : '使用 AI 审查这个程序文件？', exact: true });
    await dialog.getByText('https://api.openai.com/v1', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: en ? 'Agree and start review' : '同意并开始审查', exact: true }).click();
  }
  // One consent precedes both extraction and AI; dismissal has no side effects.
  await reviewButton.click();
  await consent.getByText('https://api.openai.com/v1', { exact: true }).waitFor();
  assert.equal(await count('analyses'), 0);
  assert.equal(await count('reviews'), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '取消');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '同意并开始审查');
  await page.keyboard.press('Escape');
  await consent.waitFor({ state: 'hidden' });
  assert.equal(await count('analyses'), 0);
  // Cancel extraction and resolve its late response: AI must not start.
  await approveReview(settings);
  await waitCount('analyses', 1);
  await settings.getByText('1 / 3', { exact: true }).waitFor();
  await settings.getByRole('button', { name: '取消', exact: true }).click();
  await waitCount('cancels', 2);
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  assert.equal(await settings.getByRole('button', { name: '更换文件', exact: true }).isDisabled(), true);
  assert.equal(await settings.getByRole('button', { name: /^(AI 审查|重新审查)$/ }).isDisabled(), true,
    'Language changes must not unlock a pending canceled extraction');
  await app.evaluate(() => globalThis.finishBinaryAnalysis());
  await settings.locator('.binary-file-actions .button-primary:not([disabled])').waitFor();
  assert.equal(await count('reviews'), 0, 'Cancellation during extraction must not continue into AI');
  assert.equal(await settings.getByText('Canceled analysis must stay hidden.', { exact: true }).count(), 0);
  // Cancel after automatic AI handoff, then deliver its late result.
  await approveReview(settings);
  await waitCount('analyses', 2);
  await app.evaluate(() => globalThis.finishBinaryAnalysis());
  await waitCount('reviews', 1);
  assert.equal(await page.getByRole('dialog').count(), 0, 'AI must not prompt for a second consent');
  await settings.getByRole('button', { name: '取消', exact: true }).click();
  await waitCount('aiCancels', 1);
  await app.evaluate(() => globalThis.finishBinaryReview());
  await settings.getByText('已取消。', { exact: true }).waitFor();
  assert.equal(await settings.getByText('Canceled AI explanation must stay hidden.', { exact: true }).count(), 0);
  // A successful review re-extracts the current source, then sends its analysis ID only.
  await approveReview(settings);
  await waitCount('analyses', 3);
  await app.evaluate(() => globalThis.finishBinaryAnalysis());
  await waitCount('reviews', 2);
  await app.evaluate(() => globalThis.finishBinaryReview());
  const report = settings.getByRole('region', { name: 'AI 审查结果', exact: true });
  await report.getByText('建议检查程序如何选择文件路径。', { exact: true }).waitFor();
  assert.equal(await report.count(), 1);
  const input = await app.evaluate(() => globalThis.easyhubBinarySmoke.reviews.at(-1));
  const extraction = await app.evaluate(() => globalThis.easyhubBinarySmoke.analyses.at(-1));
  assert.equal(input.requestId, extraction.requestId);
  assert.equal(input.analysisId, extraction.requestId);
  assert.equal(input.consentToSend, true);
  assert.equal(input.providerBaseUrl, 'https://api.openai.com/v1');
  assert.equal(input.language, 'zh');
  assert.equal('source' in input, false);
  assert.deepEqual(await app.evaluate(() => globalThis.easyhubBinarySmoke.openedFiles), []);
  await page.setViewportSize({ width: 950, height: 800 });
  assert.equal(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  await report.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'out/binary-analysis-zh-report-smoke.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  // File changes discard old evidence and still require consent.
  await settings.getByRole('button', { name: '更换文件', exact: true }).click();
  await settings.getByText('sample-two.exe', { exact: true }).waitFor();
  assert.equal(await report.count(), 0);
  assert.equal(await count('analyses'), 3);
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  assert.equal(await englishSettings.getByRole('button', { name: /^(Start analysis|Analyze again|AI explanation)$/ }).count(), 0);
  await approveReview(englishSettings, true);
  await waitCount('analyses', 4);
  await app.evaluate(() => globalThis.finishBinaryAnalysis());
  await waitCount('reviews', 3);
  await app.evaluate(() => globalThis.finishBinaryReview());
  const englishReport = englishSettings.getByRole('region', { name: 'AI review results', exact: true });
  await englishReport.getByText('Inspect how the program chooses the file path.', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.easyhubBinarySmoke.reviews.at(-1).language), 'en');
  assert.equal(await app.evaluate(() => globalThis.easyhubBinarySmoke.analyses.at(-1).language), 'en');
  await page.setViewportSize({ width: 950, height: 800 });
  assert.equal(await englishSettings.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  await englishReport.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'out/binary-analysis-en-report-smoke.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  async function openProject() {
    await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
    await page.getByRole('button', { name: /我的云端项目/ }).click();
    await page.locator('.cloud-row').filter({ hasText: 'binary-project' }).getByRole('button', { name: '查看', exact: true }).click();
  }
  await openProject();
  await page.getByRole('button', { name: '查看问题', exact: true }).click();
  await page.getByRole('tab', { name: /^代码提交审查/ }).click();
  const pulls = page.locator('.pull-requests-panel');
  await pulls.getByRole('button').filter({ hasText: 'Update program file' }).click();
  await pulls.getByText('bin/helper.dll', { exact: true }).waitFor();
  assert.equal(await pulls.getByRole('button', { name: /分析程序文件|Analyze program file/ }).count(), 0, 'PR must have one combined AI review entry');
  assert.equal(await pulls.getByRole('button', { name: 'AI 审查', exact: true }).count(), 1);
  await openProject();
  await page.getByRole('button', { name: '编辑发行版', exact: true }).click();
  const downloads = page.getByTestId('release-downloads');
  const assetReview = (name) => downloads.getByRole('button', { name: 'AI 审查程序文件 ' + name, exact: true });
  await assetReview('tool.exe').click();
  assert.equal(await assetReview('source.zip').count(), 0);
  const releasePanel = downloads.locator('.binary-analysis-panel');
  await approveReview(releasePanel);
  await waitCount('analyses', 5);
  assert.deepEqual(await app.evaluate(() => globalThis.easyhubBinarySmoke.analyses.at(-1).source), { kind: 'release', owner: 'test-owner', repo: 'binary-project', assetId: 984, name: 'tool.exe' });
  // Changing the release source cancels extraction and hides its late response.
  await assetReview('tool-two.exe').click();
  await waitCount('cancels', 3);
  await assetReview('tool.exe').click();
  await assetReview('tool-two.exe').click();
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.locator('.language-trigger').click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  assert.equal(await releasePanel.getByRole('button', { name: /^(AI 审查|重新审查)$/ }).isDisabled(), true,
    'Repeated source/language changes must keep review locked until canceled extraction settles');
  assert.equal(await count('analyses'), 5, 'A replacement source must not start work before cleanup finishes');
  await app.evaluate(() => globalThis.finishBinaryAnalysis());
  await releasePanel.getByText('tool-two.exe', { exact: true }).waitFor();
  assert.equal(await count('reviews'), 3, 'A replaced source must not hand its old extraction to AI');
  assert.equal(await releasePanel.getByText('Canceled analysis must stay hidden.', { exact: true }).count(), 0);
  await approveReview(releasePanel);
  await waitCount('analyses', 6);
  await app.evaluate(() => globalThis.finishBinaryAnalysis());
  await waitCount('reviews', 4);
  // Navigation away invalidates the pending AI report.
  await openProject();
  await waitCount('aiCancels', 2);
  await app.evaluate(() => globalThis.finishBinaryReview());
  await page.getByRole('button', { name: '编辑发行版', exact: true }).click();
  await assetReview('tool-two.exe').click();
  assert.equal(await downloads.getByText('Canceled AI explanation must stay hidden.', { exact: true }).count(), 0);
  await approveReview(downloads.locator('.binary-analysis-panel'));
  await waitCount('analyses', 7);
  await app.evaluate(() => globalThis.finishBinaryAnalysis());
  await waitCount('reviews', 5);
  await app.evaluate(() => globalThis.finishBinaryReview());
  await downloads.getByRole('region', { name: 'AI 审查结果', exact: true }).getByText('建议检查程序如何选择文件路径。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(pageErrors, []);
  process.stdout.write('PASS unified program review: nested settings, single consent, extraction/AI cancellation, stale source/navigation responses, local/release review, PR single entry, Chinese/English reports and 950px layout.\n');
} finally { await app.close(); }
