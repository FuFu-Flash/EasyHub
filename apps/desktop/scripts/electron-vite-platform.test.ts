import { afterEach, describe, expect, it, vi } from 'vitest';
// Initialize host-native tooling before simulating another build platform.
import 'electron-vite';
import '@vitejs/plugin-react';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function configuration(platform: string, macFlag?: string, winFlag?: string) {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
  vi.stubEnv('EASYHUB_MAC_BUNDLE', macFlag);
  vi.stubEnv('EASYHUB_WIN_BUNDLE', winFlag);
  vi.resetModules();
  return (await import('../electron.vite.config')).default;
}

describe('desktop release build platform isolation', () => {
  it.each([
    ['win32', undefined, undefined],
    ['win32', '1', undefined],
    ['win32', undefined, '0'],
    ['darwin', undefined, undefined],
    ['darwin', undefined, '1'],
    ['linux', '1', '1'],
  ])('keeps ordinary build defaults on %s (Mac=%s, Windows=%s)', async (platform, macFlag, winFlag) => {
    const config = await configuration(platform!, macFlag, winFlag);
    expect(config.main?.build?.minify).toBeUndefined();
    expect(config.preload?.build?.minify).toBeUndefined();
    expect(config.main?.plugins).toHaveLength(1);
    expect(config.renderer?.plugins).toHaveLength(1);
  });

  it.each([
    ['win32', undefined, '1'],
    ['win32', '1', '1'],
    ['darwin', '1', undefined],
    ['darwin', '1', '1'],
  ])('bundles dependencies with license notices for %s releases (Mac=%s, Windows=%s)', async (platform, macFlag, winFlag) => {
    const config = await configuration(platform!, macFlag, winFlag);
    expect(config.main?.build?.minify).toBe('esbuild');
    expect(config.preload?.build?.minify).toBe('esbuild');
    expect(config.main?.plugins).toHaveLength(2);
    expect(config.renderer?.plugins).toHaveLength(2);
  });
});
