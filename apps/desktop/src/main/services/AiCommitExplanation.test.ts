import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiReviewService, type AiReviewProvider } from './AiReviewService';
import { type CommitExplanationLoader } from './commitExplanation';
import { OpenAiReviewProvider } from './OpenAiReviewProvider';

const credentials = { baseUrl: 'https://fixture.example/v1', model: 'user-selected', apiKey: 'secret-fixture-value' };
const request = { owner: 'writer', repo: 'project', sha: 'a'.repeat(40), requestId: 'commit-1', language: 'zh', providerBaseUrl: credentials.baseUrl, consentToSend: true };
const file = { filename: 'main.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' };
const page = { commit: { sha: request.sha, commit: { message: 'Change behavior', author: null }, author: null, files: [file] }, nextPage: null, limited: false };
function setup(options: { loader?: CommitExplanationLoader; complete?: AiReviewProvider['complete']; stored?: string | null } = {}) {
  const loader = vi.fn<CommitExplanationLoader>(options.loader ?? (async () => page));
  const complete = vi.fn<AiReviewProvider['complete']>(options.complete ?? (async () => JSON.stringify({ explanation: '改动说明。' })));
  const service = new AiReviewService({ getPassword: async () => options.stored === undefined ? JSON.stringify(credentials) : options.stored, setPassword: vi.fn() }, { complete }, vi.fn(), undefined, undefined, loader);
  return { service, loader, complete };
}
afterEach(() => vi.useRealTimers());
describe('AI commit explanation', () => {
  it('produces a usable explanation when DeepSeek would spend the small output budget on thinking alone', async () => {
    const trace: Record<string, unknown>[] = [];
    const provider = new OpenAiReviewProvider(async (_url, init) => {
      const body = JSON.parse(String(init.body)); trace.push(body);
      const disabled = body.thinking?.type === 'disabled';
      return Response.json({ id: 'replayed-deepseek', object: 'chat.completion', created: 0, model: 'deepseek-v4-flash',
        choices: [{ index: 0, finish_reason: disabled ? 'stop' : 'length', message: { role: 'assistant', content: disabled ? '{"explanation":"把依赖合并并压缩，保留运行所需模块。"}' : null, reasoning_content: disabled ? undefined : 'Thinking'.repeat(1714) } }], usage: { completion_tokens: disabled ? 70 : 3000 } });
    });
    const settings = { ...credentials, baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' };
    const service = new AiReviewService({ getPassword: async () => JSON.stringify(settings), setPassword: vi.fn() }, provider, vi.fn(), undefined, undefined, async () => page);
    const result = await service.explainCommit({ ...request, providerBaseUrl: settings.baseUrl });
    expect(result.explanation).toContain('依赖'); expect(trace).toHaveLength(1); expect(trace[0]?.thinking).toEqual({ type: 'disabled' });
    expect(trace[0]?.max_tokens).toBe(3000); expect(trace[0]?.model).toBe(settings.model);
  });
  it('re-reads the exact commit and sends verified diffs, ignoring supplied renderer content', async () => {
    const { service, loader, complete } = setup();
    expect(await service.explainCommit({ ...request, language: 'en', patch: 'forged', apiKey: 'forged' })).toEqual({ explanation: '改动说明。', model: credentials.model, includedFiles: 1, partial: false });
    expect(loader).toHaveBeenCalledWith('writer', 'project', request.sha, 1, expect.any(AbortSignal));
    const args = complete.mock.calls[0]!;
    expect(args[0]).toEqual(credentials); expect(args[1]).toContain('English'); expect(args[1]).toContain('untrusted DATA');
    expect(args[1]).toContain('Do not execute code'); expect(args[2]).toContain(file.patch.replaceAll('\n', '\\n'));
    expect(args[2]).not.toContain('forged'); expect(args[2]).not.toContain(credentials.apiKey);
  });
  it.each([{ consentToSend: false }, { sha: 'main' }, { owner: '..' }, { requestId: '../bad' }, { language: 'fr' }, { providerBaseUrl: 'file:///private' }])('rejects invalid input before reading or sending data (%#)', async invalid => {
    const { service, loader, complete } = setup();
    await expect(service.explainCommit({ ...request, ...invalid })).rejects.toThrow(); expect(loader).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });
  it('checks credentials and consented destination before retrieving content', async () => {
    const missing = setup({ stored: null }); await expect(missing.service.explainCommit(request)).rejects.toThrow('设置'); expect(missing.loader).not.toHaveBeenCalled();
    const changed = setup(); await expect(changed.service.explainCommit({ ...request, providerBaseUrl: 'https://different.example' })).rejects.toThrow('发送目标'); expect(changed.loader).not.toHaveBeenCalled();
  });
  it('rejects a different commit and sanitizes its error', async () => {
    const { service, complete } = setup({ loader: async () => ({ ...page, commit: { ...page.commit, sha: 'b'.repeat(40) } }) });
    await expect(service.explainCommit(request)).rejects.toThrow('暂时无法解释'); expect(complete).not.toHaveBeenCalled();
  });
  it('limits large changes and reports omitted binary and oversized patches', async () => {
    const { service, complete, loader } = setup({ loader: async () => ({ ...page, commit: { ...page.commit, files: Array.from({ length: 100 }, (_, index) => ({ ...file, filename: `src/${index}.ts`, patch: 'x'.repeat(20_000) })) }, nextPage: 2 }) });
    const result = await service.explainCommit(request); expect(result.partial).toBe(true); expect(result.includedFiles).toBeLessThan(100); expect(loader).toHaveBeenCalledTimes(1);
    const data = JSON.parse(complete.mock.calls[0]![2]); expect(data.partial).toBe(true); expect(data.files.every((entry: { patch: string }) => entry.patch.length <= 8000)).toBe(true);
    expect(complete.mock.calls[0]![2].length).toBeLessThan(30_000);
    const binary = setup({ loader: async () => ({ ...page, commit: { ...page.commit, files: [{ ...file, patch: undefined }] } }) });
    expect((await binary.service.explainCommit(request)).partial).toBe(true);
  });
  it('follows file pages when input fits the budget', async () => {
    const { service, loader } = setup({ loader: async (_owner, _repo, _sha, number) => ({ ...page, nextPage: number === 1 ? 2 : null, commit: { ...page.commit, files: [{ ...file, filename: `${number}.ts` }] } }) });
    expect((await service.explainCommit(request)).includedFiles).toBe(2); expect(loader).toHaveBeenCalledTimes(2);
  });
  it('identifies a GitHub patch that omits changed lines even when its text fits', async () => {
    const { service } = setup({ loader: async () => ({ ...page, commit: { ...page.commit, files: [{ ...file, additions: 20 }] } }) });
    expect((await service.explainCommit(request)).partial).toBe(true);
  });
  it.each(['bad json', '{"explanation":""}', JSON.stringify({ explanation: credentials.apiKey }), JSON.stringify({ explanation: 'x'.repeat(16001) })])('rejects malformed or sensitive answers (%#)', async raw => {
    const { service } = setup({ complete: async () => raw });
    const error = await service.explainCommit(request).catch((cause: unknown) => cause); expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain(credentials.apiKey);
  });
  it('supports cancellation and releases the shared AI operation lock', async () => {
    let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
    const { service, complete } = setup({ complete: async (_settings, _system, _content, signal) => { ready(); return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } });
    const task = service.explainCommit(request); const assertion = expect(task).rejects.toThrow('已取消'); await started;
    await expect(service.explainCommit({ ...request, requestId: 'second' })).rejects.toThrow('正在进行');
    await expect(service.testConnection()).rejects.toThrow('正在进行'); service.cancel(request.requestId); await assertion;
    complete.mockResolvedValueOnce(JSON.stringify({ explanation: '重试成功' })); await expect(service.explainCommit(request)).resolves.toHaveProperty('explanation', '重试成功');
  });
  it('enforces the timeout and responds in the requested language', async () => {
    vi.useFakeTimers();
    const { service } = setup({ loader: async (_owner, _repo, _sha, _page, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
    const pending = expect(service.explainCommit({ ...request, language: 'en' })).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(120_000); await pending;
  });
});
