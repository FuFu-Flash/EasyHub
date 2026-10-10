import { requireOptionalNativeModule } from 'expo';
import type { BinaryAnalysisResult } from '@easyhub/types';
import { runCancellableNativeRequest, type AnalysisFrameworkComponent, type AnalysisFrameworkId } from './frameworks';

export type { AnalysisFrameworkComponent, AnalysisFrameworkId } from './frameworks';

export interface AnalysisProgress { requestId: string; phase: 'preparing' | 'analyzing' | 'complete'; completed: number; total: number; message: string; unit: 'bytes' | 'steps' }
export interface AnalysisEngineStatus { javaAvailable: boolean; nativeAvailable: boolean; javaVersion: string; nativeVersion: string; androidApi: number; maxBytes: number; maxJavaBytes: number; components: AnalysisFrameworkComponent[] }
export interface FrameworkProgress { requestId: string; component: AnalysisFrameworkId; phase: 'downloading' | 'verifying' | 'installing'; completed: number; total: number; message: string; unit: 'bytes' | 'steps' }
export interface AnalysisFileInfo { name: string; size: number | null }
interface AnalysisOptions { requestId: string; uri: string; name: string; language: 'zh' | 'en'; expectedSize?: number; expectedSha256?: string; expectedBlobSha?: string }
interface NativeAnalysis {
  getStatus(): AnalysisEngineStatus;
  getFileInfo(uri: string): Promise<AnalysisFileInfo>;
  analyze(input: AnalysisOptions): Promise<BinaryAnalysisResult>;
  installFramework(input: { requestId: string; component: AnalysisFrameworkId; language: 'zh' | 'en' }): Promise<AnalysisEngineStatus>;
  removeFramework(input: { component: AnalysisFrameworkId; language: 'zh' | 'en' }): Promise<AnalysisEngineStatus>;
  cancel(requestId: string): void;
  addListener(event: 'onProgress', listener: (progress: AnalysisProgress) => void): { remove(): void };
  addListener(event: 'onFrameworkProgress', listener: (progress: FrameworkProgress) => void): { remove(): void };
}
const native = requireOptionalNativeModule<NativeAnalysis>('EasyHubAnalysis');

export function analysisEngineStatus(): AnalysisEngineStatus | null { return native?.getStatus() ?? null; }

export async function analysisFileInfo(uri: string): Promise<AnalysisFileInfo> {
  if (!native) throw new Error('请安装包含反编译模块的安卓版本。 / Install the Android build that includes the decompiler.');
  return await native.getFileInfo(uri);
}

export async function analyzeFile(input: AnalysisOptions, signal: AbortSignal, onProgress: (progress: AnalysisProgress) => void): Promise<BinaryAnalysisResult> {
  if (!native) throw new Error(input.language === 'en' ? 'Install the Android build that includes the decompiler.' : '请安装包含反编译模块的安卓版本。');
  return await runCancellableNativeRequest({ requestId: input.requestId, signal,
    subscribe: (listener) => native.addListener('onProgress', listener), onProgress,
    run: () => native.analyze(input), cancel: () => native.cancel(input.requestId) });
}

export async function installAnalysisFramework(input: { requestId: string; component: AnalysisFrameworkId; language: 'zh' | 'en' }, signal: AbortSignal, onProgress: (progress: FrameworkProgress) => void): Promise<AnalysisEngineStatus> {
  if (!native) throw new Error(input.language === 'en' ? 'Program review is unavailable in this build.' : '此版本无法使用程序文件审查。');
  return await runCancellableNativeRequest({ requestId: input.requestId, signal,
    subscribe: (listener) => native.addListener('onFrameworkProgress', listener), onProgress,
    run: () => native.installFramework(input), cancel: () => native.cancel(input.requestId) });
}

export async function removeAnalysisFramework(component: AnalysisFrameworkId, language: 'zh' | 'en'): Promise<AnalysisEngineStatus> {
  if (!native) throw new Error(language === 'en' ? 'Program review is unavailable in this build.' : '此版本无法使用程序文件审查。');
  return await native.removeFramework({ component, language });
}
