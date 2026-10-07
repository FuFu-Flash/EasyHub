import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import { connect, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { GitHubSystemRelay } from './GitHubSystemRelay';
import { isGitHubHost } from './githubProxyOrigin';

const relays: GitHubSystemRelay[] = [];
const servers: Server[] = [];
const sockets = new Set<Socket>();

function track(socket: Socket): Socket {
  sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  socket.on('error', () => undefined);
  return socket;
}

function makeRelay(connector?: (host: string, signal: AbortSignal) => Promise<Duplex>): GitHubSystemRelay {
  const relay = new GitHubSystemRelay(connector ? { connect: connector } : {});
  relays.push(relay); return relay;
}

async function echoConnector(): Promise<(host: string, signal: AbortSignal) => Promise<Duplex>> {
  const server = createServer({ allowHalfOpen: true }, socket => {
    track(socket);
    socket.on('data', chunk => socket.write(chunk));
    // A browser can finish sending and still receive the origin response.
    socket.on('end', () => socket.end());
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Echo fixture did not start.');
  return (_host, signal) => new Promise((resolve, reject) => {
    const socket = track(connect({ host: '127.0.0.1', port: address.port, signal, allowHalfOpen: true }));
    socket.once('error', reject);
    socket.once('connect', () => { socket.removeListener('error', reject); resolve(socket); });
  });
}

function httpGet(url: string, host?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: host ? { Host: host } : {} }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject); req.end();
  });
}

function exchange(proxyUrl: string, headers: string, payload = Buffer.alloc(0)): Promise<Buffer> {
  const url = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = track(connect({ host: url.hostname, port: Number(url.port), allowHalfOpen: true }));
    socket.once('connect', () => socket.end(Buffer.concat([Buffer.from(headers), payload])));
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('end', () => { socket.destroy(); resolve(Buffer.concat(chunks)); });
    socket.once('error', reject);
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('Fixture response timed out.')); });
  });
}

afterEach(async () => {
  await Promise.all(relays.splice(0).map(relay => relay.stop()));
  sockets.forEach(socket => socket.destroy()); sockets.clear();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('GitHub system CONNECT relay', () => {
  it('listens only on random loopback endpoints and scopes PAC to approved HTTPS origins', async () => {
    const relay = makeRelay(vi.fn(async () => { throw new Error('Unexpected origin request.'); }));
    const endpoints = await relay.start();
    expect(new URL(endpoints.proxyUrl).hostname).toBe('127.0.0.1');
    expect(Number(new URL(endpoints.proxyUrl).port)).toBeGreaterThan(0);
    expect(new URL(endpoints.pacUrl).pathname).toMatch(/^\/easyhub-[a-f0-9]{48}\.pac$/u);
    expect(await relay.start()).toEqual(endpoints);
    const response = await httpGet(endpoints.pacUrl);
    expect(response.status).toBe(200);
    const decide = runInNewContext(`${response.body}\nFindProxyForURL;`) as (url: string, host: string) => string;
    const hosts = ['github.com', 'www.github.com', 'api.github.com', 'uploads.github.com', 'codeload.github.com',
      'gist.github.com', 'raw.githubusercontent.com', 'gist.githubusercontent.com', 'avatars.githubusercontent.com',
      'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com',
      'media.githubusercontent.com', 'user-images.githubusercontent.com', 'private-user-images.githubusercontent.com',
      'camo.githubusercontent.com', 'desktop.githubusercontent.com', 'github.githubassets.com', 'opengraph.githubassets.com',
      'github.global.ssl.fastly.net', 'github.map.fastly.net', 'pages.github.com', 'raw.github.com', 'githubusercontent.com',
      'cloud.githubusercontent.com', 'support-assets.githubassets.com', 'avatars0.githubusercontent.com',
      'productionresultssa0.blob.core.windows.net', 'github-production-release-asset-ab1.s3.amazonaws.com',
      'github-production-user-asset-ab1.s3.amazonaws.com', 'github-production-repository-file-ab1.s3.amazonaws.com',
      'github.com.evil.com', 'evil.github.com', 'evil.s3.amazonaws.com', 'evil.blob.core.windows.net',
      'example.com', '127.0.0.1', 'localhost', '__proto__'];
    const authority = new URL(endpoints.proxyUrl).host;
    for (const host of hosts) {
      expect(decide(`https://${host}/`, host)).toBe(isGitHubHost(host) ? `PROXY ${authority}; DIRECT` : 'DIRECT');
      expect(decide(`http://${host}/`, host)).toBe('DIRECT');
    }
    expect(decide('https://github.com:8443/', 'github.com')).toBe('DIRECT');
    expect(decide('https://github.com:443/', 'github.com')).toBe(`PROXY ${authority}; DIRECT`);
    expect(decide('https://github.com/a:8443/file', 'github.com')).toBe(`PROXY ${authority}; DIRECT`);
    expect(decide('https://GITHUB.COM/', 'GITHUB.COM')).toBe(`PROXY ${authority}; DIRECT`);
    expect(relay.ownsProxyChoice(`PROXY ${authority}; DIRECT`)).toBe(true);
    expect(relay.ownsProxyChoice(`PROXY localhost:${new URL(endpoints.proxyUrl).port}`)).toBe(false);
    expect(relay.ownsProxyChoice(`PROXY ${authority}; PROXY other.test:8080`)).toBe(false);
    expect(relay.ownsProxyChoice('DIRECT')).toBe(false);
  });

  it('relays opaque binary bytes, CONNECT head and half-close without forwarding proxy headers', async () => {
    const connector = vi.fn(await echoConnector());
    const relay = makeRelay(connector);
    const { proxyUrl } = await relay.start();
    const bytes = Buffer.alloc(256 * 1024);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
    bytes[0] = 0x16;
    const reply = await exchange(proxyUrl,
      'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\nProxy-Authorization: Basic fixture-only\r\n\r\n', bytes);
    const separator = reply.indexOf('\r\n\r\n');
    expect(reply.subarray(0, separator).toString()).toBe('HTTP/1.1 200 Connection Established');
    expect(reply.subarray(separator + 4)).toEqual(bytes);
    expect(connector).toHaveBeenCalledTimes(1);
    expect(connector.mock.calls[0]?.[0]).toBe('github.com');
  });

  it('rejects foreign hosts, other ports, credentials, IPs and malformed authorities before connecting', async () => {
    const connector = vi.fn(async () => { throw new Error('Should not connect.'); });
    const relay = makeRelay(connector);
    const { proxyUrl } = await relay.start();
    for (const authority of ['example.com:443', 'evil.github.com:443', 'github.com.evil.com:443',
      'github.com:80', 'github.com:0443', 'github.com', 'user:pass@github.com:443',
      '127.0.0.1:443', '[::1]:443', 'https://github.com:443', 'github.com.:443', 'github.com:443/path']) {
      const response = await exchange(proxyUrl, `CONNECT ${authority} HTTP/1.1\r\nHost: github.com:443\r\n\r\n`);
      expect(response.toString()).toMatch(/^HTTP\/1\.1 (?:400|403) /u);
    }
    expect(connector).not.toHaveBeenCalled();
  });

  it('serves only the exact PAC endpoint with its own loopback Host and rejects ordinary HTTP proxying', async () => {
    const relay = makeRelay();
    const { pacUrl, proxyUrl } = await relay.start();
    expect((await httpGet(pacUrl, 'evil.test')).status).toBe(403);
    expect((await httpGet(`${pacUrl}?extra`)).status).toBe(403);
    expect((await httpGet(`${proxyUrl}/`)).status).toBe(403);
    const response = await exchange(proxyUrl, 'GET https://github.com/ HTTP/1.1\r\nHost: github.com\r\n\r\n');
    expect(response.toString()).toMatch(/^HTTP\/1\.1 403 /u);
  });

  it('returns a generic gateway error without exposing connector details', async () => {
    const relay = makeRelay(async () => { throw new Error('fixture-private-details'); });
    const { proxyUrl } = await relay.start();
    const response = await exchange(proxyUrl, 'CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n');
    expect(response.toString()).toBe('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });

  it('rejects oversized CONNECT headers before opening an origin connection', async () => {
    const connector = vi.fn(async () => { throw new Error('Should not connect.'); });
    const relay = makeRelay(connector);
    const { proxyUrl } = await relay.start();
    const response = await exchange(proxyUrl,
      `CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\nX-Large: ${'a'.repeat(9000)}\r\n\r\n`);
    expect(response.toString()).toMatch(/^HTTP\/1\.1 431 /u);
    expect(connector).not.toHaveBeenCalled();
  });

  it('caps accepted connections at 32 and aborts every pending connector during shutdown', async () => {
    let arrived!: () => void;
    const entered = new Promise<void>(resolve => { arrived = resolve; });
    const signals: AbortSignal[] = [];
    const relay = makeRelay((_host, signal) => {
      signals.push(signal);
      if (signals.length === 32) arrived();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled.')), { once: true }));
    });
    const { proxyUrl } = await relay.start();
    const port = Number(new URL(proxyUrl).port);
    const header = 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n';
    for (let index = 0; index < 32; index++) {
      const client = track(connect({ host: '127.0.0.1', port }));
      client.once('connect', () => client.write(header));
    }
    await entered;
    const excess = track(connect({ host: '127.0.0.1', port }));
    const dropped = new Promise<void>(resolve => excess.once('close', () => resolve()));
    excess.once('connect', () => excess.write(header));
    await dropped;
    expect(signals).toHaveLength(32);
    await relay.stop();
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it('cancels pending connections and active tunnels on stop and can restart with a new PAC URL', async () => {
    let arrived!: () => void;
    const entered = new Promise<void>(resolve => { arrived = resolve; });
    let pendingSignal: AbortSignal | undefined;
    const relay = makeRelay((_host, signal) => {
      pendingSignal = signal; arrived();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled.')), { once: true }));
    });
    const endpoints = await relay.start();
    const client = track(connect({ host: '127.0.0.1', port: Number(new URL(endpoints.proxyUrl).port) }));
    await new Promise<void>(resolve => client.once('connect', resolve));
    client.write('CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n');
    await entered;
    const closed = new Promise<void>(resolve => client.once('close', () => resolve()));
    await Promise.all([relay.stop(), relay.stop()]);
    await closed;
    expect(pendingSignal?.aborted).toBe(true);
    expect(relay.ownsProxyChoice(`PROXY ${new URL(endpoints.proxyUrl).host}`)).toBe(false);
    await expect(httpGet(endpoints.pacUrl)).rejects.toThrow();
    const restarted = await relay.start();
    expect(restarted.pacUrl).not.toBe(endpoints.pacUrl);

    const activeRelay = makeRelay(await echoConnector());
    const activeEndpoint = await activeRelay.start();
    const active = track(connect({ host: '127.0.0.1', port: Number(new URL(activeEndpoint.proxyUrl).port) }));
    await new Promise<void>(resolve => active.once('connect', resolve));
    const established = new Promise<void>(resolve => active.once('data', () => resolve()));
    active.write('CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n');
    await established;
    const activeClosed = new Promise<void>(resolve => active.once('close', () => resolve()));
    await activeRelay.stop(); await activeClosed;
  });
});
