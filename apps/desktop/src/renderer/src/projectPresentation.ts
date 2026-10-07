import type { LocalProjectStatus, SyncPreview } from '@easyhub/types';

export type ProjectState = 'saved' | 'changes' | 'remote' | 'review' | 'checking' | 'unavailable';
export function projectPresentation(status?: LocalProjectStatus, remote?: SyncPreview, failed = false): { state: ProjectState; text: string } {
  if (status?.needsReview || remote?.state === 'review') return { state: 'review', text: '有内容需要确认' };
  if (failed || remote?.state === 'blocked') return { state: 'unavailable', text: '暂时无法确认项目状态' };
  if (!status) return { state: 'checking', text: '正在检查本地修改…' };
  if (status.files.length) return { state: 'changes', text: `有 ${status.files.length} 个文件还没发布` };
  if (remote?.state === 'ready') return { state: 'remote', text: 'GitHub 上有新内容' };
  if (!remote) return { state: 'checking', text: '本地没有待发布修改' };
  return { state: 'saved', text: '已保存到 GitHub' };
}
