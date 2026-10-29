import { describe, expect, it, vi } from 'vitest';
import { classifyLinuxProxy, hasEnvironmentProxy, LinuxSystemProxy, parseGnomeProxyMode } from './LinuxSystemProxy';

describe('Linux system proxy', () => {
  it('recognizes inherited proxies and GNOME modes without treating direct as a proxy', () => {
    expect(hasEnvironmentProxy({ https_proxy: 'http://127.0.0.1:7890' })).toBe(true);
    expect(hasEnvironmentProxy({ HTTP_PROXY: 'direct' })).toBe(false);
    expect(hasEnvironmentProxy({})).toBe(false);
    expect(parseGnomeProxyMode(" 'manual'\n")).toBe('manual');
    expect(parseGnomeProxyMode("'none'")).toBe('none');
    expect(parseGnomeProxyMode('auto')).toBe('auto');
    expect(parseGnomeProxyMode('unexpected')).toBe('unknown');
    expect(classifyLinuxProxy(false, 'none')).toEqual({ mode: 'off' });
    expect(classifyLinuxProxy(true, 'none')).toEqual({ mode: 'existing' });
    expect(classifyLinuxProxy(false, 'manual')).toEqual({ mode: 'existing' });
    expect(classifyLinuxProxy(false, 'auto')).toEqual({ mode: 'existing' });
  });

  it('does not read or write desktop settings on another operating system', async () => {
    const readDesktopProxy = vi.fn(async () => 'manual' as const);
    const service = new LinuxSystemProxy({ platform: 'win32', environment: { https_proxy: 'http://127.0.0.1:1' }, readDesktopProxy });
    expect(await service.acquire('http://127.0.0.1:9/easyhub.pac')).toEqual({ mode: 'unavailable', error: '系统代理读取目前仅在 Linux 上使用。' });
    expect(readDesktopProxy).not.toHaveBeenCalled();
  });

  it('reuses an existing proxy and otherwise stays off without accepting a PAC url to apply', async () => {
    const readDesktopProxy = vi.fn(async () => 'none' as const);
    const idle = new LinuxSystemProxy({ platform: 'linux', environment: {}, readDesktopProxy });
    expect(await idle.initialize()).toEqual({ mode: 'off' });
    expect(await idle.acquire('http://127.0.0.1:9/easyhub.pac')).toEqual({ mode: 'off' });
    expect(await idle.release()).toEqual({ mode: 'off' });
    const inherited = new LinuxSystemProxy({ platform: 'linux', environment: { all_proxy: 'socks5://127.0.0.1:1080' }, readDesktopProxy });
    expect(await inherited.status()).toEqual({ mode: 'existing' });
    expect(await inherited.destroy()).toEqual({ mode: 'existing' });
    expect(readDesktopProxy).toHaveBeenCalled();
  });

  it('keeps the in-app route available when the desktop reader fails', async () => {
    const service = new LinuxSystemProxy({
      platform: 'linux', environment: {}, readDesktopProxy: async () => { throw new Error('gsettings missing'); },
    });
    expect(await service.acquire('http://127.0.0.1:9/easyhub.pac')).toEqual({ mode: 'off' });
  });
});
