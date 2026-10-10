import type { BinaryAiReviewResult, BinaryAnalysisResult } from '@easyhub/types';
import { AI_PROVIDERS, validateAiSettings, type AiSettings } from '../ai/review.ts';
import { throwIfCancelled } from '../network/cancellation.js';
import type { AnalysisProgress } from './native';
import { MAX_ANALYSIS_BYTES } from './source.ts';

export interface ProgramReviewFile { uri: string; name: string; size: number | null }
export interface ProgramReviewPreparation {
  readonly file: Readonly<ProgramReviewFile>;
  readonly settings: Readonly<AiSettings>;
  readonly providerBaseUrl: string;
}
export interface ProgramReviewServices {
  loadSettings(): Promise<AiSettings | null>;
  analyze(input: { requestId: string; uri: string; name: string; language: 'zh' | 'en'; expectedSize?: number }, signal: AbortSignal, progress: (value: AnalysisProgress) => void): Promise<BinaryAnalysisResult>;
  review(input: { analysis: BinaryAnalysisResult; settings: AiSettings; language: 'zh' | 'en'; signal: AbortSignal; consentToSend: true; providerBaseUrl: string }): Promise<BinaryAiReviewResult>;
}

function validateFile(file: ProgramReviewFile, language: 'zh' | 'en'): ProgramReviewFile {
  if (!file || typeof file.uri !== 'string' || !/^(?:content|file):\/\//u.test(file.uri) ||
    typeof file.name !== 'string' || !file.name.trim() || file.name.length > 240 || /[\x00-\x1f\x7f]/u.test(file.name) ||
    (file.size !== null && (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_ANALYSIS_BYTES))) {
    throw new Error(language === 'en' ? 'Choose a readable, nonempty program file up to 128 MB.' : '请选择可读取、非空且不超过 128 MB 的程序文件。');
  }
  return { uri: file.uri, name: file.name, size: file.size };
}

async function readSettings(language: 'zh' | 'en', services: Pick<ProgramReviewServices, 'loadSettings'>): Promise<AiSettings> {
  const saved = await services.loadSettings();
  if (!saved) throw new Error(language === 'en' ? 'Connect your AI service in Settings first.' : '请先在设置中连接你的 AI 服务。');
  return validateAiSettings(saved);
}

/** Preparation only reads configuration; neither extraction nor sending starts here. */
export async function prepareProgramReview(file: ProgramReviewFile, language: 'zh' | 'en', services: Pick<ProgramReviewServices, 'loadSettings'>): Promise<ProgramReviewPreparation> {
  const selected = validateFile(file, language);
  const settings = await readSettings(language, services);
  const provider = AI_PROVIDERS.find((item) => item.id === settings.providerId)!;
  return Object.freeze({ file: Object.freeze(selected), settings: Object.freeze(settings), providerBaseUrl: provider.baseUrl });
}

/** One confirmed operation owns extraction, AI review, cancellation and evidence identity. */
export async function runProgramReview(input: {
  requestId: string; prepared: ProgramReviewPreparation; consentToSend: true; language: 'zh' | 'en'; signal: AbortSignal;
  onProgress?: (value: AnalysisProgress) => void;
  onStage?: (stage: 'extracting' | 'reviewing') => void;
  onAnalysis?: (analysis: BinaryAnalysisResult) => void;
}, services: ProgramReviewServices): Promise<{ analysis: BinaryAnalysisResult; review: BinaryAiReviewResult }> {
  const { language, signal } = input;
  throwIfCancelled(signal);
  if (input.consentToSend !== true || (language !== 'zh' && language !== 'en')) throw new Error('请先确认要发送的程序证据和服务地址。');
  const file = validateFile(input.prepared.file, language);
  const confirmed = validateAiSettings(input.prepared.settings);
  const provider = AI_PROVIDERS.find((item) => item.id === confirmed.providerId)!;
  const checkSettings = async () => {
    const current = await readSettings(language, services);
    throwIfCancelled(signal);
    if (current.providerId !== confirmed.providerId || current.model !== confirmed.model || current.apiKey !== confirmed.apiKey ||
      input.prepared.providerBaseUrl !== provider.baseUrl) {
      throw new Error(language === 'en' ? 'AI settings changed. Confirm the destination and model again.' : 'AI 设置已变化，请重新确认服务地址和模型。');
    }
    return current;
  };
  await checkSettings();
  throwIfCancelled(signal);
  input.onStage?.('extracting');
  const analysis = await services.analyze({ requestId: input.requestId, uri: file.uri, name: file.name, language,
    ...(file.size === null ? {} : { expectedSize: file.size }) }, signal, (value) => {
    if (!signal.aborted) input.onProgress?.(value);
  });
  throwIfCancelled(signal);
  if (analysis.id !== input.requestId || analysis.fileName !== file.name || (file.size !== null && analysis.size !== file.size)) {
    throw new Error(language === 'en' ? 'The program evidence does not match the selected file. Select it again.' : '提取证据与所选文件不符，请重新选择文件。');
  }
  // Preserve locally recovered evidence even if authorization changed or AI fails.
  input.onAnalysis?.(analysis);
  const settings = await checkSettings();
  throwIfCancelled(signal);
  input.onStage?.('reviewing');
  const review = await services.review({ analysis, settings, language, signal, consentToSend: true, providerBaseUrl: provider.baseUrl });
  throwIfCancelled(signal);
  if (review.analysisId !== analysis.id) throw new Error(language === 'en' ? 'The review does not match this program evidence. Review again.' : '审查结果与这份程序证据不符，请重新审查。');
  return { analysis, review };
}
