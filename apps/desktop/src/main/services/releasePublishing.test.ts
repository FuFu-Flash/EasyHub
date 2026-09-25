import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: {}, net: {}, session: {} }));
vi.mock('./githubService', () => ({ githubAccessToken: vi.fn(), gitHubIdentity: vi.fn() }));

import { releaseAssetUrl, replaceInlineImages, validatePublishRequest } from './releasePublishing';

const valid = { owner: 'writer', repo: 'app', tagName: 'v0.01', title: 'First version', body: 'What changed', channel: 'stable', assetIds: [] };

describe('real release request validation', () => {
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
});
