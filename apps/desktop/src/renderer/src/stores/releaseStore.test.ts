import { describe, expect, it } from 'vitest';
import type { ReleaseAsset } from '@easyhub/types';
import { createInitialState, createProject } from './mockStore';
import { MAX_RELEASE_ASSET_SIZE, nextReleaseTag, publishRelease, validateReleaseAssets } from './releaseStore';

const asset = (name: string, size = 1024): ReleaseAsset => ({ id: name, name, size, mimeType: 'application/octet-stream' });

describe('Release versioning', () => {
  it('suggests an independent next version for each project and channel', () => {
    const newProject = createProject(createInitialState(), { name: 'Demo', description: '', visibility: 'public' }).project;
    expect(nextReleaseTag(newProject.releases, 'stable')).toBe('v0.01');
    expect(nextReleaseTag(newProject.releases, 'alpha')).toBe('alpha0.1');
    expect(nextReleaseTag(newProject.releases, 'beta')).toBe('beta0.1');

    let state = publishRelease(createInitialState(), 'mytool', { tagName: 'v0.01', title: 'First', body: 'Description', channel: 'stable', assets: [asset('EasyHub.exe')] }).state;
    expect(nextReleaseTag(state.projects.find((project) => project.id === 'mytool')!.releases, 'stable')).toBe('v0.02');
    expect(nextReleaseTag(state.projects.find((project) => project.id === 'minecraft')!.releases, 'stable')).toBe('v0.01');
    state = publishRelease(state, 'mytool', { tagName: 'alpha0.1', title: 'Alpha', body: 'Try it', channel: 'alpha', assets: [] }).state;
    expect(nextReleaseTag(state.projects.find((project) => project.id === 'mytool')!.releases, 'alpha')).toBe('alpha0.2');
    expect(nextReleaseTag(state.projects.find((project) => project.id === 'mytool')!.releases, 'beta')).toBe('beta0.1');
  });

  it('keeps a new release separate from ordinary update history', () => {
    const initial = createInitialState();
    const previous = initial.projects.find((project) => project.id === 'minecraft')!;
    const result = publishRelease(initial, 'minecraft', { tagName: 'v1.0.0', title: 'Installer', body: 'Download below', channel: 'stable', assets: [asset('mod.zip')] });
    const updated = result.state.projects.find((project) => project.id === 'minecraft')!;
    expect(updated.releases[0]?.tagName).toBe('v1.0.0');
    expect(nextReleaseTag(updated.releases, 'stable')).toBe('v1.0.1');
    expect(updated.history).toEqual(previous.history);
    expect(updated.changedFiles).toEqual(previous.changedFiles);
    expect(updated.health).toBe('changes');
    expect(() => publishRelease(result.state, 'minecraft', { tagName: 'v1.0.0', title: 'Again', body: 'Description', channel: 'stable', assets: [] })).toThrow('已经使用过');
  });
});

describe('GitHub release asset limits', () => {
  it('accepts installer, archive and Unicode names without an extension allowlist', () => {
    expect(() => validateReleaseAssets([asset('安装包.exe'), asset('source.zip'), asset('setup.msi', MAX_RELEASE_ASSET_SIZE - 1)])).not.toThrow();
  });

  it('rejects oversized, excess and duplicate named assets', () => {
    expect(() => validateReleaseAssets([asset('big.zip', MAX_RELEASE_ASSET_SIZE)])).toThrow('小于 2 GiB');
    expect(() => validateReleaseAssets(Array.from({ length: 1001 }, (_, index) => asset(`${index}.zip`)))).toThrow('最多添加 1000');
    expect(() => validateReleaseAssets([asset('Setup.EXE'), asset('setup.exe')])).toThrow('同名');
  });
});
