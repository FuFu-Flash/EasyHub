import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() }, net: {}, session: {} }));
vi.mock('./githubService', () => ({ githubAccessToken: vi.fn(), gitHubIdentity: vi.fn() }));

import { dialog } from 'electron';
import { GitHubClient } from '@easyhub/github';
import type { GitHubCreatedRelease, GitHubReleaseAsset } from '@easyhub/github';
import { githubAccessToken, gitHubIdentity } from './githubService';
import { ReleasePublishingService } from './releasePublishing';

const target = { owner: 'writer', repo: 'app', releaseId: 42 };
const publish = { owner: 'writer', repo: 'app', tagName: 'v1.0.0', title: 'Release', body: 'Notes', channel: 'stable', assetIds: [] as string[] };
const original: GitHubCreatedRelease = { id: 42, tag_name: 'v1.0.0', name: 'Release', body: 'Notes', draft: false,
  prerelease: false, published_at: '2026-10-09T00:00:00Z', assets: [], upload_url: 'https://uploads.github.com/example{?name,label}', html_url: 'https://github.com/writer/app/releases/tag/v1.0.0' };

describe('release upload recovery and exclusive mutations', () => {
  let directory: string;
  let remote: GitHubCreatedRelease;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'easyhub-release-recovery-'));
    remote = { ...original, assets: [] };
    vi.mocked(githubAccessToken).mockResolvedValue('fixture-token');
    vi.mocked(gitHubIdentity).mockResolvedValue({ user: { login: 'writer' } } as Awaited<ReturnType<typeof gitHubIdentity>>);
    vi.spyOn(GitHubClient.prototype, 'repo').mockResolvedValue({ owner: { login: 'writer' }, permissions: { push: true }, archived: false, default_branch: 'main' } as Awaited<ReturnType<GitHubClient['repo']>>);
    vi.spyOn(GitHubClient.prototype, 'release').mockImplementation(async () => ({ ...remote, assets: [...remote.assets] }));
    vi.spyOn(GitHubClient.prototype, 'createRelease').mockImplementation(async () => { remote = { ...remote, draft: true }; return remote; });
    vi.spyOn(GitHubClient.prototype, 'updateRelease').mockImplementation(async (_owner, _repo, _id, input) => {
      remote = { ...remote, ...input }; return remote;
    });
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

  async function choose(service: ReleasePublishingService): Promise<string[]> {
    const paths = ['first.zip', 'second.zip'].map((name) => join(directory, name));
    await Promise.all(paths.map((path) => writeFile(path, 'fixture')));
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: paths });
    return (await service.chooseFiles(false)).map((file) => file.id);
  }

  function uploaded(name: string, size: number): GitHubReleaseAsset {
    const asset = { id: remote.assets.length + 100, name, size, label: null, content_type: 'application/zip', download_count: 0, state: 'uploaded', browser_download_url: `https://github.com/writer/app/releases/download/v1.0.0/${name}` };
    remote.assets.push(asset); return asset;
  }

  it('reports partial append success and retries only the unfinished file', async () => {
    let failed = false;
    const uploads: string[] = [];
    const service = new ReleasePublishingService(async (_url, file) => {
      uploads.push(file.name);
      if (file.name === 'second.zip' && !failed) { failed = true; throw new Error('Network fixture'); }
      return uploaded(file.name, file.size);
    });
    const ids = await choose(service);
    const result = await service.addAssets({ ...target, assetIds: ids }, vi.fn());
    expect('status' in result).toBe(true);
    if (!('status' in result)) throw new Error('Expected partial failure');
    expect(result.completedAssetIds).toEqual([ids[0]]);
    expect(result.remainingAssetIds).toEqual([ids[1]]);
    expect(result.release?.assets.map((asset) => asset.name)).toEqual(['first.zip']);
    const retried = await service.addAssets({ ...target, assetIds: result.remainingAssetIds }, vi.fn());
    expect('status' in retried).toBe(false);
    expect(uploads).toEqual(['first.zip', 'second.zip', 'second.zip']);
    expect(remote.assets).toHaveLength(2);
  });

  it('reconciles an upload whose response was lost instead of repeating it', async () => {
    let lostResponse = false;
    const uploads: string[] = [];
    const service = new ReleasePublishingService(async (_url, file) => {
      uploads.push(file.name);
      const asset = uploaded(file.name, file.size);
      if (!lostResponse) { lostResponse = true; throw new Error('Response lost'); }
      return asset;
    });
    const ids = await choose(service);
    const result = await service.addAssets({ ...target, assetIds: ids }, vi.fn());
    if (!('status' in result)) throw new Error('Expected partial failure');
    expect(result.completedAssetIds).toEqual([ids[0]]);
    await service.addAssets({ ...target, assetIds: ids }, vi.fn());
    expect(uploads).toEqual(['first.zip', 'second.zip']);
  });

  it('removes only an unfinished starter asset before retrying its upload', async () => {
    let failed = false;
    const uploads: string[] = [];
    const service = new ReleasePublishingService(async (_url, file) => {
      uploads.push(file.name);
      if (file.name === 'second.zip' && !failed) {
        failed = true;
        remote.assets.push({ id: 500, name: file.name, size: 0, label: null, content_type: file.mimeType, download_count: 0, state: 'starter' });
        throw new Error('Upload interrupted');
      }
      return uploaded(file.name, file.size);
    });
    const remove = vi.spyOn(GitHubClient.prototype, 'deleteReleaseAsset').mockImplementation(async (_owner, _repo, id) => { remote.assets = remote.assets.filter((asset) => asset.id !== id); });
    const ids = await choose(service);
    const result = await service.addAssets({ ...target, assetIds: ids }, vi.fn());
    if (!('status' in result)) throw new Error('Expected partial failure');
    await service.addAssets({ ...target, assetIds: result.remainingAssetIds }, vi.fn());
    expect(remove).toHaveBeenCalledExactlyOnceWith('writer', 'app', 500);
    expect(uploads).toEqual(['first.zip', 'second.zip', 'second.zip']);
    expect(remote.assets.map((asset) => asset.name)).toEqual(['first.zip', 'second.zip']);
  });

  it('continues a partially uploaded draft without recreating or repeating confirmed assets', async () => {
    let failed = false;
    const uploads: string[] = [];
    const service = new ReleasePublishingService(async (_url, file) => {
      uploads.push(file.name);
      if (file.name === 'second.zip' && !failed) { failed = true; throw new Error('Network fixture'); }
      return uploaded(file.name, file.size);
    });
    const assetIds = await choose(service);
    const result = await service.publish({ ...publish, assetIds }, vi.fn());
    if (!('status' in result)) throw new Error('Expected partial failure');
    expect(result.residualDraft).toMatchObject({ id: 42, tagName: 'v1.0.0', retainedForRetry: true });
    expect(result.completedAssetIds).toEqual([assetIds[0]]);
    const retried = await service.publish({ ...publish, assetIds }, vi.fn());
    expect('status' in retried).toBe(false);
    expect(remote.draft).toBe(false);
    expect(GitHubClient.prototype.createRelease).toHaveBeenCalledTimes(1);
    expect(uploads).toEqual(['first.zip', 'second.zip', 'second.zip']);
  });

  it.each([
    ['publish', 'modified'], ['publish', 'deleted'], ['append', 'modified'], ['append', 'deleted'],
  ] as const)('retries %s after a confirmed local file is %s without reading or uploading it again', async (operation, change) => {
    let failed = false;
    const uploads: string[] = [];
    const service = new ReleasePublishingService(async (_url, file) => {
      uploads.push(file.name);
      if (file.name === 'second.zip' && !failed) { failed = true; throw new Error('Network fixture'); }
      return uploaded(file.name, file.size);
    });
    const assetIds = await choose(service);
    const run = () => operation === 'publish' ? service.publish({ ...publish, assetIds }, vi.fn()) : service.addAssets({ ...target, assetIds }, vi.fn());
    const partial = await run();
    if (!('status' in partial)) throw new Error('Expected partial failure');
    expect(partial.completedAssetIds).toEqual([assetIds[0]]);
    if (change === 'deleted') await rm(join(directory, 'first.zip'));
    else await writeFile(join(directory, 'first.zip'), 'Different local content after upload');
    const retried = await run();
    expect('status' in retried).toBe(false);
    expect(uploads).toEqual(['first.zip', 'second.zip', 'second.zip']);
    expect(remote.assets.map((asset) => [asset.name, asset.size])).toEqual([['first.zip', 7], ['second.zip', 7]]);
    if (operation === 'publish') expect(GitHubClient.prototype.createRelease).toHaveBeenCalledTimes(1);
  });

  it.each(['omitted-confirmed-file', 'unknown-draft-file'] as const)('refuses to publish a retry with %s instead of silently including or removing it', async (scenario) => {
    let failed = false;
    const uploads: string[] = [];
    const service = new ReleasePublishingService(async (_url, file) => {
      uploads.push(file.name);
      if (file.name === 'second.zip' && !failed) { failed = true; throw new Error('Network fixture'); }
      return uploaded(file.name, file.size);
    });
    const remove = vi.spyOn(GitHubClient.prototype, 'deleteReleaseAsset').mockResolvedValue();
    const assetIds = await choose(service);
    await service.publish({ ...publish, assetIds }, vi.fn());
    if (scenario === 'unknown-draft-file') uploaded('external.zip', 7);
    const retryIds = scenario === 'omitted-confirmed-file' ? assetIds.slice(1) : assetIds;
    const retried = await service.publish({ ...publish, assetIds: retryIds }, vi.fn());
    if (!('status' in retried)) throw new Error('Expected selection mismatch');
    expect(retried.retryable).toBe(false);
    expect(retried.error).toContain('选择清单不一致');
    expect(retried.residualDraft?.url).toBe('https://github.com/writer/app/releases');
    expect(remote.draft).toBe(true);
    expect(remote.assets[0]?.name).toBe('first.zip');
    expect(uploads).toEqual(['first.zip', 'second.zip']);
    expect(GitHubClient.prototype.updateRelease).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('reports the residual draft and its location when cancellation cleanup fails', async () => {
    const service = new ReleasePublishingService(async () => { service.cancel(); throw new DOMException('Aborted', 'AbortError'); });
    vi.spyOn(GitHubClient.prototype, 'deleteRelease').mockRejectedValue(new Error('Cleanup unavailable'));
    const assetIds = await choose(service);
    const result = await service.publish({ ...publish, assetIds }, vi.fn());
    if (!('status' in result)) throw new Error('Expected cleanup failure');
    expect(result.retryable).toBe(false);
    expect(result.error).toContain('未能清理');
    expect(result.residualDraft).toEqual({ id: 42, tagName: 'v1.0.0', title: 'Release', url: 'https://github.com/writer/app/releases', retainedForRetry: false });
  });

  it('reports the residual draft when an ordinary publish failure also fails cleanup', async () => {
    const service = new ReleasePublishingService(async () => { throw new Error('Network unavailable'); });
    vi.spyOn(GitHubClient.prototype, 'deleteRelease').mockRejectedValue(new Error('Cleanup unavailable'));
    const assetIds = await choose(service);
    const result = await service.publish({ ...publish, assetIds }, vi.fn());
    if (!('status' in result)) throw new Error('Expected cleanup failure');
    expect(result.retryable).toBe(false);
    expect(result.error).toContain('发布失败');
    expect(result.residualDraft?.url).toBe('https://github.com/writer/app/releases');
  });

  it('checks final publication after a lost response and never creates a second release', async () => {
    vi.mocked(GitHubClient.prototype.updateRelease).mockImplementation(async () => { remote = { ...remote, draft: false }; throw new Error('Response lost'); });
    const result = await new ReleasePublishingService().publish(publish, vi.fn());
    expect('status' in result).toBe(false);
    expect(GitHubClient.prototype.createRelease).toHaveBeenCalledTimes(1);
  });

  it('requires checking the version page if a draft creation response is lost', async () => {
    vi.mocked(GitHubClient.prototype.createRelease).mockRejectedValue(new Error('Response lost'));
    const result = await new ReleasePublishingService().publish(publish, vi.fn());
    if (!('status' in result)) throw new Error('Expected uncertain result');
    expect(result.retryable).toBe(false);
    expect(result.residualDraft?.id).toBeUndefined();
    expect(result.residualDraft?.url).toBe('https://github.com/writer/app/releases');
    expect(result.error).toContain('无法确认');
    expect(GitHubClient.prototype.createRelease).toHaveBeenCalledTimes(1);
  });

  it.each(['edit', 'removeAsset', 'publish', 'addAssets'] as const)('locks %s synchronously before its first asynchronous step', async (operation) => {
    let resolveRepo!: (value: Awaited<ReturnType<GitHubClient['repo']>>) => void;
    vi.mocked(GitHubClient.prototype.repo).mockImplementation(() => new Promise((resolve) => { resolveRepo = resolve; }));
    const service = new ReleasePublishingService(async (_url, file) => uploaded(file.name, file.size));
    const assetIds = await choose(service);
    remote.assets = operation === 'removeAsset' ? [{ ...uploaded('existing.zip', 7), id: 5 }] : [];
    const running = operation === 'edit' ? service.edit({ ...target, title: 'Title', body: 'Notes', prerelease: false })
      : operation === 'removeAsset' ? service.removeAsset({ ...target, assetId: 5 })
        : operation === 'publish' ? service.publish({ ...publish, assetIds }, vi.fn())
          : service.addAssets({ ...target, assetIds }, vi.fn());
    await expect(service.edit({ ...target, title: 'Duplicate', body: '', prerelease: false })).rejects.toThrow('已有版本操作');
    await vi.waitFor(() => expect(resolveRepo).toBeTypeOf('function'));
    vi.spyOn(GitHubClient.prototype, 'deleteReleaseAsset').mockResolvedValue();
    resolveRepo({ owner: { login: 'writer' }, permissions: { push: true }, archived: false, default_branch: 'main' } as Awaited<ReturnType<GitHubClient['repo']>>);
    await running;
  });
});
