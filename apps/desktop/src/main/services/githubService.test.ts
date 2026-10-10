import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const vault = vi.hoisted(() => ({ password: undefined as string | undefined, probes: new Map<string, string>(), fail: '' as '' | 'construct' | 'read' | 'write' | 'delete', wrongProbe: false, beforeWrite: undefined as (() => Promise<void>) | undefined }));
const desktop = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn(), reveal: vi.fn() }));
vi.mock('@napi-rs/keyring', () => ({ AsyncEntry: class {
  constructor(private readonly service: string, private readonly account: string) { if (vault.fail === 'construct') throw new Error('keyring constructor private-debug'); }
  async getPassword(): Promise<string | undefined> {
    if (vault.fail === 'read') throw new Error('keyring backend detail private-debug');
    return this.account === 'default' ? vault.password : vault.wrongProbe ? 'incorrect' : vault.probes.get(`${this.service}/${this.account}`);
  }
  async setPassword(value: string): Promise<void> {
    if (vault.fail === 'write') throw new Error('keyring locked private-debug');
    if (this.account === 'default') { await vault.beforeWrite?.(); vault.password = value; }
    else vault.probes.set(`${this.service}/${this.account}`, value);
  }
  async deleteCredential(): Promise<boolean> {
    if (vault.fail === 'delete') throw new Error('keyring delete private-debug');
    if (this.account === 'default') { vault.password = undefined; return true; }
    return vault.probes.delete(`${this.service}/${this.account}`);
  }
} }));
// Native credential migration has a separate isolated profile fixture. Omitting
// getPath here keeps these upstream OAuth cases independent of Mac user data.
vi.mock('electron', () => ({ app: { getVersion: () => '1.2.1' }, dialog: { showSaveDialog: desktop.save, showMessageBox: desktop.confirm }, shell: { showItemInFolder: desktop.reveal }, net: { fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) } }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); vault.password = undefined; vault.probes.clear(); vault.fail = ''; vault.wrongProbe = false; vault.beforeWrite = undefined; });

describe('read-only build and test checks', () => {
  const headSha = 'a'.repeat(40);
  const repo = { id: 91, name: 'sample', owner: { login: 'owner' } };
  const pull = { number: 7, head: { sha: headSha }, base: { repo: { id: 91 } } };
  async function setupChecks(options: { stale?: boolean; deniedStatuses?: boolean } = {}) {
    vi.resetModules(); vault.password = JSON.stringify({ clientId: 'test_client', accessToken: 'test-token' });
    let pullReads = 0;
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/repos/owner/sample')) return Response.json(repo);
      if (url.endsWith('/pulls/7')) { pullReads++; return Response.json(options.stale && pullReads > 1 ? { ...pull, head: { sha: 'b'.repeat(40) } } : pull); }
      if (url.includes('/check-runs?')) return Response.json({ total_count: 1, check_runs: [{ id: 1, name: 'tests', head_sha: headSha, status: 'completed', conclusion: 'success' }] });
      if (url.includes('/statuses?')) return options.deniedStatuses ? new Response('', { status: 403 }) : Response.json([]);
      throw new Error('Unexpected check request');
    });
    vi.stubGlobal('fetch', fetcher);
    return { service: await import('./githubService'), fetcher };
  }
  it('validates reference and pagination before using the authenticated client', async () => {
    const { service, fetcher } = await setupChecks();
    for (const input of [{ headSha: 'main', checkPage: 1, statusPage: 1 }, { headSha, checkPage: 0, statusPage: 1 }, { headSha, checkPage: 1, statusPage: '1' }, { headSha, checkPage: null, statusPage: null }, { headSha, checkPage: 1 }]) {
      await expect(service.githubAction('pullChecks', ['owner', 'sample', 7, input])).rejects.toThrow('填写');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('loads both check sources for the reviewed revision using only reads', async () => {
    const { service, fetcher } = await setupChecks();
    expect(await service.githubAction('pullChecks', ['owner', 'sample', 7, { headSha, checkPage: 1, statusPage: 1 }])).toMatchObject({ headSha, checkRuns: { state: 'available', items: [{ name: 'tests' }] }, statuses: { state: 'available', items: [], nextPage: null } });
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/pulls/7'))).toHaveLength(2);
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });
  it('keeps a denied source visible and retries only requested sources', async () => {
    const { service, fetcher } = await setupChecks({ deniedStatuses: true });
    expect(await service.githubAction('pullChecks', ['owner', 'sample', 7, { headSha, checkPage: 1, statusPage: 1 }])).toMatchObject({ checkRuns: { state: 'available' }, statuses: { state: 'forbidden', nextPage: 1 } });
    fetcher.mockClear();
    expect(await service.githubAction('pullChecks', ['owner', 'sample', 7, { headSha, checkPage: null, statusPage: 1 }])).toMatchObject({ checkRuns: null, statuses: { state: 'forbidden' } });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('check-runs'))).toBe(false);
  });
  it('discards results when the author updates the request during the read', async () => {
    const { service } = await setupChecks({ stale: true });
    await expect(service.githubAction('pullChecks', ['owner', 'sample', 7, { headSha, checkPage: 1, statusPage: 1 }])).rejects.toThrow('新修改');
  });
});

describe('binary analysis snapshots', () => {
  it('downloads the pinned file from a verified contributor snapshot', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'test_client', accessToken: 'test-token' });
    const headSha = 'a'.repeat(40);
    const blobSha = 'b'.repeat(40);
    const repository = { id: 11, name: 'app', owner: { login: 'owner' } };
    const pull = { number: 4, head: { sha: headSha, repo: { name: 'copy', owner: { login: 'contributor' } } }, base: { sha: 'c'.repeat(40), ref: 'main', repo: repository }, changed_files: 1 };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/repos/owner/app')) return Response.json(repository);
      if (url.endsWith('/pulls/4')) return Response.json(pull);
      if (url.includes('/pulls/4/files?')) return Response.json([{ filename: 'bin/tool.exe', status: 'added', sha: blobSha }]);
      if (url.endsWith(`/repos/contributor/copy/git/blobs/${blobSha}`)) return new Response('MZbinary');
      throw new Error('unexpected request');
    }));
    const { loadBinaryAnalysisFile } = await import('./githubService');
    const result = await loadBinaryAnalysisFile({ kind: 'pull', owner: 'owner', repo: 'app', number: 4, headSha, path: 'bin/tool.exe' }, new AbortController().signal);
    expect(result.name).toBe('tool.exe'); expect(result.gitSha).toBe(blobSha);
    expect(await result.response.text()).toBe('MZbinary');
    expect(calls.at(-1)).toContain('/contributor/copy/git/blobs/');
    await expect(loadBinaryAnalysisFile({ kind: 'pull', owner: 'owner', repo: 'app', number: 4, headSha: 'd'.repeat(40), path: 'bin/tool.exe' }, new AbortController().signal)).rejects.toThrow('新修改');
  });

  it('validates release identity and size before obtaining the download body', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'test_client', accessToken: 'test-token' });
    const sha256 = 'd'.repeat(64);
    let size = 1024;
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => init?.headers && new Headers(init.headers).get('Accept') === 'application/octet-stream'
      ? new Response('MZsample') : Response.json({ id: 7, name: 'tool.exe', state: 'uploaded', size, digest: `sha256:${sha256}` }));
    vi.stubGlobal('fetch', fetcher);
    const { loadBinaryAnalysisFile } = await import('./githubService');
    const source = { kind: 'release', owner: 'owner', repo: 'app', assetId: 7, name: 'tool.exe' } as const;
    const file = await loadBinaryAnalysisFile(source, new AbortController().signal);
    expect(file).toMatchObject({ size: 1024, sha256 }); expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(loadBinaryAnalysisFile({ ...source, name: 'other.exe' }, new AbortController().signal)).rejects.toThrow('已经改变');
    size = 129 * 1024 * 1024;
    await expect(loadBinaryAnalysisFile(source, new AbortController().signal)).rejects.toThrow('128 MB');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe('GitHub device authorization', () => {
  it('checks writable secure storage before any login network request without replacing an existing account', async () => {
    vi.resetModules();
    const previous = JSON.stringify({ clientId: 'test_client', accessToken: 'existing-test-token' });
    vault.password = previous;
    const fetcher = vi.fn(async () => {
      expect(vault.password).toBe(previous);
      expect(vault.probes.size).toBe(0);
      return Response.json({ device_code: 'test-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900 });
    });
    vi.stubGlobal('fetch', fetcher);
    const service = await import('./githubService');
    vault.fail = 'write';
    await expect(service.startDeviceLogin('test_client')).rejects.toThrow('安全存储');
    expect(fetcher).not.toHaveBeenCalled();
    expect(vault.password).toBe(previous);
    vault.fail = '';
    expect(await service.startDeviceLogin('test_client')).toMatchObject({ userCode: 'ABCD-EFGH' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cleans up a failed readback probe and refuses login when probe cleanup fails', async () => {
    vi.resetModules();
    const fetcher = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetcher);
    const service = await import('./githubService');
    vault.wrongProbe = true;
    await expect(service.startDeviceLogin('test_client')).rejects.toThrow('安全存储');
    expect(vault.probes.size).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    vault.wrongProbe = false; vault.fail = 'delete';
    await expect(service.startDeviceLogin('test_client')).rejects.toThrow('安全存储');
    expect(fetcher).not.toHaveBeenCalled();
    expect([...vault.probes.values()].every((value) => !value.includes('token'))).toBe(true);
  });

  it.each(['construct', 'read', 'write'] as const)('does not perform even permission reads when deletion authorization fails keyring %s', async (failure) => {
    vi.resetModules();
    const fetcher = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetcher);
    const service = await import('./githubService');
    vault.fail = failure;
    await expect(service.startDeviceLogin('test_client', true, { owner: 'owner', repo: 'app', id: 91 })).rejects.toThrow('安全存储');
    expect(fetcher).not.toHaveBeenCalled();
    expect(vault.probes.size).toBe(0);
  });

  it('prevents concurrent login starts and discards a device response received after cancellation', async () => {
    vi.resetModules();
    let acceptResponse: ((response: Response) => void) | undefined;
    let markStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const fetcher = vi.fn(async () => {
      markStarted?.();
      return new Promise<Response>((resolve) => { acceptResponse = resolve; });
    });
    vi.stubGlobal('fetch', fetcher);
    const service = await import('./githubService');
    const starting = service.startDeviceLogin('test_client');
    await requestStarted;
    await expect(service.startDeviceLogin('test_client')).rejects.toThrow('正在准备登录');
    service.cancelDeviceLogin();
    acceptResponse?.(Response.json({ device_code: 'test-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900 }));
    await expect(starting).rejects.toThrow('登录已取消');
    await expect(service.pollDeviceLogin()).rejects.toThrow('过期');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vault.probes.size).toBe(0);
  });

  it.each(['cancel', 'logout'] as const)('does not leave a newly authorized account when %s happens during the keyring write', async (action) => {
    vi.resetModules();
    const previous = JSON.stringify({ clientId: 'test_client', accessToken: 'existing-test-token' });
    vault.password = previous;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).endsWith('/device/code')
      ? Response.json({ device_code: 'test-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900 })
      : String(input).endsWith('/access_token') ? Response.json({ access_token: 'new-test-token' }) : Response.json({ login: 'tester' })));
    const service = await import('./githubService');
    await service.startDeviceLogin('test_client');
    let releaseWrite: (() => void) | undefined;
    let markWriteStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    let writes = 0;
    vault.beforeWrite = async () => {
      if (++writes === 1) { markWriteStarted?.(); await new Promise<void>((resolve) => { releaseWrite = resolve; }); }
    };
    const polling = service.pollDeviceLogin();
    await started;
    const loggingOut = action === 'logout' ? service.logout() : undefined;
    if (action === 'cancel') service.cancelDeviceLogin();
    releaseWrite?.();
    await expect(polling).rejects.toThrow('登录已取消');
    await loggingOut;
    expect(vault.password).toBe(action === 'logout' ? undefined : previous);
    expect(await service.authStatus()).toMatchObject({ user: action === 'logout' ? null : { login: 'tester' } });
  });

  it('reports keyring failures while saving and reading credentials without leaking backend details', async () => {
    vi.resetModules();
    const fetcher = vi.fn(async (input: string | URL) => String(input).endsWith('/device/code')
      ? Response.json({ device_code: 'test-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900 })
      : Response.json({ access_token: 'test-token' }));
    vi.stubGlobal('fetch', fetcher);
    const service = await import('./githubService');
    vault.fail = 'read';
    await expect(service.authStatus()).rejects.toThrow('安全存储');
    vault.fail = '';
    await service.startDeviceLogin('test_client');
    vault.fail = 'write';
    await expect(service.pollDeviceLogin()).rejects.toThrow('安全存储');
    expect(vault.password).toBeUndefined();
    expect(vault.probes.size).toBe(0);
  });

  it('distinguishes login timeout and TLS errors without exposing raw network details', async () => {
    for (const [cause, text] of [
      [new DOMException('private-debug', 'TimeoutError'), '超时'], [new Error('net::ERR_CERT_AUTHORITY_INVALID private-debug'), '证书'],
      [new Error('net::ERR_PROXY_CONNECTION_FAILED private-debug'), '当前代理'], [new Error('net::ERR_NAME_NOT_RESOLVED private-debug'), '网络地址'],
    ] as const) {
      vi.resetModules();
      vi.stubGlobal('fetch', vi.fn(async () => { throw cause; }));
      const service = await import('./githubService');
      const error = await service.startDeviceLogin('test_client').catch((value: unknown) => value);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(text);
      expect((error as Error).message).not.toContain('private-debug');
    }
  });

  it('reports invalid responses and rate limiting without displaying returned server content', async () => {
    for (const [response, message] of [[new Response('<html>private-debug</html>'), '信息不完整'], [new Response('private-debug', { status: 429 }), '过于频繁']] as const) {
      vi.resetModules();
      vi.stubGlobal('fetch', vi.fn(async () => response));
      const service = await import('./githubService');
      const error = await service.startDeviceLogin('test_client').catch((value: unknown) => value);
      expect((error as Error).message).toContain(message);
      expect((error as Error).message).not.toContain('private-debug');
    }
  });

  it('validates discussion search and pagination before touching the network', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'test_client', accessToken: 'test-token' });
    const fetcher = vi.fn(async () => Response.json([])); vi.stubGlobal('fetch', fetcher);
    const service = await import('./githubService');
    for (const [action, args] of [
      ['commentsPage', ['owner', 'app', 1, 0]], ['commentsPage', ['owner', 'app', 0, 1]],
      ['commentsPage', ['owner', 'app', 1, '2']], ['commentsPage', ['owner', 'app', 1, 2, 'extra']],
      ['commitsPage', ['owner', 'app', 1.5]], ['commitsPage', ['../owner', 'app', 1]],
      ['searchDiscussions', ['owner', 'app', { query: 'test', kind: 'repo', state: 'all', page: 1 }]],
      ['searchDiscussions', ['owner', 'app', { query: '', kind: 'issue', state: 'all', page: 1 }]],
      ['searchDiscussions', ['owner', 'app', { query: 'test', kind: 'issue', state: 'all', page: 35 }]],
    ] as const) await expect(service.githubAction(action, [...args])).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await service.githubAction('commentsPage', ['owner', 'app', 1, 2])).toEqual({ items: [], nextPage: null });
    expect(await service.githubAction('commitsPage', ['owner', 'app', 2])).toEqual({ items: [], nextPage: null });
  });
  it('validates release pages and tags before calling the read-only endpoints', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'test_client', accessToken: 'test-token' });
    const fetcher = vi.fn(async (input: string | URL) => Response.json(String(input).includes('/tags/') ? { id: 8 } : []));
    vi.stubGlobal('fetch', fetcher);
    const service = await import('./githubService');
    for (const args of [['owner', 'app', 0], ['owner', 'app', '2'], ['owner', 'app', 1.5], ['owner', 'app', 10001], ['owner', 'app', 2, 'extra']]) {
      await expect(service.githubAction('releasesPage', args)).rejects.toThrow();
    }
    for (const args of [['owner', 'app', ''], ['owner', 'app', 'bad\ntag'], ['owner', 'app', 'v1', 'extra']]) {
      await expect(service.githubAction('releaseByTag', args)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(await service.githubAction('releasesPage', ['owner', 'app', 2])).toEqual({ items: [], nextPage: null });
    expect(await service.githubAction('releaseByTag', ['owner', 'app', 'older/0.1'])).toEqual({ id: 8 });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/owner/app/releases?per_page=30&page=2',
      'https://api.github.com/repos/owner/app/releases/tags/older%2F0.1',
    ]);
  });

  it('explains a blocked login POST without leaking a raw network error', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net::ERR_CONNECTION_RESET'); }));
    const service = await import('./githubService');
    await expect(service.startDeviceLogin('Ov23lixRW8K0uXzZqwMj')).rejects.toThrow('设置中开启 GitHub 代理');
  });

  it('keeps starring requests behind validated IPC actions', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/user/starred?')) return Response.json([{ id: 1, name: 'app' }]);
      return new Response(null, { status: 204 });
    }));
    const service = await import('./githubService');
    await expect(service.githubAction('setStarred', ['owner', 'app', 'yes'])).rejects.toThrow();
    await expect(service.githubAction('starredRepos', [0])).rejects.toThrow();
    expect(requests).toEqual([]);
    expect(await service.githubAction('starredRepos', [1])).toMatchObject([{ id: 1 }]);
    expect(await service.githubAction('isStarred', ['owner', 'app'])).toBe(true);
    await service.githubAction('setStarred', ['owner', 'app', true]);
    expect(requests).toEqual([
      'GET https://api.github.com/user/starred?sort=created&direction=desc&per_page=100&page=1',
      'GET https://api.github.com/user/starred/owner/app',
      'PUT https://api.github.com/user/starred/owner/app',
    ]);
  });

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

  it('reads current protection and changes only the confirmed default branch rule', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    let protectedBranch = false;
    const mutations: Array<{ method: string; url: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? 'GET';
      if (method !== 'GET') mutations.push({ method, url, body: init?.body as string | undefined });
      if (url.endsWith('/user')) return Response.json({ login: 'owner' });
      if (url.endsWith('/repos/owner/app')) return Response.json({ id: 91, name: 'app', full_name: 'owner/app', default_branch: 'main', archived: false, owner: { login: 'owner' }, permissions: { admin: true } });
      if (url.endsWith('/branches/main')) return Response.json({ name: 'main', protected: protectedBranch });
      if (url.endsWith('/branches/main/protection')) {
        if (method === 'PUT') { protectedBranch = true; return Response.json({ required_pull_request_reviews: { required_approving_review_count: 1 } }); }
        if (method === 'DELETE') { protectedBranch = false; return new Response(null, { status: 204 }); }
        return protectedBranch ? Response.json({ required_pull_request_reviews: { required_approving_review_count: 1 } }) : Response.json({ message: 'Not Found' }, { status: 404 });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));
    const service = await import('./githubService');
    expect(await service.githubAction('branchProtectionStatus', ['owner', 'app'])).toMatchObject({ branch: 'main', enabled: false, externalRules: false });
    await expect(service.githubAction('setDefaultBranchProtection', ['owner', 'app', { expectedBranch: 'other', expectedEnabled: false, enable: true, confirmation: 'owner/app' }])).rejects.toThrow();
    expect(mutations).toHaveLength(0);
    expect(await service.githubAction('setDefaultBranchProtection', ['owner', 'app', { expectedBranch: 'main', expectedEnabled: false, enable: true, confirmation: 'owner/app' }])).toMatchObject({ enabled: true });
    expect(await service.githubAction('setDefaultBranchProtection', ['owner', 'app', { expectedBranch: 'main', expectedEnabled: true, enable: false, confirmation: 'owner/app' }])).toMatchObject({ enabled: false });
    expect(mutations.map((item) => item.method)).toEqual(['PUT', 'DELETE']);
    expect(JSON.parse(mutations[0]!.body!)).toMatchObject({ required_pull_request_reviews: { required_approving_review_count: 1 } });
  });

  it('refuses to overwrite protection from other GitHub rules', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const mutations: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? 'GET';
      if (method !== 'GET') mutations.push(url);
      if (url.endsWith('/user')) return Response.json({ login: 'owner' });
      if (url.endsWith('/repos/owner/app')) return Response.json({ id: 91, name: 'app', full_name: 'owner/app', default_branch: 'main', owner: { login: 'owner' }, permissions: { admin: true } });
      if (url.endsWith('/branches/main')) return Response.json({ name: 'main', protected: true });
      if (url.endsWith('/branches/main/protection')) return Response.json({ message: 'Not Found' }, { status: 404 });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const service = await import('./githubService');
    expect(await service.githubAction('branchProtectionStatus', ['owner', 'app'])).toMatchObject({ enabled: false, externalRules: true });
    await expect(service.githubAction('setDefaultBranchProtection', ['owner', 'app', { expectedBranch: 'main', expectedEnabled: false, enable: true, confirmation: 'owner/app' }])).rejects.toThrow();
    expect(mutations).toHaveLength(0);
  });

  it('requires delete scope, current repository ID and exact full name before deletion', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? 'GET'; methods.push(method);
      if (url.endsWith('/user')) return Response.json({ login: 'owner' });
      if (url.endsWith('/repos/owner/app')) return method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 91, name: 'app', full_name: 'owner/app', owner: { login: 'owner' }, permissions: { admin: true } });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const service = await import('./githubService');
    expect(await service.githubAction('deleteRepoScope', ['owner', 'app', 91])).toBe(false);
    await expect(service.githubAction('deleteRepo', ['owner', 'app', 91, 'owner/app'])).rejects.toThrow('删除项目前需要单独授权');
    expect(methods).not.toContain('DELETE');
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token', scopes: ['repo', 'delete_repo'] });
    vi.resetModules();
    const elevated = await import('./githubService');
    await expect(elevated.githubAction('deleteRepo', ['owner', 'app', 92, 'owner/app'])).rejects.toThrow('项目信息已变化');
    await expect(elevated.githubAction('deleteRepo', ['owner', 'app', 91, 'owner/wrong'])).rejects.toThrow();
    expect(methods).not.toContain('DELETE');
    await expect(elevated.githubAction('deleteRepo', ['owner', 'app', 91, 'owner/app'])).rejects.toThrow('删除项目前需要单独授权');
    expect(methods).not.toContain('DELETE');
  });

  it('adds delete permission only after a separate device authorization by the same account', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T00:00:00Z'));
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'regular-token' });
    let elevatedLogin = 'someone-else';
    const requests: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input); const body = init?.body?.toString(); requests.push({ url, body });
      if (url.endsWith('/login/device/code')) return Response.json({ device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
      if (url.endsWith('/login/oauth/access_token')) return Response.json({ access_token: 'elevated-token', scope: 'repo,read:user,delete_repo' });
      if (url.endsWith('/user')) return Response.json({ login: (init?.headers as Record<string, string>)?.Authorization === 'Bearer elevated-token' ? elevatedLogin : 'owner' });
      if (url.endsWith('/repos/owner/app')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 91, name: 'app', full_name: 'owner/app', owner: { login: 'owner' }, permissions: { admin: true } });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const service = await import('./githubService');
    await service.startDeviceLogin('Ov23lixRW8K0uXzZqwMj', true, { owner: 'owner', repo: 'app', id: 91 });
    expect(requests.find((item) => item.url.endsWith('/login/device/code'))?.body).toContain('delete_repo');
    await expect(service.pollDeviceLogin()).rejects.toThrow('账号与当前账号不一致');
    expect(vault.password).toContain('regular-token');
    elevatedLogin = 'owner';
    await service.startDeviceLogin('Ov23lixRW8K0uXzZqwMj', true, { owner: 'owner', repo: 'app', id: 91 });
    vi.advanceTimersByTime(5_000);
    expect(await service.pollDeviceLogin()).toMatchObject({ state: 'complete', user: { login: 'owner' } });
    expect(vault.password).toContain('regular-token');
    expect(await service.githubAction('deleteRepoScope', ['owner', 'app', 91])).toBe(true);
    expect(await service.githubAction('deleteRepoScope', ['owner', 'other', 91])).toBe(false);
    expect(await service.githubAction('deleteRepo', ['owner', 'app', 91, 'owner/app'])).toEqual({ deleted: true, id: 91 });
    expect(await service.githubAction('deleteRepoScope', ['owner', 'app', 91])).toBe(false);
    expect(vault.password).not.toContain('elevated-token');
  });

  it('validates pull request sources before sending them to GitHub', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const fetchMock = vi.fn(async () => Response.json({ id: 1, number: 1, title: 'Improve search' }));
    vi.stubGlobal('fetch', fetchMock);
    const service = await import('./githubService');
    await expect(service.githubAction('createPullRequest', ['owner', 'repo', {
      title: 'Improve search', body: '', head: 'writer:../main', base: 'main',
    }])).rejects.toThrow('填写的内容无效');
    expect(fetchMock).not.toHaveBeenCalled();
    await service.githubAction('createPullRequest', ['owner', 'repo', {
      title: 'Improve search', body: 'Details', head: 'writer:fix-search', base: 'main',
    }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('creates a fork and submits only changes from its verified parent', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const calls: Array<{ url: string; method: string }> = [];
    let existingPull = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.endsWith('/user')) return Response.json({ login: 'writer', name: null, avatar_url: '', html_url: '' });
      if (url.includes('/user/repos?')) return Response.json([{ id: 20, name: 'Search', fork: true, owner: { login: 'writer' } }]);
      if (url.endsWith('/repos/author/Search')) return Response.json({ id: 10, name: 'Search', private: false, archived: false, allow_forking: true, default_branch: 'main', owner: { login: 'author' }, permissions: { pull: true, push: false } });
      if (url.endsWith('/repos/author/Search/forks')) return Response.json({ id: 20, name: 'Search', fork: true, owner: { login: 'writer' } }, { status: 202 });
      if (url.endsWith('/repos/writer/Search')) return Response.json({ id: 20, name: 'Search', fork: true, default_branch: 'main', owner: { login: 'writer' }, parent: { id: 10, full_name: 'author/Search', name: 'Search', default_branch: 'main', owner: { login: 'author' } } });
      if (url.includes('/compare/')) return Response.json({ ahead_by: 1, behind_by: 0, files: [{ filename: 'fix.txt' }] });
      if (url.includes('/pulls?')) return Response.json(existingPull ? [{ id: 30, number: 1, html_url: 'https://github.com/author/Search/pull/1' }] : []);
      if (url.endsWith('/repos/author/Search/pulls')) return Response.json({ id: 30, number: 1, title: 'Fix', html_url: 'https://github.com/author/Search/pull/1' }, { status: 201 });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const service = await import('./githubService');
    expect(await service.githubAction('forkRepo', ['author', 'Search', 'Search'])).toMatchObject({ id: 20, fork: true });
    expect(await service.githubAction('myFork', ['author', 'Search'])).toMatchObject({ id: 20, fork: true });
    expect(await service.githubAction('forkComparison', ['writer', 'Search'])).toMatchObject({ ahead_by: 1 });
    expect(await service.githubAction('submitForkContribution', ['writer', 'Search', 'Fix', 'Details'])).toMatchObject({ number: 1 });
    existingPull = true;
    expect(await service.githubAction('forkComparison', ['writer', 'Search'])).toMatchObject({ openRequest: { number: 1 } });
    expect(await service.githubAction('submitForkContribution', ['writer', 'Search', 'Fix again', 'Details'])).toMatchObject({ number: 1 });
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([
      'https://api.github.com/repos/author/Search/forks', 'https://api.github.com/repos/author/Search/pulls',
    ]);
    await expect(service.githubAction('submitForkContribution', ['other', 'Search', 'Fix', ''])).rejects.toThrow();
  });

  it('loads an authenticated project address, including a private project, after validating its parts', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const fetchMock = vi.fn(async () => Response.json({ id: 7, name: 'PrivateTool', private: true, owner: { login: 'tester' } }));
    vi.stubGlobal('fetch', fetchMock);
    const service = await import('./githubService');
    await expect(service.githubAction('repository', ['../other', 'PrivateTool'])).rejects.toThrow('填写的内容无效');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await service.githubAction('repository', ['tester', 'PrivateTool'])).toMatchObject({ id: 7, private: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('safe improvement request handling', () => {
  const headSha = 'a'.repeat(40);
  const blobSha = 'b'.repeat(40);
  const repository = { id: 10, name: 'sample', full_name: 'owner/sample', owner: { login: 'owner' }, permissions: { push: true, admin: false }, archived: false };
  const originalPull = { number: 7, state: 'open', merged: false, merged_at: null, draft: false, changed_files: 1, head: { sha: headSha, ref: 'fix', repo: { id: 20, name: 'copy', owner: { login: 'writer' } } }, base: { sha: 'c'.repeat(40), ref: 'main', repo: { id: 10 } } };
  const originalFile = { filename: 'src/fix.ts', status: 'modified', sha: blobSha, additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' };

  async function setup(options: { repository?: object; pull?: object; files?: object[]; changeHeadAfterFiles?: boolean; changeBaseAfterFiles?: boolean; mergeStatus?: number; commentStatus?: number; closeStatus?: number; onBlob?: () => Promise<void> } = {}) {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    let filesFetched = false;
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/repos/owner/sample')) return Response.json(options.repository ?? repository);
      if (url.includes('/pulls/7/files?')) { filesFetched = true; return Response.json(options.files ?? [originalFile]); }
      if (url.endsWith('/pulls/7/merge')) return options.mergeStatus ? new Response(null, { status: options.mergeStatus }) : Response.json({ merged: true, sha: 'd'.repeat(40), message: 'Server text' });
      if (url.endsWith('/issues/7/comments')) return options.commentStatus ? new Response(null, { status: options.commentStatus }) : Response.json({ id: 1, body: 'Not suitable' });
      if (url.endsWith('/pulls/7')) {
        if (init?.method === 'PATCH') return options.closeStatus ? new Response(null, { status: options.closeStatus }) : Response.json({ ...originalPull, state: 'closed' });
        return Response.json(options.pull ?? { ...originalPull, ...(filesFetched && options.changeHeadAfterFiles ? { head: { ...originalPull.head, sha: 'e'.repeat(40) } } : {}), ...(filesFetched && options.changeBaseAfterFiles ? { base: { ...originalPull.base, sha: 'e'.repeat(40) } } : {}) });
      }
      if (url.endsWith(`/repos/writer/copy/git/blobs/${blobSha}`)) { await options.onBlob?.(); return new Response('changed content', { headers: { 'content-length': '15' } }); }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return { service: await import('./githubService'), fetchMock };
  }

  it('merges only the reviewed revision with current write permission', async () => {
    const { service, fetchMock } = await setup();
    expect(await service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).toMatchObject({ merged: true, message: '合并请求已批准并合入。' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://api.github.com/repos/owner/sample', 'https://api.github.com/repos/owner/sample/pulls/7', 'https://api.github.com/repos/owner/sample/pulls/7/merge']);
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({ sha: headSha, merge_method: 'merge' });
  });

  it.each([
    { repository: { ...repository, permissions: { push: false, admin: false } }, message: '审批权限' },
    { repository: { ...repository, archived: true }, message: '已存档' },
    { pull: { ...originalPull, draft: true }, message: '准备中' },
    { pull: { ...originalPull, state: 'closed' }, message: '已经处理' },
    { pull: { ...originalPull, merged: true }, message: '已经处理' },
    { pull: { ...originalPull, base: { repo: { id: 999 } } }, message: '所属的项目' },
    { pull: { ...originalPull, head: { sha: 'e'.repeat(40) } }, message: '新修改' },
    { pull: { ...originalPull, mergeable: false }, message: '作者确认' },
  ])('blocks a write when fresh repository or request checks fail: $message', async (options) => {
    const { service, fetchMock } = await setup(options);
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).rejects.toThrow(options.message);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('keeps project rules in force and reports concurrent changes naturally', async () => {
    for (const status of [405, 409]) {
      const { service } = await setup({ mergeStatus: status });
      await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).rejects.toThrow(status === 405 ? '检查和审批要求' : '新修改');
    }
  });

  it('chooses an allowed merge method and refuses disabled methods', async () => {
    for (const method of ['squash', 'rebase'] as const) {
      const { service, fetchMock } = await setup({ repository: { ...repository, allow_merge_commit: false, allow_squash_merge: method === 'squash', allow_rebase_merge: true } });
      await service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }]);
      expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string).merge_method).toBe(method);
    }
    const { service, fetchMock } = await setup({ repository: { ...repository, allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: false } });
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).rejects.toThrow('不允许这种合入方式');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('rejects by closing the request without changing repository content', async () => {
    const { service, fetchMock } = await setup();
    expect(await service.githubAction('rejectPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).toMatchObject({ state: 'closed' });
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(writes[0]?.[1]?.body as string)).toEqual({ state: 'closed' });
  });

  it('keeps rejection open on comment failure and reports a separately failed close', async () => {
    const failedComment = await setup({ commentStatus: 403 });
    await expect(failedComment.service.githubAction('rejectPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha, reason: 'Not suitable' }])).rejects.toThrow('未继续关闭');
    expect(failedComment.fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    const failedClose = await setup({ closeStatus: 403 });
    await expect(failedClose.service.githubAction('rejectPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha, reason: 'Not suitable' }])).rejects.toThrow('拒绝说明已发送');
    const successful = await setup();
    expect(await successful.service.githubAction('rejectPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha, reason: 'Not suitable' }])).toMatchObject({ state: 'closed' });
    expect(successful.fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'GET', 'POST', 'GET', 'GET', 'PATCH']);
  });

  it('rejects malformed action input before network requests', async () => {
    const { service, fetchMock } = await setup();
    await expect(service.githubAction('activityCounts', [[{ id: 1, owner: '../other', name: 'sample' }]])).rejects.toThrow();
    await expect(service.githubAction('pullRequestsPage', ['owner', 'sample', 'everything', 1])).rejects.toThrow();
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: 'main' }])).rejects.toThrow('填写');
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha, method: 'force' }])).rejects.toThrow('填写');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses approval and rejection if the reviewed destination was retargeted or updated', async () => {
    for (const base of [{ ...originalPull.base, ref: 'release' }, { ...originalPull.base, sha: 'f'.repeat(40) }]) {
      const { service, fetchMock } = await setup({ pull: { ...originalPull, base } });
      for (const action of ['acceptPullRequest', 'rejectPullRequest']) {
        await expect(service.githubAction(action, ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).rejects.toThrow('接收改进的位置或内容已经改变');
      }
      expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    }
    const { service, fetchMock } = await setup();
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha }])).rejects.toThrow('填写');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('detects changed request contents while loading review files', async () => {
    for (const options of [{ changeHeadAfterFiles: true }, { changeBaseAfterFiles: true }]) {
      const { service } = await setup(options);
      await expect(service.getPullRequestReviewContext('owner', 'sample', 7, headSha)).rejects.toThrow('新修改');
    }
    const { service } = await setup({ pull: { ...originalPull, changed_files: 2 } });
    expect(await service.getPullRequestReviewContext('owner', 'sample', 7, headSha)).toMatchObject({ filesTruncated: true, files: [originalFile] });
  });

  it('exposes only a validated current file snapshot through the renderer read action', async () => {
    const { service, fetchMock } = await setup();
    await expect(service.githubAction('pullReviewContext', ['owner', 'sample', 0, headSha])).rejects.toThrow('填写');
    await expect(service.githubAction('pullReviewContext', ['owner', 'sample', 7, 'main'])).rejects.toThrow('填写');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await service.githubAction('pullReviewContext', ['owner', 'sample', 7, headSha])).toMatchObject({ pullRequest: { head: { sha: headSha } }, files: [originalFile], filesTruncated: false });
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
    const stale = await setup({ changeHeadAfterFiles: true });
    await expect(stale.service.githubAction('pullReviewContext', ['owner', 'sample', 7, headSha])).rejects.toThrow('新修改');
  });

  it('cancels review snapshot reads using the shared read cancellation control', async () => {
    const { service } = await setup();
    let requestStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestStarted?.();
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const pending = service.githubAction('pullReviewContext', ['owner', 'sample', 7, headSha]);
    await started;
    service.cancelGithubReads();
    await expect(pending).rejects.toThrow('操作已取消');
  });

  it('downloads only a selected request file from its immutable blob and registers the saved file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'easyhub-pull-download-'));
    try {
      const path = join(folder, 'fix.ts');
      desktop.save.mockResolvedValue({ canceled: false, filePath: path });
      const { service, fetchMock } = await setup();
      const progress = vi.fn();
      expect(await service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', progress, headSha)).toBe(path);
      expect(await readFile(path, 'utf8')).toBe('changed content');
      expect(progress).toHaveBeenLastCalledWith({ loaded: 15, total: 15, percent: 100 });
      service.revealDownloadedArchive(path);
      expect(desktop.reveal).toHaveBeenCalledWith(path);
      const blobCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/git/blobs/'));
      expect(blobCall?.[0]).toBe(`https://api.github.com/repos/writer/copy/git/blobs/${blobSha}`);
      expect(blobCall?.[1]?.redirect).toBe('error');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('blocks path injection, unknown files and removed files before selecting a destination', async () => {
    const { service, fetchMock } = await setup();
    for (const path of ['../fix.ts', '/etc/passwd', 'https://evil.test/file', 'src\\fix.ts']) {
      await expect(service.downloadPullRequestFile('owner', 'sample', 7, path, vi.fn(), headSha)).rejects.toThrow('填写');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(service.downloadPullRequestFile('owner', 'sample', 7, 'secret.txt', vi.fn(), headSha)).rejects.toThrow('不在合并请求');
    const removed = await setup({ files: [{ ...originalFile, status: 'removed' }] });
    await expect(removed.service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', vi.fn(), headSha)).rejects.toThrow('已被删除');
    expect(desktop.save).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing download without confirmation', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'easyhub-pull-overwrite-'));
    try {
      const path = join(folder, 'fix.ts');
      await writeFile(path, 'keep my file');
      desktop.save.mockResolvedValue({ canceled: false, filePath: path });
      desktop.confirm.mockResolvedValue({ response: 0 });
      const { service, fetchMock } = await setup();
      expect(await service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', vi.fn(), headSha)).toBeNull();
      expect(await readFile(path, 'utf8')).toBe('keep my file');
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/git/blobs/'))).toBe(true);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('asks at final save when a new local file appears during the download', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'easyhub-pull-race-'));
    try {
      const path = join(folder, 'fix.ts');
      desktop.save.mockResolvedValue({ canceled: false, filePath: path });
      desktop.confirm.mockResolvedValue({ response: 0 });
      const { service } = await setup({ onBlob: () => writeFile(path, 'created while downloading') });
      expect(await service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', vi.fn(), headSha)).toBeNull();
      expect(await readFile(path, 'utf8')).toBe('created while downloading');
      expect(desktop.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('下载已完成') }));
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('replaces an existing file only after final explicit confirmation', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'easyhub-pull-confirmed-'));
    try {
      const path = join(folder, 'fix.ts');
      await writeFile(path, 'before download');
      desktop.save.mockResolvedValue({ canceled: false, filePath: path });
      let checkedLatest = false;
      desktop.confirm.mockImplementation(async () => { checkedLatest = (await readFile(path, 'utf8')) === 'latest edit'; return { response: 1 }; });
      const { service } = await setup({ onBlob: () => writeFile(path, 'latest edit') });
      expect(await service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', vi.fn(), headSha)).toBe(path);
      expect(checkedLatest).toBe(true);
      expect(await readFile(path, 'utf8')).toBe('changed content');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
