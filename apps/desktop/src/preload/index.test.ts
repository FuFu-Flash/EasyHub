import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: { invoke: bridge.invoke, on: bridge.on, removeListener: bridge.removeListener },
}));

interface MacBridge {
  platform: string;
  copyPairingCode(code: string): Promise<boolean>;
}
let api: MacBridge;

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  bridge.invoke.mockImplementation(async (channel: string) => channel === 'easyhub:copy-pairing-code');
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

  it('routes manual pairing copy to its dedicated IPC handler', async () => {
    expect(await api.copyPairingCode('ABCD-EFGH')).toBe(true);
    expect(bridge.invoke.mock.calls).toEqual([['easyhub:copy-pairing-code', 'ABCD-EFGH']]);
  });
});
