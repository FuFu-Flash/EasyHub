import { afterEach, describe, expect, it, vi } from 'vitest';

const vault = vi.hoisted(() => ({ password: undefined as string | undefined }));
vi.mock('@napi-rs/keyring', () => ({ AsyncEntry: class {
  async getPassword(): Promise<string | undefined> { return vault.password; }
  async setPassword(value: string): Promise<void> { vault.password = value; }
  async deleteCredential(): Promise<boolean> { vault.password = undefined; return true; }
} }));
vi.mock('electron', () => ({ dialog: {}, net: { fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) } }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vault.password = undefined; });

describe('GitHub device authorization', () => {
  it('keeps device and access tokens inside the main service and refreshes expired credentials', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/device/code')) return Response.json({ device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
      if (url.endsWith('/access_token') && requests.filter((item) => item.endsWith('/access_token')).length === 1) return Response.json({ error: 'authorization_pending' });
      if (url.endsWith('/access_token') && requests.filter((item) => item.endsWith('/access_token')).length === 2) return Response.json({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 60 });
      if (url.endsWith('/access_token')) return Response.json({ access_token: 'renewed-token', refresh_token: 'renewed-refresh-token', expires_in: 3600 });
      if (url.endsWith('/user')) return Response.json({ login: 'tester', name: null, avatar_url: '', html_url: 'https://github.com/tester' });
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = await import('./githubService');
    const start = await service.startDeviceLogin('Ov23lixRW8K0uXzZqwMj');
    expect(start).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' });
    expect(JSON.stringify(start)).not.toContain('private-device-code');
    expect(await service.pollDeviceLogin()).toMatchObject({ state: 'waiting' });
    vi.advanceTimersByTime(5_000);
    const completed = await service.pollDeviceLogin();
    expect(completed).toMatchObject({ state: 'complete', user: { login: 'tester' } });
    expect(JSON.stringify(completed)).not.toContain('private-access-token');
    expect(vault.password).toContain('private-access-token');
    vi.advanceTimersByTime(120_000);
    expect(await service.githubAction('user', [])).toMatchObject({ login: 'tester' });
    expect(vault.password).toContain('renewed-token');
  });

  it('rejects danger actions without repository administration permission', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const requests: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/repos/other/sample')) return Response.json({ id: 9, name: 'sample', owner: { login: 'other' }, permissions: { admin: false } });
      if (url.endsWith('/user')) return Response.json({ login: 'tester', name: null, avatar_url: '', html_url: '' });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const service = await import('./githubService');
    await expect(service.githubAction('updateVisibility', ['other', 'sample', true])).rejects.toThrow('你没有这个项目的管理权限');
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });
});
