import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Duplex } from 'node:stream';
import { request } from 'node:https';
import type { ConnectionOptions, TLSSocket } from 'node:tls';
import { connect, checkServerIdentity } from 'node:tls';
import { GitHubOriginAgent, isGitHubHost, parseDnsAnswers } from './githubProxyOrigin';
import type { OriginRule } from './githubProxyOrigin';
import { DEFAULT_GITHUB_RULES } from './steamGitHubRules';

const dns = vi.hoisted(() => ({ resolve4: vi.fn() }));
vi.mock('node:dns/promises', () => ({ resolve4: dns.resolve4 }));

class Socket extends Duplex {
  authorized = true;
  authorizationError: Error | null = null;
  peerHost = 'github.com';
  writes: string[] = [];
  _read(): void {}
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void { this.writes.push(chunk.toString()); callback(); }
  getPeerCertificate(): { subjectaltname: string; subject: { CN: string } } {
    return { subjectaltname: `DNS:${this.peerHost}`, subject: { CN: this.peerHost } };
  }
}

const addresses = ['140.82.114.4', '140.82.112.4'];
const fetchDns = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ Status: 0, Answer: addresses.map(data => ({ type: 1, data })) })));
let created: Socket[] = [];
let optionsSeen: ConnectionOptions[] = [];
let agents: GitHubOriginAgent[] = [];
function connector(behavior: (options: ConnectionOptions, socket: Socket) => void): typeof connect {
  return vi.fn((options: ConnectionOptions) => {
    optionsSeen.push(options);
    const socket = new Socket(); created.push(socket);
    queueMicrotask(() => behavior(options, socket));
    return socket as unknown as TLSSocket;
  }) as unknown as typeof connect;
}
function makeAgent(connectTls = connector((_options, socket) => socket.emit('secureConnect'))): GitHubOriginAgent {
  const agent = new GitHubOriginAgent({ fetchDns, connectTls, connectTimeoutMs: 30, rules: { 'github.com': { servername: '' } } }); agents.push(agent); return agent;
}
function connection(agent: GitHubOriginAgent, options: Parameters<GitHubOriginAgent['createConnection']>[0] = { hostname: 'github.com', port: 443 }): Promise<Duplex> {
  return new Promise((resolve, reject) => { agent.createConnection(options, (error, socket) => error ? reject(error) : resolve(socket)); });
}

describe('GitHub app-local origin routing', () => {
  beforeEach(() => { created = []; optionsSeen = []; agents = []; dns.resolve4.mockResolvedValue([]); fetchDns.mockClear(); });
  afterEach(() => { agents.forEach(agent => agent.destroy()); vi.restoreAllMocks(); });

  it('restricts acceleration to GitHub-owned application origins', () => {
    for (const host of ['github.com', 'api.github.com', 'uploads.github.com', 'codeload.github.com', 'gist.github.com',
      'raw.githubusercontent.com', 'avatars.githubusercontent.com', 'avatars2.githubusercontent.com',
      'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'private-user-images.githubusercontent.com',
      'github.githubassets.com', 'productionresultssa0.blob.core.windows.net', 'github-production-release-asset-2e65be.s3.amazonaws.com']) expect(isGitHubHost(host)).toBe(true);
    for (const host of ['github.com.evil.com', 'evil.github.com', 'unrelated.s3.amazonaws.com', 'evil.blob.core.windows.net',
      'http://github.com', 'user@github.com', 'github.com:443', '127.0.0.1', 'github.com/']) expect(isGitHubHost(host)).toBe(false);
  });

  it('rejects private, reserved, malformed or non-A DNS answers', () => {
    const invalid = ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.1.1',
      '198.18.0.1', '224.0.0.1', '0.1.2.3', '192.0.2.1', '198.51.100.3', '203.0.113.1', '255.255.255.255', '1.2.3.999'];
    expect(parseDnsAnswers({ Status: 0, Answer: [
      ...invalid.map(data => ({ type: 1, data })), { type: 28, data: '::1' }, { type: 1, data: '140.82.114.4' },
      { type: 1, data: '140.82.114.4' }, { type: 1, data: 22 },
    ] })).toEqual(['140.82.114.4']);
    expect(parseDnsAnswers({ Status: 3, Answer: [{ type: 1, data: '140.82.114.4' }] })).toEqual([]);
    expect(parseDnsAnswers(null)).toEqual([]);
  });

  it('connects to a public IP while retaining original-host certificate verification', async () => {
    const agent = makeAgent(); const original = { hostname: 'github.com', port: 443, rejectUnauthorized: false, servername: 'evil.com' };
    await connection(agent, original);
    expect(original.hostname).toBe('github.com');
    expect(optionsSeen[0]!.host).toBe('140.82.114.4');
    expect(optionsSeen.every(options => options.rejectUnauthorized === true)).toBe(true);
    const cert = created[0]!.getPeerCertificate() as Parameters<typeof checkServerIdentity>[1];
    expect(optionsSeen[0]!.checkServerIdentity?.('evil.com', cert)).toBeUndefined();
    expect(optionsSeen[0]!.checkServerIdentity?.('github.com', { ...cert, subjectaltname: 'DNS:evil.com' })).toBeInstanceOf(Error);
    expect(fetchDns.mock.calls).toHaveLength(2);
  });

  it('falls back before assigning the socket and destroys failed and losing candidates', async () => {
    const agent = makeAgent(connector((options, socket) => {
      if (options.servername !== 'github.com') socket.emit('error', new Error('SNI blocked'));
      else socket.emit('secureConnect');
    }));
    const winner = await connection(agent);
    expect(optionsSeen.some(options => options.servername === 'github.com')).toBe(true);
    expect(created.filter(socket => socket !== winner).every(socket => socket.destroyed)).toBe(true);
  });

  it('rejects a trusted certificate belonging to another hostname', async () => {
    const agent = makeAgent(connector((_options, socket) => { socket.peerHost = 'evil.com'; socket.emit('secureConnect'); }));
    await expect(connection(agent)).rejects.toThrow();
    expect(created.every(socket => socket.destroyed)).toBe(true);
  });

  it('rejects an untrusted chain even when its hostname is correct', async () => {
    const agent = makeAgent(connector((_options, socket) => { socket.authorized = false; socket.authorizationError = new Error('untrusted'); socket.emit('secureConnect'); }));
    await expect(connection(agent)).rejects.toThrow();
    expect(created.every(socket => socket.destroyed)).toBe(true);
  });

  it('does not open connections for arbitrary hosts, userinfo, sockets or custom ports', async () => {
    const agent = makeAgent();
    for (const options of [{ hostname: 'localhost', port: 443 }, { hostname: 'github.com', port: 8443 },
      { hostname: 'user@github.com', port: 443 }, { hostname: 'github.com', auth: 'user:password' },
      { hostname: 'github.com', socketPath: '/tmp/socket' }]) await expect(connection(agent, options)).rejects.toThrow();
    expect(created).toHaveLength(0); expect(fetchDns).not.toHaveBeenCalled();
  });

  it('uses a validated route cache and clearRoutes refreshes discovery', async () => {
    const agent = makeAgent(); await connection(agent); await connection(agent);
    expect(fetchDns.mock.calls).toHaveLength(2);
    agent.clearRoutes(); await connection(agent); expect(fetchDns.mock.calls).toHaveLength(4);
  });

  it('shares in-flight DNS resolution between concurrent requests', async () => {
    const agent = makeAgent(); await Promise.all([connection(agent), connection(agent), connection(agent)]);
    expect(fetchDns.mock.calls).toHaveLength(2);
  });

  it('fails within bounded handshake attempts and closes every timed-out socket', async () => {
    const agent = makeAgent(connector(() => undefined));
    await expect(connection(agent)).rejects.toThrow();
    expect(created.length).toBeLessThanOrEqual(9);
    expect(created.every(socket => socket.destroyed)).toBe(true);
  });

  it('destroys in-flight sockets when the agent is shut down', async () => {
    const agent = makeAgent(connector(() => undefined)); const pending = connection(agent);
    await vi.waitFor(() => expect(created.length).toBeGreaterThan(0));
    agent.destroy(); await expect(pending).rejects.toThrow(); expect(created.every(socket => socket.destroyed)).toBe(true);
  });

  it('fails without connecting when DNS returns only local or invalid addresses', async () => {
    fetchDns.mockResolvedValueOnce(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '127.0.0.1' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] })));
    dns.resolve4.mockResolvedValueOnce(['192.168.0.1']);
    await expect(connection(makeAgent())).rejects.toThrow(); expect(created).toHaveLength(0);
  });

  it('uses SteamTools rule addresses and the configured SNI without weakening identity checks', async () => {
    const agent = makeAgent(connector((_options, socket) => { socket.peerHost = 'raw.githubusercontent.com'; socket.emit('secureConnect'); }));
    agent.setRules({ 'raw.githubusercontent.com': { addresses: ['23.235.37.133'], servername: 'Github' } });
    await connection(agent, { hostname: 'raw.githubusercontent.com', port: 443 });
    expect(optionsSeen[0]!.host).toBe('23.235.37.133'); expect(optionsSeen[0]!.servername).toBe('Github');
    expect(optionsSeen[0]!.checkServerIdentity?.('Github', created[0]!.getPeerCertificate() as Parameters<typeof checkServerIdentity>[1])).toBeUndefined();
    expect(fetchDns).not.toHaveBeenCalled(); expect(dns.resolve4).not.toHaveBeenCalled();
  });

  it('allows only approved public rule targets and DNS aliases', () => {
    const agent = makeAgent();
    expect(() => agent.setRules({ 'api.github.com': { dnsName: 'githubapi.rmbgame.net', servername: '' } })).not.toThrow();
    const invalidRules: Array<Record<string, OriginRule>> = [{ 'api.github.com': { addresses: ['127.0.0.1'] } }, { 'api.github.com': { dnsName: 'localhost' } },
      { 'api.github.com': { dnsName: 'evil.com' } }, { 'evil.com': { addresses: ['140.82.114.4'] } },
      { 'github.com': { servername: 'evil.com' } }];
    for (const rules of invalidRules) expect(() => agent.setRules(rules)).toThrow();
  });

  it('queries an approved DNS alias but verifies the original API hostname', async () => {
    const agent = makeAgent(connector((_options, socket) => { socket.peerHost = 'api.github.com'; socket.emit('secureConnect'); }));
    agent.setRules({ 'api.github.com': { dnsName: 'githubapi.rmbgame.net', servername: '' } });
    await connection(agent, { hostname: 'api.github.com', port: 443 });
    expect(fetchDns.mock.calls.some(([url]) => url.includes('name=githubapi.rmbgame.net'))).toBe(true);
    expect(optionsSeen[0]!.checkServerIdentity?.('', created[0]!.getPeerCertificate() as Parameters<typeof checkServerIdentity>[1])).toBeUndefined();
  });

  it('uses the original SNI when no acceleration rules have been supplied', async () => {
    const agent = new GitHubOriginAgent({ fetchDns, connectTls: connector((_options, socket) => socket.emit('secureConnect')), connectTimeoutMs: 30 });
    agents.push(agent); await connection(agent);
    expect(optionsSeen.every(options => options.servername === 'github.com')).toBe(true);
  });

  it('writes a real HTTP POST once, after a valid TLS candidate is selected', async () => {
    const agent = makeAgent(connector((options, socket) => {
      if (options.servername !== 'github.com') socket.emit('error', new Error('Blocked TLS handshake'));
      else socket.emit('secureConnect');
    }));
    const body = 'operation=publish-example';
    await new Promise<void>((resolve, reject) => {
      const req = request({ hostname: 'github.com', port: 443, path: '/login/device/code', method: 'POST', agent,
        headers: { 'Content-Length': Buffer.byteLength(body), 'Content-Type': 'application/x-www-form-urlencoded' } });
      req.once('error', reject); req.once('finish', () => { resolve(); req.destroy(); }); req.end(body);
    });
    const wrote = created.filter(socket => socket.writes.length);
    expect(wrote).toHaveLength(1);
    const bytes = wrote[0]!.writes.join('');
    expect(bytes).toContain('Host: github.com'); expect(bytes.match(/operation=publish-example/gu)).toHaveLength(1);
    expect(created.filter(socket => !socket.writes.length).every(socket => socket.destroyed)).toBe(true);
  });

  it('discovers original DNS only after a configured fixed route fails', async () => {
    const agent = makeAgent(connector((options, socket) => {
      if (options.host === '20.207.73.82') socket.emit('error', new Error('Old route unavailable'));
      else socket.emit('secureConnect');
    }));
    agent.setRules({ 'github.com': { addresses: ['20.207.73.82'], servername: '' } });
    await connection(agent); expect(optionsSeen[0]!.host).toBe('20.207.73.82'); expect(fetchDns).toHaveBeenCalledTimes(2);
    expect(optionsSeen.some(options => options.host === '140.82.114.4')).toBe(true);
  });

  it('does not let a connection started before a rules refresh repopulate an old route', async () => {
    const held: Socket[] = [];
    const agent = makeAgent(connector((_options, socket) => { held.push(socket); }));
    agent.setRules({ 'github.com': { addresses: ['20.207.73.82'], servername: '' } });
    const old = connection(agent); await vi.waitFor(() => expect(held.length).toBe(1), { interval: 1 });
    agent.setRules({ 'github.com': { addresses: ['140.82.114.4'], servername: '' } });
    held[0]!.emit('secureConnect'); await old;
    const fresh = connection(agent); await vi.waitFor(() => expect(held.length).toBe(2), { interval: 1 });
    held[1]!.emit('secureConnect'); await fresh;
    expect(optionsSeen[1]!.host).toBe('140.82.114.4');
  });

  it('cancels a pending DNS operation promptly when the agent is destroyed', async () => {
    fetchDns.mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const agent = makeAgent(); const pending = connection(agent);
    agent.destroy(); await expect(pending).rejects.toThrow(); expect(created).toHaveLength(0);
  });

  it('accepts the complete shipped SteamTools GitHub rules snapshot', () => {
    const agent = new GitHubOriginAgent({ rules: DEFAULT_GITHUB_RULES }); agents.push(agent);
    expect(agent).toBeInstanceOf(GitHubOriginAgent);
  });
});
