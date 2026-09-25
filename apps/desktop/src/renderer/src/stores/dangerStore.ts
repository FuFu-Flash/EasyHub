import type { Project } from '@easyhub/types';
import type { MockState } from './mockStore';

export type DangerAction = 'visibility' | 'protection' | 'transfer' | 'archive' | 'delete';

export function applyDangerAction(state: MockState, projectId: string, action: DangerAction, targetOwner?: string): MockState {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new Error('找不到这个项目');
  if (project.archived && action !== 'archive' && action !== 'delete') throw new Error('请先取消项目存档');

  if (action === 'delete') {
    return {
      ...state,
      projects: state.projects.filter((item) => item.id !== projectId),
      issues: state.issues.filter((issue) => issue.projectId !== projectId),
    };
  }

  let changed: Project;
  switch (action) {
    case 'visibility':
      changed = { ...project, visibility: project.visibility === 'public' ? 'private' : 'public' };
      break;
    case 'protection':
      changed = { ...project, branchProtectionEnabled: !project.branchProtectionEnabled };
      break;
    case 'transfer': {
      const owner = targetOwner?.trim() ?? '';
      if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu.test(owner) || owner.includes('--')) {
        throw new Error('请输入有效的 GitHub 用户名或组织名');
      }
      if (owner.toLowerCase() === project.owner.toLowerCase()) throw new Error('新所有者不能与当前所有者相同');
      changed = { ...project, owner };
      break;
    }
    case 'archive':
      changed = { ...project, archived: !project.archived };
      break;
  }
  return { ...state, projects: state.projects.map((item) => item.id === projectId ? changed : item) };
}
