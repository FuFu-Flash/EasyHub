import { afterEach, describe, expect, it, vi } from 'vitest';
// Load native build tooling for the real host before simulating another OS.
import 'electron-vite';
import '@vitejs/plugin-react';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function configuration(platform: string, bundleFlag: string | undefined) {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
  vi.stubEnv('EASYHUB_MAC_BUNDLE', bundleFlag);
  vi.resetModules();
  return (await import('../electron.vite.config')).default;
}

describe('desktop build platform isolation', () => {
  it.each([undefined, '1'])('keeps Windows build defaults with Mac bundle flag %s', async flag => {
    const config = await configuration('win32', flag);
    expect(config.main?.build?.minify).toBeUndefined();
    expect(config.preload?.build?.minify).toBeUndefined();
    expect(config.main?.plugins).toHaveLength(1);
    expect(config.renderer?.plugins).toHaveLength(1);
  });

  it('keeps ordinary Mac development build defaults', async () => {
    const config = await configuration('darwin', undefined);
    expect(config.main?.build?.minify).toBeUndefined();
    expect(config.preload?.build?.minify).toBeUndefined();
    expect(config.main?.plugins).toHaveLength(1);
  });

  it('enables compaction and dependency notices for an explicit Mac release build', async () => {
    const config = await configuration('darwin', '1');
    expect(config.main?.build?.minify).toBe('esbuild');
    expect(config.preload?.build?.minify).toBe('esbuild');
    expect(config.main?.plugins).toHaveLength(2);
    expect(config.renderer?.plugins).toHaveLength(2);
  });
});
