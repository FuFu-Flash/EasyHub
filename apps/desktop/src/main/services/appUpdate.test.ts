import { describe, expect, it, vi } from 'vitest';
import { checkAppUpdate } from './appUpdate';

const release = (tag: string, assets = [`EasyHub-${tag.slice(1)}-setup.exe`], extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: assets.map((name) => ({ name })), ...extra });
describe('application update checks', () => {
  it('compares numeric versions and selects only stable Windows installers', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json([
      release('v2.0.0', ['EasyHub-2.0.0.apk']), release('v9.0.0', undefined, { prerelease: true }),
      release('v8.0.0', undefined, { draft: true }), release('v1.9.9'), release('v1.10.0'),
      release('analysis-runtime-12.0.0'),
    ]));
    expect(await checkAppUpdate('1.9.9', transport)).toEqual({ currentVersion: '1.9.9', latestVersion: '1.10.0', available: true, releaseUrl: 'https://github.com/FuFu-Flash/EasyHub/releases/tag/v1.10.0' });
    expect(new Headers(transport.mock.calls[0]![1]?.headers).has('Authorization')).toBe(false);
  });
  it('does not offer equal versions or downgrades', async () => {
    for (const current of ['1.1.0', '1.2.0']) expect((await checkAppUpdate(current, vi.fn<typeof fetch>().mockResolvedValue(Response.json([release('v1.1.0')])))).available).toBe(false);
  });
  it('reports network, rate limit and invalid results without claiming latest', async () => {
    await expect(checkAppUpdate('1.1.0', vi.fn<typeof fetch>().mockRejectedValue(new Error('private detail')))).rejects.toThrow('网络');
    await expect(checkAppUpdate('1.1.0', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 })))).rejects.toThrow('频繁');
    await expect(checkAppUpdate('1.1.0', vi.fn<typeof fetch>().mockResolvedValue(Response.json([])))).rejects.toThrow('Windows');
  });
});
