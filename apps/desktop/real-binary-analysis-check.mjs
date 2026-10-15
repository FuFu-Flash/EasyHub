import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

// Uses a separately installed optional runtime, or explicitly checks fresh installation
// in an isolated test profile. Real Main/Preload extraction, with an explicitly local
// placeholder AI response to exercise the unified UI. Never executes the sample,
// contacts an AI provider or writes to GitHub. The placeholder does not assess AI quality.
const profile = process.env.EASYHUB_BINARY_TEST_PROFILE;
assert.ok(profile && isAbsolute(profile), 'Set EASYHUB_BINARY_TEST_PROFILE to the test profile with installed analysis components.');
const installRequested = process.env.EASYHUB_BINARY_TEST_INSTALL === '1';
if (installRequested) assert.match(basename(profile), /^EasyHub-analysis-slim-test-[A-Za-z0-9-]+$/, 'Fresh installation must use an isolated analysis test profile.');
const desktopDir = dirname(fileURLToPath(import.meta.url));
const executable = process.env.EASYHUB_BINARY_TEST_EXECUTABLE;
if (executable) assert.ok(isAbsolute(executable), 'The test executable must use an absolute path.');
const sample = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe');
const originalHash = createHash('sha256').update(await readFile(sample)).digest('hex');
const application = await electron.launch({ executablePath: executable || electronPath,
  args: [...(executable ? [] : ['.']), `--user-data-dir=${profile}`], cwd: desktopDir });
try {
  await application.evaluate(({ ipcMain, dialog }, sample) => {
    const replace = (channel, callback) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, callback); };
    replace('easyhub:auth-status', () => ({ user: { login: 'analysis-check', name: 'Analysis check', avatar_url: '', html_url: '' }, clientId: 'test_client' }));
    replace('easyhub:local-list', () => []);
    replace('easyhub:local-discovery-roots', () => []);
    globalThis.realProgramSmoke = { mockReviews: [], blockedAiCalls: [] };
    replace('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'local-placeholder-only', hasApiKey: true }));
    for (const channel of ['easyhub:ai-review-pull', 'easyhub:ai-test-connection', 'easyhub:ai-save-settings', 'easyhub:ai-forget-key', 'easyhub:translate-content']) {
      replace(channel, () => { globalThis.realProgramSmoke.blockedAiCalls.push(channel); throw new Error('This engine test blocks every provider request.'); });
    }
    replace('easyhub:ai-cancel-review', () => undefined);
    replace('easyhub:binary-ai-review', (_event, input) => {
      if (input.consentToSend !== true || !input.analysisId) throw new Error('The local placeholder requires the current extracted analysis and consent.');
      globalThis.realProgramSmoke.mockReviews.push(input);
      return { analysisId: input.analysisId, summary: '本地占位 AI 响应：仅验证审查链路，未联系 AI 服务。', findings: [], limitations: ['此占位响应不评估 AI 审查质量。'] };
    });
    replace('easyhub:github', (_event, action) => {
      if (action === 'activityCounts') return {};
      if (action === 'repos') return [];
      throw new Error('This local program check must not call GitHub.');
    });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sample] });
  }, sample);
  const page = await application.firstWindow();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => {
    localStorage.setItem('easyhub:language', 'zh');
    localStorage.setItem('easyhub:auto-translate', 'false');
    window.binaryProgress = [];
    window.easyHub.onBinaryAnalysisProgress((progress) => window.binaryProgress.push(progress));
  });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await page.evaluate(() => {
    window.binaryProgress = [];
    window.easyHub.onBinaryAnalysisProgress((progress) => window.binaryProgress.push(progress));
  });
  const initialStatus = await page.evaluate(() => window.easyHub.binaryAnalysisStatus());
  assert.equal(initialStatus.installed, !installRequested, 'Use a fresh isolated profile to test installation, or a validated installed profile for analysis.');
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click();
  const aiSettings = page.getByRole('region', { name: 'AI API 授权', exact: true });
  const aiToggle = aiSettings.getByRole('button', { name: /AI API 授权/ });
  if (await aiToggle.getAttribute('aria-expanded') !== 'true') await aiToggle.click();
  const settings = aiSettings.getByRole('region', { name: '程序文件审查', exact: true });
  await settings.getByRole('button', { name: /程序文件审查/ }).click();
  if (installRequested) {
    assert.ok(initialStatus.downloadBytes > 0 && initialStatus.downloadBytes < 778605447, 'The new install must actually download less than the full upstream distributions.');
    await settings.getByRole('button', { name: '安装组件', exact: true }).click();
    await page.waitForFunction(() => window.binaryProgress.some(value => value.phase === 'installing' && value.completed >= 256 * 1024), undefined, { timeout: 180_000 });
    await settings.getByRole('button', { name: '取消', exact: true }).click();
    await settings.getByText('已取消。', { exact: true }).waitFor({ timeout: 60_000 });
    assert.equal((await page.evaluate(() => window.easyHub.binaryAnalysisStatus())).installed, false);
    assert.ok(!(await readdir(join(profile, 'analysis-runtime'))).some(value => value.startsWith('.install-')), 'Canceled installation must clean up only its own staging directory.');
    await page.evaluate(() => { window.binaryProgress = []; });
    const installationStarted = Date.now();
    await settings.getByRole('button', { name: '安装组件', exact: true }).click();
    await Promise.race([
      settings.getByText('审查组件已安装，可以选择文件开始 AI 审查。', { exact: true }).waitFor({ timeout: 30 * 60_000 }),
      settings.getByRole('alert').waitFor({ timeout: 30 * 60_000 }).then(async () => { throw new Error(await settings.getByRole('alert').innerText()); }),
    ]);
    const installed = await page.evaluate(() => window.easyHub.binaryAnalysisStatus());
    assert.equal(installed.installed, true);
    assert.equal(installed.downloadBytes, 0);
    const installProgress = await page.evaluate(() => window.binaryProgress.filter(value => value.phase === 'installing'));
    assert.equal(installProgress.at(-1)?.completed, initialStatus.downloadBytes, 'Progress must account for all verified component bytes.');
    assert.ok(!(await readdir(join(profile, 'analysis-runtime'))).some(value => value.startsWith('.install-')));
    process.stdout.write(`PASS: fresh verified slim-component installation and network cancellation; ${initialStatus.downloadBytes} bytes; ${((Date.now() - installationStarted) / 1000).toFixed(1)}s.\n`);
    await page.screenshot({ path: join(desktopDir, 'out/real-analysis-slim-install.png') });
  }
  await settings.getByRole('button', { name: '选择本地文件', exact: true }).click();
  await settings.locator('.binary-selected-file').getByText('whoami.exe', { exact: true }).waitFor();
  const started = Date.now();
  const consent = page.getByRole('dialog', { name: '使用 AI 审查这个程序文件？', exact: true });
  await settings.getByRole('button', { name: 'AI 审查', exact: true }).click();
  await consent.getByText('local-placeholder-only', { exact: true }).waitFor();
  assert.equal(await application.evaluate(() => globalThis.realProgramSmoke.mockReviews.length), 0);
  await consent.getByRole('button', { name: '同意并开始审查', exact: true }).click();
  const report = settings.getByRole('region', { name: 'AI 审查结果', exact: true });
  await Promise.race([
    report.waitFor({ timeout: 180_000 }),
    settings.getByRole('alert').waitFor({ timeout: 180_000 }).then(async () => { throw new Error(await settings.getByRole('alert').innerText()); }),
  ]);
  await report.getByText('本地占位 AI 响应：仅验证审查链路，未联系 AI 服务。', { exact: true }).waitFor();
  await report.getByText('程序文件提取证据 · whoami.exe', { exact: true }).click();
  const summary = await report.locator('.binary-extracted-details > .ai-review-report > p').innerText();
  assert.match(summary, /识别到 [1-9]\d* 个函数/);
  assert.match(summary, /查看了 [1-9]\d* 个代码片段/);
  assert.match(await report.innerText(), /没有运行程序/);
  const functions = await report.locator('.binary-functions pre code').allTextContents();
  assert.ok(functions.length > 0 && functions.every(code => /\([^)]*\)\s*\{[\s\S]*\}/u.test(code)), 'Decompiler excerpts must contain actual function bodies, not tool error messages.');
  const progress = await page.evaluate(() => window.binaryProgress);
  assert.equal(progress.at(-1)?.phase, 'complete');
  assert.equal((await page.evaluate(() => window.easyHub.binaryAnalysisStatus())).state, 'ready');
  await report.locator('.binary-functions details').first().locator('summary').click();
  await report.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(desktopDir, 'out/real-binary-analysis-report.png') });
  await page.evaluate(() => { window.binaryProgress = []; });
  await settings.getByRole('button', { name: '重新审查', exact: true }).click();
  await consent.getByRole('button', { name: '同意并开始审查', exact: true }).click();
  await page.waitForFunction(() => window.binaryProgress.filter((value) => value.phase === 'analyzing').length >= 3, undefined, { timeout: 60_000 });
  await settings.getByRole('button', { name: '取消', exact: true }).click();
  await settings.getByText('已取消。', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.easyHub.binaryAnalysisStatus())).state, 'ready', 'Cancellation must finish cleanup before returning.');
  assert.equal(await application.evaluate(() => globalThis.realProgramSmoke.mockReviews.length), 1, 'Canceled extraction must not continue into the placeholder AI stage.');
  assert.deepEqual(await application.evaluate(() => globalThis.realProgramSmoke.blockedAiCalls), []);
  const forged = await page.evaluate(async () => {
    try { await window.easyHub.binaryAnalyze({ requestId: 'forged-check', source: { kind: 'local', fileId: 'not-granted', name: 'whoami.exe', size: 4096 }, language: 'zh' }); return 'unexpected success'; }
    catch (error) { return error.message; }
  });
  assert.match(forged, /重新选择/);
  assert.equal(createHash('sha256').update(await readFile(sample)).digest('hex'), originalHash);
  assert.deepEqual(errors, []);
  process.stdout.write(`PASS: real Main/Preload extraction and unified UI chain of whoami.exe; ${summary}; ${((Date.now() - started) / 1000).toFixed(1)}s including cancellation; sample unchanged; local placeholder AI only (no provider requests or AI quality claim); no GitHub writes.\n`);
} finally { await application.close(); }
