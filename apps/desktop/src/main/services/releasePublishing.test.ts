import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: {}, net: {}, session: {} }));
vi.mock('./githubService', () => ({ githubAccessToken: vi.fn(), gitHubIdentity: vi.fn() }));

import { GitHubClient } from '@easyhub/github';
import type { GitHubCreatedRelease } from '@easyhub/github';
import { gitHubIdentity } from './githubService';
import { ReleasePublishingService, releaseAssetUrl, replaceInlineImages, validateAddReleaseAssetsRequest, validateEditReleaseRequest, validatePublishRequest, validateRemoveReleaseAssetRequest } from './releasePublishing';

const valid = { owner: 'writer', repo: 'app', tagName: 'v0.01', title: 'First version', body: 'What changed', channel: 'stable', assetIds: [] };
const published: GitHubCreatedRelease = { id: 42, tag_name: 'v1.0.0', name: 'Original', body: 'Details', draft: false,
  prerelease: false, published_at: '2026-09-27T00:00:00Z', assets: [], upload_url: 'https://uploads.github.com/example', html_url: 'https://github.com/writer/app/releases/tag/v1.0.0' };

describe('real release request validation', () => {
  afterEach(() => vi.restoreAllMocks());
  it('accepts an ordinary version and rejects unapproved file IDs', () => {
    expect(validatePublishRequest(valid)).toEqual(valid);
    expect(() => validatePublishRequest({ ...valid, assetIds: ['C:\\Users\\writer\\secret.txt'] })).toThrow();
    expect(() => validatePublishRequest({ ...valid, assetIds: ['00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'] })).toThrow();
  });

  it('rejects invalid tags and empty descriptions before reaching GitHub', () => {
    expect(() => validatePublishRequest({ ...valid, tagName: '../other' })).toThrow();
    expect(() => validatePublishRequest({ ...valid, body: '  ' })).toThrow();
  });

  it('replaces selected local image placeholders and rejects missing images', () => {
    const id = '00000000-0000-0000-0000-000000000000';
    const body = `![Screenshot](easyhub-image:${id})`;
    expect(replaceInlineImages(body, new Map([[id, 'https://github.com/asset.png']]))).toBe('![Screenshot](https://github.com/asset.png)');
    expect(() => replaceInlineImages(body, new Map())).toThrow('尚未添加');
  });

  it('uses a stable version URL for images uploaded while the release is a draft', () => {
    expect(releaseAssetUrl('writer', 'app', 'v0.02', 'release preview.png'))
      .toBe('https://github.com/writer/app/releases/download/v0.02/release%20preview.png');
  });

  it('validates editing and file changes without accepting arbitrary paths or IDs', () => {
    const target = { owner: 'writer', repo: 'app', releaseId: 42 };
    expect(validateEditReleaseRequest({ ...target, title: 'New title', body: '', prerelease: false }).body).toBe('');
    expect(() => validateEditReleaseRequest({ ...target, title: ' ', body: '', prerelease: false })).toThrow();
    expect(() => validateEditReleaseRequest({ ...target, title: 'Title', body: '', prerelease: 'false' })).toThrow();
    expect(() => validateRemoveReleaseAssetRequest({ ...target, assetId: -1 })).toThrow();
    expect(() => validateAddReleaseAssetsRequest({ ...target, assetIds: ['C:\\secret.txt'] })).toThrow();
    expect(validateAddReleaseAssetsRequest({ ...target, assetIds: ['00000000-0000-0000-0000-000000000000'] }).assetIds).toHaveLength(1);
  });

  it('edits release details while preserving the published tag', async () => {
    vi.mocked(gitHubIdentity).mockResolvedValue({ user: { login: 'writer' } } as Awaited<ReturnType<typeof gitHubIdentity>>);
    vi.spyOn(GitHubClient.prototype, 'repo').mockResolvedValue({ owner: { login: 'writer' }, permissions: { push: true }, archived: false } as Awaited<ReturnType<GitHubClient['repo']>>);
    vi.spyOn(GitHubClient.prototype, 'release').mockResolvedValue(published);
    const update = vi.spyOn(GitHubClient.prototype, 'updateRelease').mockResolvedValue({ ...published, name: 'Updated', body: '' });
    const result = await new ReleasePublishingService().edit({ owner: 'writer', repo: 'app', releaseId: 42, title: 'Updated', body: '', prerelease: false });
    expect(result.tag_name).toBe('v1.0.0');
    expect(update).toHaveBeenCalledWith('writer', 'app', 42, { name: 'Updated', body: '', prerelease: false }, expect.any(AbortSignal));
  });

  it('refuses to remove an asset that does not belong to the selected release', async () => {
    vi.mocked(gitHubIdentity).mockResolvedValue({ user: { login: 'writer' } } as Awaited<ReturnType<typeof gitHubIdentity>>);
    vi.spyOn(GitHubClient.prototype, 'repo').mockResolvedValue({ owner: { login: 'writer' }, permissions: { push: true }, archived: false } as Awaited<ReturnType<GitHubClient['repo']>>);
    vi.spyOn(GitHubClient.prototype, 'release').mockResolvedValue({ ...published, assets: [{ id: 7, name: 'setup.exe', label: null, size: 1, content_type: 'application/octet-stream', download_count: 0, state: 'uploaded' }] });
    const remove = vi.spyOn(GitHubClient.prototype, 'deleteReleaseAsset').mockResolvedValue();
    await expect(new ReleasePublishingService().removeAsset({ owner: 'writer', repo: 'app', releaseId: 42, assetId: 8 })).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
    await new ReleasePublishingService().removeAsset({ owner: 'writer', repo: 'app', releaseId: 42, assetId: 7 });
    expect(remove).toHaveBeenCalledWith('writer', 'app', 7);
  });
});
