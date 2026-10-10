import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MacProxySnapshot } from '../renderer/src/global';

const bridge = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: { invoke: bridge.invoke, on: bridge.on, removeListener: bridge.removeListener },
}));

interface MacBridge {
  platform: string;
  copyPairingCode(code: string): Promise<boolean>;
  macProxy: {
    status(): Promise<MacProxySnapshot>;
    setEnabled(enabled: boolean): Promise<MacProxySnapshot>;
    probe(): Promise<MacProxySnapshot>;
    openSettings(): Promise<MacProxySnapshot>;
    onChanged(callback: (value: MacProxySnapshot) => void): () => void;
  };
}
const snapshot: MacProxySnapshot = { status: 'connected', pacURL: 'http://127.0.0.1:8869/github.pac', socksPort: 8868,
  domains: 7, lastProbe: 'GitHub HTTP 200 · 10 ms' };
let api: MacBridge;

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  bridge.invoke.mockImplementation(async (channel: string) => channel === 'easyhub:copy-pairing-code' ? true : snapshot);
  await import('./index');
  const call = bridge.expose.mock.calls[0];
  expect(call?.[0]).toBe('easyHub');
  api = call?.[1] as MacBridge;
});

describe('isolated macOS renderer IPC contract', () => {
  it('exposes the actual desktop platform without exposing Node or Electron objects', () => {
    expect(api.platform).toBe(process.platform);
    expect(api).not.toHaveProperty('ipcRenderer');
    expect(api).not.toHaveProperty('process');
  });

  it('routes the proxy controls and manual pairing copy to their dedicated IPC handlers', async () => {
    expect(await api.macProxy.status()).toEqual(snapshot);
    expect(await api.macProxy.setEnabled(true)).toEqual(snapshot);
    expect(await api.macProxy.probe()).toEqual(snapshot);
    expect(await api.macProxy.openSettings()).toEqual(snapshot);
    expect(await api.copyPairingCode('ABCD-EFGH')).toBe(true);
    expect(bridge.invoke.mock.calls).toEqual([
      ['easyhub:mac-proxy-status'], ['easyhub:mac-proxy-set-enabled', true], ['easyhub:mac-proxy-probe'],
      ['easyhub:mac-proxy-open-settings'], ['easyhub:copy-pairing-code', 'ABCD-EFGH'],
    ]);
  });

  it('delivers fresh proxy state and removes the exact event handler when its panel unmounts', () => {
    const callback = vi.fn();
    const stop = api.macProxy.onChanged(callback);
    const [channel, handler] = bridge.on.mock.calls[0] as [string, (event: unknown, value: MacProxySnapshot) => void];
    expect(channel).toBe('easyhub:mac-proxy-changed');
    handler(undefined, snapshot);
    expect(callback).toHaveBeenCalledWith(snapshot);
    stop();
    expect(bridge.removeListener).toHaveBeenCalledWith(channel, handler);
  });
});
