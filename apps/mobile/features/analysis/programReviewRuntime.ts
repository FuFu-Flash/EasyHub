import { loadAiSettings } from '../ai/settings';
import { reviewBinaryEvidence } from '../ai/review';
import { analyzeFile } from './native';
import type { ProgramReviewServices } from './programReview';

export const isProgramReviewUiTest = __DEV__ && process.env.EXPO_PUBLIC_UI_TEST === '1';

export const programReviewServices: ProgramReviewServices = {
  loadSettings: () => isProgramReviewUiTest
    ? Promise.resolve({ providerId: 'openai', model: 'ui-test-model', apiKey: 'local-ui-test-key' })
    : loadAiSettings(),
  analyze: analyzeFile,
  review: (input) => reviewBinaryEvidence({ ...input, ...(isProgramReviewUiTest ? { fetcher: async (_url: string, init: RequestInit) => {
    // Exercise the real bounded prompt/parser with a local response; no network or credentials.
    const signal = init.signal;
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, 4000);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
    });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      summary: input.language === 'en' ? 'Local UI test: recovered program evidence was received and reviewed.' : '本地界面测试：已接收并审查提取的程序证据。', findings: [],
    }) } }] }), { headers: { 'Content-Type': 'application/json' } });
  } } : {}) }),
};
