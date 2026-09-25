import { describe, expect, it } from 'vitest';
import { createInitialState, updateProjectReadme, publishUpdate, createIssue } from './mockStore';
import { applyDangerAction } from './dangerStore';
import { publishRelease } from './releaseStore';

describe('project introduction and danger zone', () => {
  it('marks an edited introduction as an unpublished README change', () => {
    const state = updateProjectReadme(createInitialState(), 'mytool', '# New introduction');
    const project = state.projects.find((item) => item.id === 'mytool')!;
    expect(project.readme).toBe('# New introduction');
    expect(project.health).toBe('changes');
    expect(project.changedFiles).toContainEqual({ path: 'README.md', kind: 'modified' });
    expect(updateProjectReadme(state, 'mytool', '# New introduction').projects.find((item) => item.id === 'mytool')!.changedFiles).toHaveLength(1);
    expect(() => updateProjectReadme(state, 'website', 'New')).toThrow('获取');
  });

  it('changes visibility, protection and ownership in the mock state', () => {
    let state = createInitialState();
    state = applyDangerAction(state, 'minecraft', 'visibility');
    state = applyDangerAction(state, 'minecraft', 'protection');
    state = applyDangerAction(state, 'minecraft', 'transfer', 'new-owner');
    const project = state.projects.find((item) => item.id === 'minecraft')!;
    expect(project.visibility).toBe('private');
    expect(project.branchProtectionEnabled).toBe(false);
    expect(project.owner).toBe('new-owner');
    expect(() => applyDangerAction(state, 'minecraft', 'transfer', 'bad--name')).toThrow('有效');
  });

  it('makes an archived project read-only until unarchived', () => {
    let state = applyDangerAction(createInitialState(), 'minecraft', 'archive');
    expect(() => publishUpdate(state, 'minecraft', 'Update')).toThrow('取消项目存档');
    expect(() => updateProjectReadme(state, 'minecraft', 'New')).toThrow('取消项目存档');
    expect(() => createIssue(state, 'minecraft', 'Bug', 'Details')).toThrow('存档项目');
    expect(() => publishRelease(state, 'minecraft', { tagName: 'v0.01', title: 'Release', body: 'Description', channel: 'stable', assets: [] })).toThrow('取消项目存档');
    state = applyDangerAction(state, 'minecraft', 'archive');
    expect(state.projects.find((item) => item.id === 'minecraft')?.archived).toBe(false);
  });

  it('removes only demo project and linked issues when deleted', () => {
    const initial = createInitialState();
    const state = applyDangerAction(initial, 'minecraft', 'delete');
    expect(state.projects.some((item) => item.id === 'minecraft')).toBe(false);
    expect(state.issues.some((item) => item.projectId === 'minecraft')).toBe(false);
    expect(state.projects.length).toBe(initial.projects.length - 1);
    expect(initial.projects.some((item) => item.id === 'minecraft')).toBe(true);
  });
});
