import { Worker } from 'node:worker_threads';
import workerPath from './gitWorker?modulePath';
import type { GitAuthor, GitProgress, GitRepository } from './GitEngine';
import type { SyncDecision } from '@easyhub/types';

export interface GitTask { action: 'inspect' | 'status' | 'create' | 'download' | 'publish' | 'check-sync' | 'sync'; path: string; repo?: GitRepository; author?: GitAuthor; token?: string; message?: string; proxy?: string; revision?: string; decisions?: SyncDecision[] }
export interface GitJob<T> { result: Promise<T>; cancel: () => void }

export function runGitTask<T>(task: GitTask, onProgress?: (progress: GitProgress) => void): GitJob<T> {
  const worker = new Worker(workerPath, { workerData: task });
  let settled = false;
  let rejectJob: ((reason: Error) => void) | null = null;
  const result = new Promise<T>((resolve, reject) => {
    rejectJob = reject;
    worker.on('message', (message: unknown) => {
      if (typeof message !== 'object' || message === null || !('type' in message)) return;
      if (message.type === 'progress' && 'value' in message) onProgress?.(message.value as GitProgress);
      if (message.type === 'result' && 'value' in message) { settled = true; resolve(message.value as T); void worker.terminate(); }
      if (message.type === 'error' && 'message' in message) { settled = true; reject(new Error(String(message.message))); void worker.terminate(); }
    });
    worker.on('error', () => { if (!settled) { settled = true; reject(new Error('项目处理失败，请稍后重试。')); } });
    worker.on('exit', () => { if (!settled) { settled = true; reject(new Error('项目处理已停止。')); } });
  });
  return { result, cancel: () => { if (!settled) { settled = true; rejectJob?.(new Error('操作已取消。')); void worker.terminate(); } } };
}
