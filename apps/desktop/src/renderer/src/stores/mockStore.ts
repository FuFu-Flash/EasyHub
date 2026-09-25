import type { ChangedFile, CreateProjectInput, Issue, Project } from '@easyhub/types';
import { initialIssues, initialProjects } from '../data/mock';

export interface MockState {
  projects: Project[];
  issues: Issue[];
}

export const createInitialState = (): MockState => ({
  projects: structuredClone(initialProjects),
  issues: structuredClone(initialIssues),
});

const uniqueId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function createProject(state: MockState, input: CreateProjectInput): { state: MockState; project: Project } {
  const name = input.name.trim();
  if (!name) throw new Error('请填写项目名称');
  const project: Project = {
    id: uniqueId(), name, owner: '你', archived: false, branchProtectionEnabled: true,
    description: input.description.trim(), visibility: input.visibility,
    localPath: input.localPath?.trim() || undefined, updatedAt: new Date().toISOString(),
    health: 'saved', changedFiles: [], readme: '', downloaded: Boolean(input.localPath), releases: [],
    color: ['lilac', 'peach', 'mint', 'sky'][state.projects.length % 4] ?? 'lilac',
    initials: name.slice(0, 1).toUpperCase(),
    history: [{ id: uniqueId(), message: '创建项目', author: '你', createdAt: new Date().toISOString(), changedFiles: [], additions: 0, deletions: 0 }],
  };
  return { project, state: { ...state, projects: [project, ...state.projects] } };
}

export function addDemoChanges(state: MockState, projectId: string): MockState {
  return updateProject(state, projectId, (project) => {
    if (project.archived) throw new Error('请先取消项目存档');
    return ({
    ...project,
    health: 'changes',
    changedFiles: [...project.changedFiles.filter((file) => !['src/main.ts', 'assets/new-icon.png', 'src/old-view.ts'].includes(file.path)),
      { path: 'src/main.ts', kind: 'modified' },
      { path: 'assets/new-icon.png', kind: 'added' },
      { path: 'src/old-view.ts', kind: 'deleted' },
    ],
    });
  });
}

export function publishUpdate(state: MockState, projectId: string, message: string): MockState {
  const cleaned = message.trim();
  if (!cleaned) throw new Error('请写一句这次改了什么');
  const project = state.projects.find((item) => item.id === projectId);
  if (project?.archived) throw new Error('请先取消项目存档');
  if (!project || project.changedFiles.length === 0 || project.health !== 'changes') {
    throw new Error('目前没有可以发布的修改');
  }
  return updateProject(state, projectId, (current) => ({
    ...current,
    health: 'saved',
    changedFiles: [],
    updatedAt: new Date().toISOString(),
    history: [{ id: uniqueId(), message: cleaned, author: '你', createdAt: new Date().toISOString(), changedFiles: current.changedFiles.map((file) => file.path), additions: 42, deletions: 8 }, ...current.history],
  }));
}

export function syncProject(state: MockState, projectId: string): MockState {
  return updateProject(state, projectId, (project) => ({ ...project, health: 'saved', updatedAt: new Date().toISOString() }));
}

export function downloadProject(state: MockState, projectId: string, localPath: string): MockState {
  if (!localPath.trim()) throw new Error('请选择保存位置');
  return updateProject(state, projectId, (project) => ({ ...project, downloaded: true, localPath: localPath.trim(), health: 'saved' }));
}

export function createIssue(state: MockState, projectId: string, title: string, body: string): MockState {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new Error('请先选择项目');
  if (project.archived) throw new Error('存档项目不能创建问题');
  if (!title.trim()) throw new Error('请填写问题标题');
  const issue: Issue = { id: uniqueId(), projectId, title: title.trim(), body: body.trim(), author: '你', createdAt: new Date().toISOString(), state: 'open', comments: [] };
  return { ...state, issues: [issue, ...state.issues] };
}

export function addComment(state: MockState, issueId: string, body: string): MockState {
  const targetIssue = state.issues.find((issue) => issue.id === issueId);
  if (state.projects.find((project) => project.id === targetIssue?.projectId)?.archived) throw new Error('存档项目不能回复问题');
  if (!body.trim()) throw new Error('请填写回复内容');
  return {
    ...state,
    issues: state.issues.map((issue) => issue.id === issueId
      ? { ...issue, comments: [...issue.comments, { id: uniqueId(), author: '你', body: body.trim(), createdAt: new Date().toISOString() }] }
      : issue),
  };
}

export function toggleIssue(state: MockState, issueId: string): MockState {
  const targetIssue = state.issues.find((issue) => issue.id === issueId);
  if (state.projects.find((project) => project.id === targetIssue?.projectId)?.archived) throw new Error('存档项目不能修改问题');
  return { ...state, issues: state.issues.map((issue) => issue.id === issueId ? { ...issue, state: issue.state === 'open' ? 'closed' : 'open' } : issue) };
}

export function updateProjectReadme(state: MockState, projectId: string, readme: string): MockState {
  return updateProject(state, projectId, (project) => {
    if (project.archived) throw new Error('请先取消项目存档');
    if (project.health === 'remote') throw new Error('请先获取 GitHub 上的最新内容');
    const nextReadme = readme.trim();
    if (nextReadme === project.readme.trim()) return project;
    return {
      ...project,
      readme: nextReadme,
      health: 'changes',
      changedFiles: project.changedFiles.some((file) => file.path === 'README.md')
        ? project.changedFiles
        : [...project.changedFiles, { path: 'README.md', kind: project.readme.trim() ? 'modified' : 'added' }],
    };
  });
}

function updateProject(state: MockState, projectId: string, change: (project: Project) => Project): MockState {
  return { ...state, projects: state.projects.map((project) => project.id === projectId ? change(project) : project) };
}

export function getChangeSummary(files: ChangedFile[]): string {
  return `${files.length} 个文件发生变化`;
}
