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
  it('keeps Mac updates separate from newer Windows, Android and component releases', async () => {
    const mac = (tag: string, assets = ['EasyHub-macOS.dmg'], extra = {}) => release(tag, assets, extra);
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json([
      release('v9.0.0'), mac('macos-v1.3.0'), mac('macos-v1.4.0', ['EasyHub-macOS.zip']),
      mac('macos-v1.5.0', undefined, { prerelease: true }), mac('macos-v1.6.0', undefined, { draft: true }),
      mac('macos-v8.0.0', ['EasyHub-8.0.0.apk']), release('analysis-runtime-12.0.0'),
    ]));
    expect(await checkAppUpdate('1.3.0', transport, 'darwin')).toEqual({ currentVersion: '1.3.0', latestVersion: '1.4.0', available: true, releaseUrl: 'https://github.com/FuFu-Flash/EasyHub/releases/tag/macos-v1.4.0' });
    expect((await checkAppUpdate('1.4.0', transport, 'darwin')).available).toBe(false);
    expect((await checkAppUpdate('1.3.0', transport, 'win32')).latestVersion).toBe('9.0.0');
    await expect(checkAppUpdate('1.3.0', vi.fn<typeof fetch>().mockResolvedValue(Response.json([release('v9.0.0')])), 'darwin')).rejects.toThrow('macOS');
  });
  it('keeps Linux updates on linux tags for the running architecture', async () => {
    const linux = (tag: string, assets: string[], extra = {}) => release(tag, assets, extra);
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json([
      release('v9.0.0'), linux('linux-v1.4.0', ['EasyHub-1.4.0-x64.AppImage']),
      linux('linux-v1.4.2', ['EasyHub-1.4.2-arm64.deb']),
      linux('linux-v1.5.0', ['EasyHub-1.5.0-x64.deb', 'EasyHub-1.5.0-x64.AppImage']),
      linux('linux-v1.6.0', ['EasyHub-1.6.0-x64.AppImage'], { prerelease: true }),
      linux('macos-v9.0.0', ['EasyHub-macOS.dmg']),
    ]));
    expect(await checkAppUpdate('1.4.0', transport, 'linux', 'x64')).toEqual({ currentVersion: '1.4.0', latestVersion: '1.5.0', available: true, releaseUrl: 'https://github.com/FuFu-Flash/EasyHub/releases/tag/linux-v1.5.0' });
    expect((await checkAppUpdate('1.4.0', transport, 'linux', 'arm64')).latestVersion).toBe('1.4.2');
    expect((await checkAppUpdate('1.4.0', transport, 'win32')).latestVersion).toBe('9.0.0');
    await expect(checkAppUpdate('1.4.0', vi.fn<typeof fetch>().mockResolvedValue(Response.json([release('v9.0.0')])), 'linux', 'x64')).rejects.toThrow('Linux');
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
