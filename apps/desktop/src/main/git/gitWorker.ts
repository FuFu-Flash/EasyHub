import { parentPort, workerData } from 'node:worker_threads';
import { GitEngine, GitEngineError } from './GitEngine';
import type { GitAuthor, GitProgress, GitRepository } from './GitEngine';
import type { SyncDecision, LocalPublishSelection } from '@easyhub/types';
import type { OriginRule } from '../services/githubProxyOrigin';

interface WorkItem { action: 'inspect' | 'status' | 'preview-changes' | 'file-diff' | 'create' | 'download' | 'publish' | 'check-sync' | 'sync'; path: string; repo?: GitRepository; author?: GitAuthor; token?: string; message?: string; proxy?: string; githubRules?: Record<string, OriginRule>; revision?: string; decisions?: SyncDecision[]; selection?: LocalPublishSelection; filePath?: string; snapshot?: string }

const task = workerData as WorkItem;
const engine = new GitEngine(task.proxy, task.githubRules);
const progress = (value: GitProgress): void => { parentPort?.postMessage({ type: 'progress', value }); };

async function run(): Promise<unknown> {
  switch (task.action) {
    case 'inspect': return engine.openProject(task.path);
    case 'status': return engine.getStatus(task.path, progress);
    case 'preview-changes': return engine.getPublishPreview(task.path, progress);
    case 'file-diff': if (task.filePath && task.snapshot) return engine.getFileDiff(task.path, task.filePath, task.snapshot, progress); break;
    case 'create': if (task.repo && task.author && task.token) return engine.createProject(task.path, task.repo, task.author, task.token, progress); break;
    case 'download': if (task.repo && task.token) return engine.downloadProject(task.path, task.repo, task.token, progress); break;
    case 'publish': if (task.repo && task.author && task.token && task.message) return engine.publishUpdate(task.path, task.repo, task.author, task.token, task.message, progress, task.selection); break;
    case 'check-sync': if (task.repo && task.token) return engine.checkSync(task.path, task.repo, task.token, progress); break;
    case 'sync': if (task.repo && task.token) return engine.syncProject(task.path, task.repo, task.token, task.revision, task.decisions, progress); break;
  }
  throw new GitEngineError('invalid', '项目操作参数无效。');
}

void run().then((result) => parentPort?.postMessage({ type: 'result', value: result })).catch((error: unknown) => {
  const detail = error instanceof GitEngineError ? error.message : '项目处理失败，请检查网络和文件夹权限后重试。';
  parentPort?.postMessage({ type: 'error', message: detail });
});
