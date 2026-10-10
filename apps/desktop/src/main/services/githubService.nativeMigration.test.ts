import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const nativeKey = 'app.easyhub.mac:github.credential';
const electronKey = 'EasyHub GitHub OAuth:default';
const state = vi.hoisted(() => ({
  directory: '', records: new Map<string, string>(), reads: [] as string[],
  writes: [] as string[], deletes: [] as string[], constructed: [] as string[],
  nativeReadError: false, duringNativeRead: undefined as (() => void) | undefined,
  duringWrite: undefined as (() => Promise<void>) | undefined,
}));

vi.mock('@napi-rs/keyring', () => ({ AsyncEntry: class {
  private readonly key: string;
  constructor(service: string, account: string) { this.key = `${service}:${account}`; state.constructed.push(this.key); }
  async getPassword(): Promise<string | undefined> {
    state.reads.push(this.key);
    if (this.key === 'app.easyhub.mac:github.credential') {
      state.duringNativeRead?.();
      if (state.nativeReadError) throw new Error('Mock Keychain access denied');
    }
    return state.records.get(this.key);
  }
  async setPassword(value: string): Promise<void> {
    state.writes.push(this.key); await state.duringWrite?.(); state.records.set(this.key, value);
  }
  async deleteCredential(): Promise<boolean> { state.deletes.push(this.key); return state.records.delete(this.key); }
} }));
vi.mock('electron', () => ({
  app: { getPath: () => state.directory }, dialog: {}, shell: {},
  net: { fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) },
}));

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('EASYHUB_TEST_MODE', '0');
  state.directory = await mkdtemp(join(tmpdir(), 'easyhub-native-migration-test-'));
  state.records.clear(); state.reads = []; state.writes = []; state.deletes = []; state.constructed = [];
  state.nativeReadError = false; state.duringNativeRead = undefined; state.duringWrite = undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/login/oauth/access_token')
    ? Response.json({ access_token: 'mock-refreshed-token', refresh_token: 'mock-refreshed-refresh', expires_in: 3600 })
    : Response.json({ id: 42, login: 'migration-test', name: null, avatar_url: '', html_url: 'https://github.com/migration-test' })));
});

afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  await rm(state.directory, { recursive: true, force: true });
});

describe.runIf(process.platform === 'darwin')('read-only native GitHub credential migration', () => {
  it('converts Foundation seconds and leaves the original native record unchanged', async () => {
    const expiry = Date.now() + 3600000;
    const original = JSON.stringify({ accessToken: 'mock-native-token', refreshToken: 'mock-native-refresh', expiresAt: expiry / 1000 - 978307200 });
    state.records.set(nativeKey, original);
    const service = await import('./githubService');
    expect((await service.authStatus()).user?.login).toBe('migration-test');
    expect(JSON.parse(state.records.get(electronKey)!)).toEqual({
      clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'mock-native-token', refreshToken: 'mock-native-refresh', expiresAt: expiry,
    });
    expect(state.records.get(nativeKey)).toBe(original);
    expect(state.writes).toEqual([electronKey]);
    expect(state.deletes).toEqual([]);
    const marker = await readFile(join(state.directory, 'native-github-migration-v1'), 'utf8');
    expect(marker).toBe('attempted\n');
    expect(marker).not.toContain('mock-native-token');
  });

  it('does not replace or read native credentials when Electron already has a record', async () => {
    const current = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'mock-existing-token' });
    state.records.set(electronKey, current);
    state.records.set(nativeKey, JSON.stringify({ accessToken: 'mock-native-token' }));
    const service = await import('./githubService');
    expect((await service.authStatus()).user?.login).toBe('migration-test');
    expect(state.records.get(electronKey)).toBe(current);
    expect(state.reads).not.toContain(nativeKey);
    expect(state.writes).toEqual([]);
  });

  it.each([
    ['no record', undefined], ['malformed JSON', '{'], ['invalid access token', JSON.stringify({ accessToken: '' })],
    ['invalid expiry', JSON.stringify({ accessToken: 'mock-native-token', expiresAt: 'not-a-date' })],
    ['expired without refresh', JSON.stringify({ accessToken: 'mock-native-token', expiresAt: (Date.now() - 600000) / 1000 - 978307200 })],
  ])('does not import %s and attempts the native read only once across restarts', async (_name, raw) => {
    if (raw !== undefined) state.records.set(nativeKey, raw);
    const first = await import('./githubService');
    expect((await first.authStatus()).user).toBeNull();
    vi.resetModules();
    const second = await import('./githubService');
    expect((await second.authStatus()).user).toBeNull();
    expect(state.reads.filter((key) => key === nativeKey)).toHaveLength(1);
    expect(state.records.has(electronKey)).toBe(false);
    expect(state.writes).toEqual([]);
  });

  it('handles native Keychain errors without mutating either credential', async () => {
    state.nativeReadError = true;
    const service = await import('./githubService');
    expect((await service.authStatus()).user).toBeNull();
    expect(state.writes).toEqual([]);
    expect(state.deletes).toEqual([]);
    expect(await readFile(join(state.directory, 'native-github-migration-v1'), 'utf8')).toBe('attempted\n');
  });

  it('refreshes a migrated expired token when a refresh token is present', async () => {
    state.records.set(nativeKey, JSON.stringify({ accessToken: 'mock-expired-token', refreshToken: 'mock-native-refresh',
      expiresAt: (Date.now() - 600000) / 1000 - 978307200 }));
    const service = await import('./githubService');
    expect((await service.authStatus()).user?.login).toBe('migration-test');
    expect(JSON.parse(state.records.get(electronKey)!)).toMatchObject({ accessToken: 'mock-refreshed-token', refreshToken: 'mock-refreshed-refresh' });
    expect(JSON.parse(state.records.get(nativeKey)!)).toMatchObject({ accessToken: 'mock-expired-token' });
  });

  it('preserves an Electron record created while native Keychain access is pending', async () => {
    const current = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'mock-new-electron-token' });
    state.records.set(nativeKey, JSON.stringify({ accessToken: 'mock-native-token' }));
    state.duringNativeRead = () => state.records.set(electronKey, current);
    const service = await import('./githubService');
    expect((await service.authStatus()).user?.login).toBe('migration-test');
    expect(state.records.get(electronKey)).toBe(current);
    expect(state.writes).toEqual([]);
  });

  it('does not migrate again after signing out and restarting', async () => {
    state.records.set(electronKey, JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'mock-existing-token' }));
    state.records.set(nativeKey, JSON.stringify({ accessToken: 'mock-native-token' }));
    const service = await import('./githubService');
    await service.logout();
    vi.resetModules();
    expect((await (await import('./githubService')).authStatus()).user).toBeNull();
    expect(state.reads).not.toContain(nativeKey);
    expect(state.records.has(nativeKey)).toBe(true);
    expect(state.deletes).toEqual([electronKey]);
  });

  it('finishes signing out after an in-flight migration write without reviving the old login', async () => {
    state.records.set(nativeKey, JSON.stringify({ accessToken: 'mock-native-token' }));
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>((resolve) => { writeStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseWrite = resolve; });
    state.duringWrite = async () => { writeStarted(); await blocked; };
    const service = await import('./githubService');
    const restoring = service.authStatus();
    await started;
    const signingOut = service.logout();
    await vi.waitFor(async () => expect(await readFile(join(state.directory, 'native-github-migration-v1'), 'utf8')).toBe('signed-out\n'));
    releaseWrite();
    await Promise.all([restoring, signingOut]);
    expect(state.records.has(electronKey)).toBe(false);
    vi.resetModules();
    expect((await (await import('./githubService')).authStatus()).user).toBeNull();
    expect(state.reads.filter((key) => key === nativeKey)).toHaveLength(1);
  });
});

it('uses an empty in-memory OAuth vault in automation without constructing or reading Keychain entries', async () => {
  vi.stubEnv('EASYHUB_TEST_MODE', '1');
  state.records.set(electronKey, JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'mock-real-record' }));
  state.records.set(nativeKey, JSON.stringify({ accessToken: 'mock-native-record' }));
  const service = await import('./githubService');
  expect((await service.authStatus()).user).toBeNull();
  await service.logout();
  expect(state.constructed).toEqual([]);
  expect(state.reads).toEqual([]); expect(state.writes).toEqual([]); expect(state.deletes).toEqual([]);
  expect(state.records.size).toBe(2);
});

it('keeps login preflight and authorized token writes in memory during automation', async () => {
  vi.stubEnv('EASYHUB_TEST_MODE', '1');
  const existing = JSON.stringify({ clientId: 'mock_client_id', accessToken: 'mock-existing-record' });
  state.records.set(electronKey, existing);
  state.records.set(nativeKey, JSON.stringify({ accessToken: 'mock-native-record' }));
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/login/device/code')) return Response.json({ device_code: 'mock-device', user_code: 'MOCK-1234',
      verification_uri: 'https://github.com/login/device', expires_in: 900 });
    if (url.endsWith('/login/oauth/access_token')) return Response.json({ access_token: 'mock-memory-token' });
    if (url.endsWith('/user')) return Response.json({ id: 42, login: 'migration-test', name: null, avatar_url: '', html_url: 'https://github.com/migration-test' });
    throw new Error('Unexpected fixture request');
  });
  vi.stubGlobal('fetch', fetcher);
  const service = await import('./githubService');
  expect(await service.startDeviceLogin('mock_client_id')).toMatchObject({ userCode: 'MOCK-1234' });
  expect(await service.pollDeviceLogin()).toMatchObject({ state: 'complete', user: { login: 'migration-test' } });
  expect(await service.authStatus()).toMatchObject({ user: { login: 'migration-test' } });
  await service.logout();
  expect(state.constructed).toEqual([]);
  expect(state.reads).toEqual([]); expect(state.writes).toEqual([]); expect(state.deletes).toEqual([]);
  expect(state.records.get(electronKey)).toBe(existing);
  expect(state.records.size).toBe(2);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
