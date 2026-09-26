import type { AiProviderId } from '@easyhub/types';

export interface AiProviderOption {
  id: AiProviderId;
  name: string;
  baseUrl: string;
  defaultModel: string;
}

export const AI_PROVIDERS: readonly AiProviderOption[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-v4-flash' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini' },
  { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'deepseek-ai/DeepSeek-V4-Flash' },
];

export function aiProvider(id: unknown): AiProviderOption | undefined {
  return AI_PROVIDERS.find((provider) => provider.id === id);
}

export function aiProviderForBaseUrl(baseUrl: string): AiProviderOption | undefined {
  return AI_PROVIDERS.find((provider) => provider.baseUrl === baseUrl);
}
