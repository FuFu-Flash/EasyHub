import { describe, expect, it, vi } from 'vitest';
import { OpenAiReviewProvider } from './OpenAiReviewProvider';

const credentials = { baseUrl: 'https://user-service.example/v1', model: 'user-model', apiKey: 'sk-private-test-key' };
const success = (content = '{"summary":"OK","findings":[]}') => new Response(JSON.stringify({
  id: 'completion-1', object: 'chat.completion', created: 0, model: credentials.model,
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('OpenAI-compatible review provider', () => {
  it('uses only the selected endpoint and key, disables redirects, and omits ambient cookies', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => success());
    const provider = new OpenAiReviewProvider(fetcher);
    const controller = new AbortController();
    expect(await provider.complete(credentials, 'Review instructions', 'Change content', controller.signal)).toContain('summary');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://user-service.example/v1/chat/completions');
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${credentials.apiKey}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({ model: credentials.model, stream: false,
      messages: [{ role: 'system', content: 'Review instructions' }, { role: 'user', content: 'Change content' }],
    });
    expect(String(init.body)).not.toContain(credentials.apiKey);
  });

  it.each([
    [401, '授权失败'], [403, '授权失败'], [429, '额度不足或请求过多'], [404, '找不到 AI 服务或模型'],
    [400, '未能接受审查请求'], [422, '未能接受审查请求'], [500, '没有返回可用结果'],
  ])('sanitizes a %s error and does not retry it', async (status, expected) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: {
      message: `RAW_UPSTREAM_SECRET ${credentials.apiKey}`, type: 'service_error', code: 'invalid_key',
    } }), { status: Number(status), headers: { 'content-type': 'application/json' } }));
    const provider = new OpenAiReviewProvider(fetcher);
    const error: unknown = await provider.complete(credentials, 'system', 'content', new AbortController().signal).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(String(expected));
    expect(String(error)).not.toContain(credentials.apiKey);
    expect(String(error)).not.toContain('RAW_UPSTREAM_SECRET');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sanitizes a network failure without exposing transport details', async () => {
    const provider = new OpenAiReviewProvider(async () => { throw new Error(`network debug ${credentials.apiKey}`); });
    const error: unknown = await provider.complete(credentials, 'system', 'content', new AbortController().signal).catch((cause: unknown) => cause);
    expect(String(error)).toContain('没有返回可用结果');
    expect(String(error)).not.toContain(credentials.apiKey);
    expect(String(error)).not.toContain('network debug');
  });

  it.each([
    { choices: [] },
    { choices: [{ finish_reason: 'length', message: { content: '{"summary":"truncated' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: null } }] },
  ])('rejects an incomplete response (%j)', async (body) => {
    const provider = new OpenAiReviewProvider(async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
    await expect(provider.complete(credentials, 'system', 'content', new AbortController().signal)).rejects.toThrow('没有返回可用结果');
  });

  it('does not contact the provider after an operation has already been cancelled', async () => {
    const fetcher = vi.fn(async () => success());
    const provider = new OpenAiReviewProvider(fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(provider.complete(credentials, 'system', 'content', controller.signal)).rejects.toThrow('审查已取消');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('propagates cancellation to an active network operation', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const provider = new OpenAiReviewProvider(async (_url, init) => {
      started();
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    const controller = new AbortController();
    const pending = provider.complete(credentials, 'system', 'content', controller.signal);
    const cancelled = expect(pending).rejects.toThrow('审查已取消');
    await ready;
    controller.abort();
    await cancelled;
  });
});
