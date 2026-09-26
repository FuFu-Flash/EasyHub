import assert from 'node:assert/strict';
import { isAbsolute, join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const executableArgument = process.argv.find((argument) => argument.startsWith('--executable='));
const executable = executableArgument?.slice('--executable='.length);
if (executableArgument && (!executable || !isAbsolute(executable))) throw new Error('--executable requires an absolute path.');
const profileArgument = `--user-data-dir=${join(process.cwd(), 'out/ai-review-smoke-profile')}`;
const app = await electron.launch({ executablePath: executable || electronPath, args: executable ? [profileArgument] : ['.', profileArgument], cwd: process.cwd() });
try {
  await app.evaluate(({ ipcMain }) => {
    const owned = { id: 901, name: 'owned-repo', full_name: 'test-owner/owned-repo', description: 'Review example', private: false, archived: false, permissions: { admin: true, push: true, pull: true }, updated_at: new Date().toISOString(), default_branch: 'main', owner: { login: 'test-owner' }, open_issues_count: 0 };
    const external = { ...owned, id: 902, name: 'external-repo', full_name: 'someone/external-repo', owner: { login: 'someone' }, permissions: { admin: false, push: false, pull: true } };
    const requests = [1, 2, 3, 4].map((number) => ({ id: 100 + number, number, title: ['Improve validation', 'Remove obsolete option', 'Updated by author', 'Missing target version'][number - 1], body: 'Please review these changes.', state: 'open', draft: false, merged: false, merged_at: null, created_at: new Date().toISOString(), html_url: `https://github.com/test-owner/owned-repo/pull/${number}`, user: { login: 'contributor' }, comments: 0, changed_files: 2, head: { ref: 'improvement', label: 'contributor:improvement', sha: String(number).repeat(40) }, base: { ref: 'main', ...(number === 4 ? {} : { sha: 'a'.repeat(40) }) } }));
    const providers = { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com', openrouter: 'https://openrouter.ai/api/v1', siliconflow: 'https://api.siliconflow.cn/v1' };
    let aiSettings = { providerId: 'openai', baseUrl: providers.openai, model: 'gpt-4.1-mini', hasApiKey: false };
    let aiSlow = false;
    globalThis.easyhubAiSmoke = { saves: [], tests: 0, reviews: [], downloads: [], decisions: [], cancels: [] };
    const handle = (channel, callback) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, callback); };
    handle('easyhub:auth-status', () => ({ user: { login: 'test-owner', name: 'Owner', avatar_url: '', html_url: '' }, clientId: 'test-client' }));
    handle('easyhub:local-list', () => []);
    handle('easyhub:local-discovery-roots', () => []);
    handle('easyhub:ai-settings', () => aiSettings);
    handle('easyhub:ai-save-settings', (_event, input) => { if (!providers[input.providerId]) throw new Error('Unknown provider'); if ((!aiSettings.hasApiKey || input.providerId !== aiSettings.providerId) && !input.apiKey) throw new Error('New key required'); globalThis.easyhubAiSmoke.saves.push({ providerId: input.providerId, model: input.model, receivedKey: Boolean(input.apiKey) }); aiSettings = { providerId: input.providerId, baseUrl: providers[input.providerId], model: input.model, hasApiKey: true }; return aiSettings; });
    handle('easyhub:ai-test-connection', () => { globalThis.easyhubAiSmoke.tests += 1; });
    handle('easyhub:ai-forget-key', () => { aiSettings = { ...aiSettings, hasApiKey: false }; return aiSettings; });
    handle('easyhub:ai-cancel-review', (_event, id) => { globalThis.easyhubAiSmoke.cancels.push(id); });
    handle('easyhub:ai-review-pull', async (event, input) => {
      globalThis.easyhubAiSmoke.reviews.push(input);
      event.sender.send('easyhub:ai-review-progress', { requestId: input.requestId, phase: 'reviewing', completed: 1, total: 2 });
      await new Promise((resolve) => setTimeout(resolve, aiSlow ? 2200 : 300));
      return { headSha: input.headSha, summary: aiSlow ? 'This cancelled review must stay hidden.' : 'Input validation needs one additional check.', reviewedFiles: 1, totalFiles: 2, findings: [{ severity: 'medium', file: 'src/validation.ts', line: 8, description: 'Empty strings currently pass validation.', suggestion: 'Trim the value and check its length.' }], limitations: ['The deleted file was not reviewed.'] };
    });
    handle('easyhub:download-pull-file', async (event, ...args) => {
      globalThis.easyhubAiSmoke.downloads.push(args);
      event.sender.send('easyhub:download-progress', { loaded: 24, total: 48, percent: 50 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return 'C:\\Downloads\\validation.ts';
    });
    handle('easyhub:github', (_event, action, ...args) => {
      if (action === 'repos') return [owned];
      if (action === 'readme') return '# Review example';
      if (action === 'issues' || action === 'commits' || action === 'comments') return [];
      if (action === 'issuesPage') return { items: [], nextPage: null };
      if (action === 'pullRequests') return requests;
      if (action === 'pullRequest') return requests.find((request) => request.number === args[2]);
      if (action === 'pullReviewContext') return { repository: args[0] === 'someone' ? external : owned, pullRequest: requests.find((request) => request.number === args[2]), filesTruncated: false, files: [{ filename: 'src/validation.ts', status: 'modified', additions: 4, deletions: 1 }, { filename: 'old-option.txt', status: 'removed', additions: 0, deletions: 8 }] };
      if (action === 'pullFiles') return [{ filename: 'src/validation.ts', status: 'modified', additions: 4, deletions: 1 }, { filename: 'old-option.txt', status: 'removed', additions: 0, deletions: 8 }];
      if (action === 'publicRepo' || action === 'repository') { aiSlow = true; return external; }
      if (action === 'acceptPullRequest' || action === 'rejectPullRequest') {
        globalThis.easyhubAiSmoke.decisions.push({ action, args });
        if (args[2] === 3) throw new Error('这次改进已更新，请重新获取后再决定。');
        const request = requests.find((item) => item.number === args[2]);
        if (args[3].expectedBaseRef !== request.base.ref || args[3].expectedBaseSha !== request.base.sha) throw new Error('目标版本已更新，请重新获取后再决定。');
        request.state = 'closed'; request.merged = action === 'acceptPullRequest'; request.merged_at = request.merged ? new Date().toISOString() : null;
        return request.merged ? { merged: true, sha: request.head.sha, message: 'Merged' } : request;
      }
      throw new Error(`Unexpected mock action: ${action}`);
    });
  });
  const page = await app.firstWindow();
  await page.evaluate(() => { localStorage.setItem('easyhub:language', 'zh'); localStorage.removeItem('easyhub:auto-translate'); });
  await page.reload();
  await page.locator('.live-connected').waitFor();

  await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('region', { name: 'AI API 授权' });
  assert.equal(await settings.getByLabel('AI 服务商', { exact: true }).inputValue(), 'openai');
  assert.equal(await settings.locator('input[type="url"]').count(), 0);
  assert.equal(await settings.getByLabel('模型名称', { exact: true }).inputValue(), 'gpt-4.1-mini');
  await settings.locator('input[type="password"]').fill('smoke-user-supplied-key');
  await settings.getByRole('button', { name: '保存授权' }).click();
  await settings.getByText('AI 设置已保存。', { exact: true }).waitFor();
  assert.equal(await settings.locator('input[type="password"]').inputValue(), '');
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('smoke-user-supplied-key')), false);
  await settings.getByRole('button', { name: '测试连接' }).click();
  await settings.getByText('连接成功，可以开始 AI 审查。').waitFor();
  assert.equal(await app.evaluate(() => globalThis.easyhubAiSmoke.tests), 1);
  await settings.getByLabel('AI 服务商', { exact: true }).selectOption('deepseek');
  assert.equal(await settings.getByLabel('模型名称', { exact: true }).inputValue(), 'deepseek-v4-flash');
  assert.equal(await settings.getByRole('button', { name: '保存授权' }).isDisabled(), true);
  await settings.locator('input[type="password"]').fill('smoke-deepseek-key');
  await settings.getByRole('button', { name: '保存授权' }).click();
  await settings.getByText('AI 设置已保存。', { exact: true }).waitFor();
  assert.deepEqual((await app.evaluate(() => globalThis.easyhubAiSmoke.saves)).map((item) => [item.providerId, item.model]), [['openai', 'gpt-4.1-mini'], ['deepseek', 'deepseek-v4-flash']]);
  await page.screenshot({ path: 'out/ai-settings-smoke.png' });

  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: /我的云端项目/ }).click();
  await page.locator('.cloud-row').filter({ hasText: 'owned-repo' }).getByRole('button', { name: '查看', exact: true }).click();
  await page.getByRole('button', { name: '查看改进请求' }).click();
  const pulls = page.locator('.pull-requests-panel');
  await pulls.getByRole('button').filter({ hasText: 'Improve validation' }).click();
  await pulls.getByRole('button', { name: '批准并合入', exact: true }).waitFor();
  await pulls.getByRole('button', { name: 'AI 审查', exact: true }).click();
  const consent = page.getByRole('dialog', { name: '使用 AI 审查这次改进？' });
  await consent.getByText('https://api.deepseek.com', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.easyhubAiSmoke.reviews.length), 0);
  await consent.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.easyhubAiSmoke.reviews.length), 0);
  await pulls.getByRole('button', { name: 'AI 审查', exact: true }).click();
  await consent.getByRole('button', { name: '同意并开始审查' }).click();
  await pulls.getByText('Input validation needs one additional check.').waitFor();
  const aiRequest = await app.evaluate(() => globalThis.easyhubAiSmoke.reviews[0]);
  assert.equal(aiRequest.consentToSend, true);
  assert.equal(aiRequest.providerBaseUrl, 'https://api.deepseek.com');
  assert.equal(aiRequest.headSha, '1'.repeat(40));

  assert.equal(await pulls.getByRole('button', { name: '下载文件 old-option.txt' }).isDisabled(), true);
  await pulls.getByRole('button', { name: '下载文件 src/validation.ts' }).click();
  await page.getByRole('dialog', { name: '下载通知' }).getByText('validation.ts', { exact: true }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.easyhubAiSmoke.downloads[0]), ['test-owner', 'owned-repo', 1, 'src/validation.ts', '1'.repeat(40)]);
  await page.getByRole('button', { name: '通知', exact: true }).click();

  await page.setViewportSize({ width: 900, height: 760 });
  const overflow = await pulls.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  assert.equal(overflow, false, 'Review panel must fit a narrow window');
  await page.screenshot({ path: 'out/ai-review-smoke.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await pulls.getByRole('button', { name: '批准并合入', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.easyhubAiSmoke.decisions.length), 0);
  await page.getByRole('dialog', { name: '批准并合入这次改进？' }).getByRole('button', { name: '确认批准并合入' }).click();
  await pulls.getByText('改进已批准并合入项目。').waitFor();
  assert.equal(await pulls.getByRole('button', { name: '批准并合入', exact: true }).count(), 0);
  const approval = await app.evaluate(() => globalThis.easyhubAiSmoke.decisions[0]);
  assert.equal(approval.action, 'acceptPullRequest');
  assert.equal(approval.args[3].expectedHeadSha, '1'.repeat(40));
  assert.equal(approval.args[3].expectedBaseRef, 'main');
  assert.equal(approval.args[3].expectedBaseSha, 'a'.repeat(40));

  await pulls.getByRole('button', { name: '返回改进请求' }).click();
  await pulls.getByRole('button').filter({ hasText: 'Remove obsolete option' }).click();
  await pulls.getByRole('button', { name: '拒绝', exact: true }).click();
  const rejection = page.getByRole('dialog', { name: '拒绝并关闭这次请求？' });
  await rejection.getByLabel('拒绝原因（选填）').fill('This option is still needed.');
  await rejection.getByRole('button', { name: '确认拒绝并关闭' }).click();
  await pulls.getByText('改进请求已拒绝并关闭。').waitFor();
  const denied = await app.evaluate(() => globalThis.easyhubAiSmoke.decisions[1]);
  assert.equal(denied.action, 'rejectPullRequest');
  assert.equal(denied.args[3].reason, 'This option is still needed.');
  assert.equal(denied.args[3].expectedBaseRef, 'main');
  assert.equal(denied.args[3].expectedBaseSha, 'a'.repeat(40));

  await pulls.getByRole('button', { name: '返回改进请求' }).click();
  await pulls.getByRole('button').filter({ hasText: 'Updated by author' }).click();
  await pulls.getByRole('button', { name: '批准并合入', exact: true }).click();
  await page.getByRole('dialog', { name: '批准并合入这次改进？' }).getByRole('button', { name: '确认批准并合入' }).click();
  await pulls.getByRole('alert').getByText('这次改进已更新，请重新获取后再决定。', { exact: true }).waitFor();
  assert.equal(await pulls.getByText('改进已批准并合入项目。').count(), 0);

  await pulls.getByRole('button', { name: '返回改进请求' }).click();
  await pulls.getByRole('button').filter({ hasText: 'Missing target version' }).click();
  await pulls.getByText('src/validation.ts', { exact: true }).waitFor();
  assert.equal(await pulls.getByRole('button', { name: '批准并合入', exact: true }).isDisabled(), true);
  assert.equal(await pulls.getByRole('button', { name: '拒绝', exact: true }).isDisabled(), true);
  assert.equal(await pulls.getByRole('button', { name: 'AI 审查', exact: true }).isDisabled(), false);

  await page.locator('.topbar-search input').fill('https://github.com/someone/external-repo');
  await page.locator('.topbar-search input').press('Enter');
  const publicBrowser = page.getByTestId('public-project-browser');
  await publicBrowser.getByRole('button', { name: '改进请求', exact: true }).click();
  await pulls.getByRole('button').filter({ hasText: 'Updated by author' }).click();
  await pulls.getByText('src/validation.ts', { exact: true }).waitFor();
  assert.equal(await pulls.getByRole('button', { name: '批准并合入', exact: true }).count(), 0);
  assert.equal(await pulls.getByRole('button', { name: '拒绝', exact: true }).count(), 0);
  await pulls.getByRole('button', { name: 'AI 审查', exact: true }).click();
  await consent.getByRole('button', { name: '同意并开始审查' }).click();
  await pulls.getByRole('button', { name: '取消审查' }).click();
  await page.waitForTimeout(2300);
  assert.equal(await pulls.getByText('This cancelled review must stay hidden.').count(), 0);
  assert.equal(await app.evaluate(() => globalThis.easyhubAiSmoke.cancels.length), 1);
  process.stdout.write('AI settings, explicit review consent, file download, approval, rejection, head/base pinning, missing target protection, stale request, read-only permissions, cancellation, and narrow layout smoke tests passed.\n');
} finally { await app.close(); }
