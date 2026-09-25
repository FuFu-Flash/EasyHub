import { describe, expect, it } from 'vitest';
import { addComment, addDemoChanges, createInitialState, createIssue, createProject, downloadProject, publishUpdate, syncProject, toggleIssue } from './mockStore';

describe('Mock project flows', () => {
  it('creates a project, detects demo changes, publishes a named version', () => {
    const result = createProject(createInitialState(), { name: '  我的工具  ', description: '说明', visibility: 'private', localPath: 'C:\\Demo' });
    expect(result.project.name).toBe('我的工具');
    const changed = addDemoChanges(result.state, result.project.id);
    expect(changed.projects[0]?.changedFiles).toHaveLength(3);
    const published = publishUpdate(changed, result.project.id, ' 修复窗口缩放问题 ');
    expect(published.projects[0]?.health).toBe('saved');
    expect(published.projects[0]?.changedFiles).toHaveLength(0);
    expect(published.projects[0]?.history[0]?.message).toBe('修复窗口缩放问题');
  });

  it('does not publish an empty update or unchanged project', () => {
    const initial = createInitialState();
    expect(() => publishUpdate(initial, 'minecraft', '   ')).toThrow('请写一句');
    expect(() => publishUpdate(initial, 'mytool', '更新')).toThrow('没有可以发布');
  });

  it('downloads a cloud project and safely clears the remote demo status', () => {
    let state = createInitialState();
    state = downloadProject(state, 'notes', 'C:\\Notes');
    state = syncProject(state, 'website');
    expect(state.projects.find((project) => project.id === 'notes')?.downloaded).toBe(true);
    expect(state.projects.find((project) => project.id === 'website')?.health).toBe('saved');
  });
});

describe('Mock issue flows', () => {
  it('creates, replies to, closes and reopens an issue', () => {
    let state = createIssue(createInitialState(), 'mytool', '新的问题', '详细描述');
    const issueId = state.issues[0]!.id;
    state = addComment(state, issueId, '已经收到');
    expect(state.issues[0]?.comments[0]?.body).toBe('已经收到');
    state = toggleIssue(state, issueId);
    expect(state.issues[0]?.state).toBe('closed');
    state = toggleIssue(state, issueId);
    expect(state.issues[0]?.state).toBe('open');
  });
});
