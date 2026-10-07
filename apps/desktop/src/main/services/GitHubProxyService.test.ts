import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubProxyService } from './GitHubProxyService';
import type { GitHubOriginAgent } from './githubProxyOrigin';

type Dependencies = ConstructorParameters<typeof GitHubProxyService>[1];
const roots: string[] = [];
const services: GitHubProxyService[] = [];

async function fixture(overrides: Partial<Dependencies> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'easyhub-proxy-service-test-'));
  roots.push(root);
  const settingsPath = join(root, 'preferences', 'github-proxy.json');
  const nativeFetch = vi.fn(async (_request: Request) => Response.json({}));
  const originFetch = vi.fn(async (_request: Request, _agent: GitHubOriginAgent) => new Response('GitHub fixture'));
  const resolveProxy = vi.fn(async (_url: string) => 'DIRECT');
  const legacyHosts = vi.fn(async () => false);
  const closeConnections = vi.fn(async () => undefined);
  const deps = { nativeFetch, originFetch, resolveProxy, legacyHosts, closeConnections, ...overrides };
  const service = new GitHubProxyService(settingsPath, deps);
  services.push(service);
  await service.initialize();
  return { service, settingsPath, deps, nativeFetch, originFetch, resolveProxy, legacyHosts, closeConnections };
}

afterEach(async () => {
  for (const service of services.splice(0)) service.destroy();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('GitHub application proxy', () => {
  it('routes immediately after enabling, before its background probes finish', async () => {
    const pending: { request: Request; resolve: (response: Response) => void }[] = [];
    const originFetch = vi.fn((request: Request, _agent: GitHubOriginAgent): Promise<Response> => {
      if (new URL(request.url).pathname === '/repos/owner/project') return Promise.resolve(Response.json({ id: 4 }));
      return new Promise(resolve => { pending.push({ request, resolve }); });
    });
    const { service, closeConnections } = await fixture({ originFetch });
    const enabling = service.setEnabled(true);
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(service.isEnabled()).toBe(true);
    expect((await service.status()).state).toBe('checking');
    expect(await (await service.fetch(new Request('https://api.github.com/repos/owner/project'))).json()).toEqual({ id: 4 });
    for (const probe of pending) probe.resolve(new Response(null, { status: 200 }));
    expect(await enabling).toMatchObject({ enabled: true, state: 'ready', error: null });
    expect(closeConnections).toHaveBeenCalledOnce();
  });

  it('persists only the preference, restores it on restart, and returns to native routing on disable', async () => {
    const { service, settingsPath, deps, nativeFetch, originFetch, closeConnections } = await fixture();
    expect(await service.status()).toMatchObject({ enabled: false, state: 'off', checks: [] });
    await service.setEnabled(true);
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ enabled: true });
    const restarted = new GitHubProxyService(settingsPath, deps);
    services.push(restarted);
    await restarted.initialize();
    expect(restarted.isEnabled()).toBe(true);
    originFetch.mockClear(); nativeFetch.mockClear();
    await restarted.fetch(new Request('https://api.github.com/user'));
    expect(originFetch).toHaveBeenCalledOnce();
    await restarted.setEnabled(false);
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ enabled: false });
    expect(await restarted.status()).toMatchObject({ enabled: false, state: 'off', checks: [], error: null });
    originFetch.mockClear(); nativeFetch.mockClear();
    await restarted.fetch(new Request('https://api.github.com/user'));
    expect(nativeFetch).toHaveBeenCalledOnce();
    expect(originFetch).not.toHaveBeenCalled();
    expect(closeConnections).toHaveBeenCalledTimes(2);
  });

  it.each(['PROXY 127.0.0.1:7890', 'HTTPS proxy.example:443', 'SOCKS5 127.0.0.1:1080', 'DIRECT; PROXY 127.0.0.1:8888'])
    ('respects the existing system route %s instead of creating an origin route', async (choice) => {
      const { service, nativeFetch, originFetch, resolveProxy } = await fixture({ resolveProxy: async () => choice });
      await service.setEnabled(true);
      nativeFetch.mockClear(); originFetch.mockClear(); resolveProxy.mockClear();
      const request = new Request('https://api.github.com/repos/owner/project', { headers: { Authorization: 'Bearer fixture-token' } });
      await service.fetch(request);
      expect(nativeFetch).toHaveBeenCalledExactlyOnceWith(request);
      expect(originFetch).not.toHaveBeenCalled();
    });

  it.each([
    'https://example.com/project',
    'https://github.com.example.com/project',
    'https://api.github.com:444/user',
    'http://api.github.com/user',
    'https://localhost/',
  ])('leaves non-target URLs on native routing: %s', async (url) => {
    const { service, nativeFetch, originFetch, resolveProxy } = await fixture();
    await service.setEnabled(true);
    nativeFetch.mockClear(); originFetch.mockClear(); resolveProxy.mockClear();
    const request = new Request(url);
    await service.fetch(request);
    expect(nativeFetch).toHaveBeenCalledExactlyOnceWith(request);
    expect(originFetch).not.toHaveBeenCalled();
    expect(resolveProxy).not.toHaveBeenCalled();
  });

  it('keeps authenticated request URLs and bodies at GitHub and sends no token or content to routing metadata providers', async () => {
    const { service, nativeFetch, originFetch, settingsPath } = await fixture();
    await service.setEnabled(true);
    const token = 'fixture-github-token-never-real';
    const request = new Request('https://api.github.com/repos/owner/project/issues', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Private fixture title', body: 'Private fixture content' }),
    });
    const response = await service.fetch(request);
    expect(response.ok).toBe(true);
    expect(originFetch.mock.calls.at(-1)?.[0]).toBe(request);
    expect(request.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(await request.clone().json()).toEqual({ title: 'Private fixture title', body: 'Private fixture content' });
    expect(nativeFetch).toHaveBeenCalledOnce();
    const publicRequest = nativeFetch.mock.calls[0]![0];
    expect(new URL(publicRequest.url).hostname).toBe('api.steampp.net');
    expect(publicRequest.headers.get('authorization')).toBeNull();
    expect(publicRequest.headers.get('cookie')).toBeNull();
    expect(publicRequest.headers.get('proxy-authorization')).toBeNull();
    expect(await publicRequest.clone().text()).toBe('{}');
    expect(await readFile(settingsPath, 'utf8')).not.toContain(token);
  });

  it('continues using bundled routes when the public rule source is offline', async () => {
    const nativeFetch = vi.fn(async (_request: Request): Promise<Response> => { throw new Error('Offline fixture'); });
    const { service, originFetch } = await fixture({ nativeFetch });
    const bundled = service.originRules();
    const state = await service.setEnabled(true);
    expect(state).toMatchObject({ enabled: true, state: 'ready', error: null });
    expect(state.checks).toHaveLength(3);
    expect(service.originRules()).toEqual(bundled);
    expect(Object.keys(bundled)).toContain('github.com');
    expect(Object.keys(bundled)).toContain('api.github.com');
    expect(originFetch).toHaveBeenCalledTimes(3);
  });

  it('exposes a natural-language failure without a transport error or secret', async () => {
    const originFetch = vi.fn(async (_request: Request, _agent: GitHubOriginAgent): Promise<Response> => {
      throw new Error('ETIMEDOUT stack Authorization: Bearer fixture-secret');
    });
    const { service } = await fixture({ originFetch });
    const status = await service.setEnabled(true);
    expect(status).toMatchObject({ enabled: true, state: 'error' });
    expect(status.error).toMatch(/连接|网络/u);
    expect(JSON.stringify(status)).not.toMatch(/ETIMEDOUT|stack|Bearer|fixture-secret/u);
    expect(status.checks).toHaveLength(3);
    expect(status.checks.every(check => !check.ok)).toBe(true);
    expect(status.checkedAt).not.toBeNull();
  });

  it('treats an API limit response as connected while keeping a failed download check visible', async () => {
    const originFetch = vi.fn(async (request: Request, _agent: GitHubOriginAgent): Promise<Response> =>
      new Response(null, { status: new URL(request.url).hostname === 'api.github.com' ? 429 : request.method === 'HEAD' ? 503 : 200 }));
    const { service } = await fixture({ originFetch });
    const status = await service.setEnabled(true);
    expect(status.state).toBe('error');
    expect(status.checks).toEqual(expect.arrayContaining([
      { target: 'login', ok: true }, { target: 'api', ok: true }, { target: 'download', ok: false },
    ]));
  });

  it('aborts every check and ignores late successful responses after cancellation', async () => {
    const pending: { request: Request; resolve: (response: Response) => void }[] = [];
    const originFetch = vi.fn((request: Request, _agent: GitHubOriginAgent): Promise<Response> =>
      new Promise(resolve => { pending.push({ request, resolve }); }));
    const { service } = await fixture({ originFetch });
    const enabling = service.setEnabled(true);
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    service.cancel();
    expect(pending.every(probe => probe.request.signal.aborted)).toBe(true);
    expect(await service.status()).toMatchObject({ enabled: true, state: 'off', checkedAt: null, error: null });
    for (const probe of pending) probe.resolve(new Response(null, { status: 200 }));
    await enabling;
    expect(await service.status()).toMatchObject({ enabled: true, state: 'off', checkedAt: null, checks: [], error: null });
  });

  it('does not install delayed routing metadata or start probes after its refresh was cancelled', async () => {
    let resolveRules: ((response: Response) => void) | undefined;
    const nativeFetch = vi.fn((_request: Request): Promise<Response> => new Promise(resolve => { resolveRules = resolve; }));
    const { service, originFetch } = await fixture({ nativeFetch });
    const bundled = service.originRules();
    const enabling = service.setEnabled(true);
    await vi.waitFor(() => expect(nativeFetch).toHaveBeenCalledOnce());
    const request = nativeFetch.mock.calls[0]![0];
    service.cancel();
    expect(request.signal.aborted).toBe(true);
    resolveRules!(Response.json([{ ProxyType: 0, Port: 443, ForwardDomainNames: '20.205.243.166',
      MatchDomainNames: 'github.com', FakeServerName: '' }]));
    await enabling;
    expect(service.originRules()).toEqual(bundled);
    expect(originFetch).not.toHaveBeenCalled();
    expect(await service.status()).toMatchObject({ enabled: true, state: 'off', checkedAt: null, checks: [] });
  });

  it('reports legacy Hosts entries read-only and tolerates failure to inspect them', async () => {
    const legacyHosts = vi.fn(async () => true);
    const { service } = await fixture({ legacyHosts });
    expect((await service.status()).legacyHosts).toBe(true);
    await service.setEnabled(true);
    expect((await service.status()).legacyHosts).toBe(true);
    legacyHosts.mockRejectedValueOnce(new Error('Fixture access denied'));
    expect((await service.status()).legacyHosts).toBe(false);
  });

  it('returns detached snapshots so a caller cannot edit checks or active route rules', async () => {
    const { service } = await fixture();
    await service.setEnabled(true);
    const status = await service.status();
    status.checks[0]!.ok = false;
    const rules = service.originRules();
    delete rules['github.com'];
    expect((await service.status()).checks.every(check => check.ok)).toBe(true);
    expect(service.originRules()).toHaveProperty('github.com');
  });

  it('starts disabled when persisted preferences are malformed', async () => {
    const { settingsPath, deps, service } = await fixture();
    await service.setEnabled(false);
    await writeFile(settingsPath, '{broken fixture', 'utf8');
    const restarted = new GitHubProxyService(settingsPath, deps);
    services.push(restarted);
    await restarted.initialize();
    expect(restarted.isEnabled()).toBe(false);
    expect((await restarted.status()).state).toBe('off');
  });
});
