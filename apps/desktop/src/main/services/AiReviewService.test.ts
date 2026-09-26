import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitHubPullFile } from '@easyhub/github';
import {
  AiReviewService, normalizeAiBaseUrl, type AiCredentials, type AiReviewContext, type AiReviewProvider,
} from './AiReviewService';

const SHA = 'a'.repeat(40);
const SECRET = 'sk-test-private-value';
const credentials: AiCredentials = { baseUrl: 'https://review.example/v1', model: 'user-selected-model', apiKey: SECRET };
const request = { owner: 'owner', repo: 'project', number: 7, headSha: SHA, requestId: 'review-1', providerBaseUrl: credentials.baseUrl, consentToSend: true };
const cleanReview = JSON.stringify({ summary: '未发现有证据支持的问题。', findings: [] });
const file = (filename = 'src/main.ts', patch = '@@ -1 +1 @@\n-old()\n+new()'): GitHubPullFile => ({ filename, status: 'modified', additions: 1, deletions: 1, patch });

function context(files = [file()]): AiReviewContext {
  return {
    pullRequest: {
      id: 70, number: 7, title: 'Fix the window', body: 'Improve resizing', state: 'open', draft: false,
      merged: false, merged_at: null, created_at: '2026-09-26T00:00:00Z', html_url: 'https://github.com/owner/project/pull/7',
      user: { login: 'contributor' }, comments: 0, changed_files: files.length,
      head: { sha: SHA, ref: 'changes', label: 'contributor:changes' },
      base: { ref: 'main', repo: { id: 10, name: 'project', full_name: 'owner/project', owner: { login: 'owner' } } },
    }, files, filesTruncated: false,
  };
}

function setup(options: { stored?: string | null; context?: AiReviewContext; complete?: AiReviewProvider['complete'] } = {}) {
  let stored = options.stored === undefined ? JSON.stringify(credentials) : options.stored;
  const vault = {
    getPassword: vi.fn(async () => stored),
    setPassword: vi.fn(async (value: string) => { stored = value; }),
  };
  const complete = vi.fn<AiReviewProvider['complete']>(options.complete ?? (async () => cleanReview));
  const loadContext = vi.fn(async () => options.context ?? context());
  return { service: new AiReviewService(vault, { complete }, loadContext), vault, complete, loadContext, stored: () => stored };
}

afterEach(() => { vi.useRealTimers(); });

describe('AI authorization', () => {
  it('returns configuration status without exposing the stored secret', async () => {
    const { service } = setup();
    const status = await service.settings();
    expect(status).toEqual({ providerId: 'legacy', baseUrl: credentials.baseUrl, model: credentials.model, hasApiKey: true });
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(status).not.toHaveProperty('apiKey');
  });

  it('starts unconfigured and refuses review until the user supplies a key', async () => {
    const { service, complete, loadContext } = setup({ stored: null });
    expect(await service.settings()).toEqual({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', hasApiKey: false });
    await expect(service.review(request, vi.fn())).rejects.toThrow('配置 AI API 授权');
    expect(complete).not.toHaveBeenCalled();
    expect(loadContext).not.toHaveBeenCalled();
  });

  it('reuses a key only for the same normalized endpoint and allows an explicit replacement', async () => {
    const { service, stored, vault } = setup();
    expect(await service.save({ providerId: 'legacy', model: 'new-model', apiKey: '' })).toEqual({ providerId: 'legacy', baseUrl: credentials.baseUrl, model: 'new-model', hasApiKey: true });
    expect(JSON.parse(stored() ?? '{}')).toEqual({ ...credentials, model: 'new-model' });
    await expect(service.save({ providerId: 'deepseek', model: 'deepseek-v4-flash' })).rejects.toThrow('重新输入');
    expect(vault.setPassword).toHaveBeenCalledTimes(1);
    await service.save({ providerId: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'another-key' });
    expect(JSON.parse(stored() ?? '{}')).toEqual({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'another-key' });
    expect(await service.settings()).toEqual({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', hasApiKey: true });
  });

  it('resolves each selected provider in Main and refuses an unlisted provider', async () => {
    const { service, stored, vault } = setup({ stored: null });
    await expect(service.save({ providerId: 'custom', model: 'model', apiKey: 'key' })).rejects.toThrow('支持的 AI 服务商');
    await expect(service.save({ providerId: 'legacy', model: 'model', apiKey: 'key' })).rejects.toThrow('重新选择');
    expect(vault.setPassword).not.toHaveBeenCalled();
    await service.save({ providerId: 'openrouter', model: 'openai/gpt-4o-mini', apiKey: 'own-key', baseUrl: 'https://malicious.example/v1' });
    expect(JSON.parse(stored() ?? '{}')).toEqual({ baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', apiKey: 'own-key' });
  });

  it.each([
    ['openai', 'https://api.openai.com/v1'],
    ['deepseek', 'https://api.deepseek.com'],
    ['openrouter', 'https://openrouter.ai/api/v1'],
    ['siliconflow', 'https://api.siliconflow.cn/v1'],
  ])('uses the registered %s destination for requests', async (providerId, baseUrl) => {
    const { service, complete } = setup({ stored: null });
    await service.save({ providerId, model: 'selected-model', apiKey: 'own-key' });
    await service.testConnection();
    expect(complete.mock.calls[0]?.[0]).toEqual({ baseUrl, model: 'selected-model', apiKey: 'own-key' });
  });

  it('removes the key while preserving the endpoint and model', async () => {
    const { service, stored } = setup();
    expect(await service.forgetKey()).toEqual({ providerId: 'legacy', baseUrl: credentials.baseUrl, model: credentials.model, hasApiKey: false });
    expect(stored()).not.toContain(SECRET);
    await expect(service.review(request, vi.fn())).rejects.toThrow('配置 AI API 授权');
  });

  it.each([
    { model: '' }, { model: 'line\nbreak' }, { apiKey: 'key with spaces' }, { apiKey: 'x'.repeat(4097) },
  ])('validates settings before touching secure storage (case %#)', async (invalid) => {
    const { service, vault } = setup();
    await expect(service.save({ providerId: 'legacy', ...credentials, ...invalid })).rejects.toThrow('模型名称和 API Key');
    expect(vault.setPassword).not.toHaveBeenCalled();
  });

  it('translates credential-store failures without exposing their messages', async () => {
    const { service, vault } = setup();
    vault.getPassword.mockRejectedValueOnce(new Error(SECRET));
    await expect(service.settings()).rejects.toThrow('无法读取系统安全存储');
    vault.setPassword.mockRejectedValueOnce(new Error(SECRET));
    await expect(service.save({ providerId: 'legacy', model: credentials.model, apiKey: credentials.apiKey })).rejects.toThrow('无法保存到系统安全存储');
  });

  it.each([
    '', 'not-a-url', 'http://review.example/v1', 'file:///tmp/ai',
    'https://name:secret@review.example/v1', 'https://review.example/v1?apiKey=secret',
    'https://review.example/v1#secret', 'https://review.example/v1/chat/completions',
    'https://review.example/v1/responses/', 'http://localhost.attacker.example/v1',
  ])('rejects unsafe or non-base service URLs: %s', (value) => {
    expect(() => normalizeAiBaseUrl(value)).toThrow();
  });

  it.each([
    [' https://review.example/v1/ ', 'https://review.example/v1'],
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
    ['http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234/v1'],
    ['http://[::1]:1234/v1/', 'http://[::1]:1234/v1'],
  ])('normalizes a secure or explicitly local endpoint: %s', (value, normalized) => {
    expect(normalizeAiBaseUrl(value)).toBe(normalized);
  });
});

describe('AI review consent and context', () => {
  it.each([false, undefined, 'true'])('does not load code or call AI without explicit consent (%s)', async (consentToSend) => {
    const { service, loadContext, complete } = setup();
    await expect(service.review({ ...request, consentToSend }, vi.fn())).rejects.toThrow('确认');
    expect(loadContext).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('requires fresh consent if the configured destination changed', async () => {
    const { service, loadContext, complete } = setup();
    await expect(service.review({ ...request, providerBaseUrl: 'https://different.example/v1' }, vi.fn())).rejects.toThrow('发送目标');
    expect(loadContext).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects a newer revision before sending any content', async () => {
    const changed = context();
    changed.pullRequest.head.sha = 'b'.repeat(40);
    const { service, complete } = setup({ context: changed });
    await expect(service.review(request, vi.fn())).rejects.toThrow('新修改');
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(['number', 'repository'] as const)('rejects mismatched %s context even with an identical revision', async (field) => {
    const changed = context();
    if (field === 'number') changed.pullRequest.number = 8;
    else changed.pullRequest.base.repo = { id: 99, name: 'different', full_name: 'owner/different', owner: { login: 'owner' } };
    const { service, complete } = setup({ context: changed });
    await expect(service.review(request, vi.fn())).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });

  it('sends selected changes as data and reports completion without leaking credentials', async () => {
    const { service, complete } = setup();
    const progress = vi.fn();
    const result = await service.review(request, progress);
    const call = complete.mock.calls[0];
    expect(call?.[0]).toEqual(credentials);
    expect(call?.[1]).toContain('untrusted data');
    expect(call?.[2]).toContain('src/main.ts');
    expect(call?.[2]).not.toContain(SECRET);
    expect(result).toMatchObject({ headSha: SHA, reviewedFiles: 1, totalFiles: 1, findings: [] });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ requestId: request.requestId, completed: 1, total: 1 });
  });

  it('requests the current client language and rejects unsupported language values', async () => {
    const { service, complete } = setup();
    const english = await service.review({ ...request, language: 'en' }, vi.fn());
    expect(complete.mock.calls[0]?.[1]).toContain('English');
    expect(complete.mock.calls[0]?.[1]).not.toContain('Reply in Simplified Chinese');
    expect(english.limitations[0]).toContain('No code or tests were run');
    await expect(service.review({ ...request, language: 'fr' }, vi.fn())).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('tests connectivity without loading or sharing project code', async () => {
    const { service, complete, loadContext } = setup({ complete: async () => 'OK' });
    await service.testConnection();
    expect(loadContext).not.toHaveBeenCalled();
    expect(complete.mock.calls[0]?.[2]).toContain('No project content is included');
  });
});

describe('bounded AI review and cancellation', () => {
  it('bounds oversized changes and makes skipped content explicit', async () => {
    const files = Array.from({ length: 20 }, (_, i) => file(`file-${i}.ts`, '+x'.repeat(30_000)));
    files.push({ filename: 'image.png', status: 'added', additions: 0, deletions: 0 });
    const supplied = context(files);
    supplied.filesTruncated = true;
    supplied.pullRequest.changed_files = 3500;
    const { service, complete } = setup({ context: supplied });
    const result = await service.review(request, vi.fn());
    expect(complete.mock.calls.length).toBeGreaterThan(1);
    expect(complete.mock.calls.length).toBeLessThanOrEqual(8);
    const payloads = complete.mock.calls.map((call) => JSON.parse(call[2]) as { files: { filename: string; patch: string }[] });
    const sentFiles = payloads.flatMap((payload) => payload.files);
    expect(sentFiles.every((entry) => entry.patch.length <= 22_500)).toBe(true);
    expect(sentFiles.reduce((sum, entry) => sum + entry.patch.length, 0)).toBeLessThanOrEqual(144_000);
    expect(sentFiles.some((entry) => entry.filename === 'image.png')).toBe(false);
    expect(result.reviewedFiles).toBeLessThan(21);
    expect(result.totalFiles).toBe(3500);
    expect(result.limitations.join('\n')).toContain('1 个文件');
    expect(result.limitations.join('\n')).toContain('部分内容');
    expect(result.limitations.join('\n')).toContain('GitHub');
  });

  it('refuses an AI call when all changes lack reviewable text', async () => {
    const { service, complete } = setup({ context: context([{ filename: 'binary.bin', status: 'added', additions: 0, deletions: 0 }]) });
    await expect(service.review(request, vi.fn())).rejects.toThrow('没有可供 AI 审查的文字修改');
    expect(complete).not.toHaveBeenCalled();
  });

  it('cancels the in-flight request, prevents another operation, and permits a new review afterwards', async () => {
    const { service, complete } = setup();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    complete.mockImplementationOnce(async (_settings, _system, _content, signal) => {
      started();
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    });
    const pending = service.review(request, vi.fn());
    const cancelled = expect(pending).rejects.toThrow('AI 审查已取消');
    await ready;
    await expect(service.review({ ...request, requestId: 'other' }, vi.fn())).rejects.toThrow('正在进行');
    await expect(service.save({ providerId: 'legacy', model: credentials.model, apiKey: credentials.apiKey })).rejects.toThrow('取消审查');
    service.cancel(request.requestId);
    await cancelled;
    expect(await service.review({ ...request, requestId: 'next' }, vi.fn())).toMatchObject({ headSha: SHA });
  });

  it('applies an overall deadline and translates the resulting abort', async () => {
    vi.useFakeTimers();
    const { service, complete } = setup();
    complete.mockImplementationOnce(async (_settings, _system, _content, signal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = service.review(request, vi.fn());
    const timedOut = expect(pending).rejects.toThrow('等待时间较长');
    await vi.advanceTimersByTimeAsync(120_001);
    await timedOut;
  });
});

describe('AI result validation', () => {
  it.each([
    'not JSON', JSON.stringify({ findings: [] }), JSON.stringify({ summary: 'OK', findings: 'wrong' }),
    JSON.stringify({ summary: 'OK', findings: [{ severity: 'high', file: 'not-in-this-request.ts', line: 1, description: 'A defect', suggestion: 'Fix it' }] }),
    JSON.stringify({ summary: 'OK', findings: [{ severity: 'high', file: 'src/main.ts', line: -1, description: 'A defect', suggestion: 'Fix it' }] }),
    JSON.stringify({ summary: 'OK', findings: [{ severity: 'critical', file: 'src/main.ts', line: 1, description: 'A defect', suggestion: 'Fix it' }] }),
  ])('refuses malformed or unsupported findings (%s)', async (reply) => {
    const { service } = setup({ complete: async () => reply });
    await expect(service.review(request, vi.fn())).rejects.toThrow('AI');
  });

  it('accepts fenced JSON and a finding for a supplied file with no exact line', async () => {
    const finding = { severity: 'medium', file: 'src/main.ts', line: null, description: '检查了错误的变量。', suggestion: '检查实际使用的变量。' };
    const { service } = setup({ complete: async () => `\`\`\`json\n${JSON.stringify({ summary: '发现一个问题。', findings: [finding] })}\n\`\`\`` });
    expect((await service.review(request, vi.fn())).findings).toEqual([{ ...finding, line: undefined }]);
  });
});
