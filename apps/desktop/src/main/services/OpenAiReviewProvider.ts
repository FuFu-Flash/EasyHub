import OpenAI from 'openai';
import type { AiCredentials, AiReviewProvider } from './AiReviewService';

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** OpenAI-compatible provider, isolated so another protocol can be substituted. */
export class OpenAiReviewProvider implements AiReviewProvider {
  constructor(private readonly fetcher: Fetcher) {}

  async complete(settings: AiCredentials, system: string, content: string, signal: AbortSignal): Promise<string> {
    const base = new URL(`${settings.baseUrl}/`);
    const client = new OpenAI({
      apiKey: settings.apiKey, baseURL: settings.baseUrl, organization: null, project: null, timeout: 90_000, maxRetries: 0, logLevel: 'off',
      fetch: async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.origin !== base.origin || url.pathname !== `${base.pathname}chat/completions`) throw new Error('invalid AI endpoint');
        return this.fetcher(url.href, { ...init, redirect: 'error', credentials: 'omit' });
      },
    });
    try {
      const result = await client.chat.completions.create({
        model: settings.model, messages: [{ role: 'system', content: system }, { role: 'user', content }],
        stream: false,
      }, { signal });
      const choice = result.choices[0];
      if (!choice || choice.finish_reason === 'length' || !choice.message.content) throw new Error('invalid AI response');
      return choice.message.content;
    } catch (cause) {
      if (signal.aborted) throw new Error('AI 审查已取消。');
      if (cause instanceof OpenAI.APIError) {
        if (cause.status === 401 || cause.status === 403) throw new Error('AI 授权失败，请检查 API Key 和模型使用权限。');
        if (cause.status === 429) throw new Error('AI 服务额度不足或请求过多，请稍后重试。');
        if (cause.status === 404) throw new Error('找不到 AI 服务或模型，请检查服务地址和模型名称。');
        if (cause.status === 400 || cause.status === 422) throw new Error('该模型未能接受审查请求，请检查模型名称或更换模型。');
      }
      throw new Error('AI 服务暂时没有返回可用结果，请检查连接或稍后重试。');
    }
  }
}
