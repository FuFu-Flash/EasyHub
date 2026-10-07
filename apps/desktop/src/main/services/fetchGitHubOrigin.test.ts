import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import type { RequestOptions } from 'node:https';
import type { Duplex } from 'node:stream';
import { fetchGitHubOrigin } from './GitHubProxyService';
import { GitHubOriginAgent } from './githubProxyOrigin';

/**
 * Only the test transport is replaced with a loopback HTTP socket. Production
 * origin selection and strict TLS verification have their own agent tests;
 * this fixture exercises real Node request/response streaming without secrets,
 * external network access, certificates, or a production TLS bypass option.
 */
class FixtureAgent extends GitHubOriginAgent {
  readonly fixtureSockets: Socket[] = [];
  readonly connections: RequestOptions[] = [];

  constructor(private readonly fixturePort: number) { super(); }

  override createConnection(options: RequestOptions, callback?: (error: Error | null, socket: Duplex) => void): undefined {
    this.connections.push(options);
    const socket = connect({ host: '127.0.0.1', port: this.fixturePort });
    this.fixtureSockets.push(socket);
    const onError = (error: Error): void => { callback?.(error, socket); };
    socket.once('error', onError);
    socket.once('connect', () => { socket.removeListener('error', onError); callback?.(null, socket); });
    return undefined;
  }

  override destroy(): void {
    this.fixtureSockets.forEach(socket => socket.destroy());
    super.destroy();
  }
}

interface ReceivedRequest { method: string; path: string; headers: IncomingHttpHeaders; body: Buffer }
interface Fixture { server: Server; agent: FixtureAgent; received: ReceivedRequest[] }
const fixtures: Fixture[] = [];

async function fixture(handler: (request: IncomingMessage, response: ServerResponse, received: ReceivedRequest) => void): Promise<Fixture> {
  const received: ReceivedRequest[] = [];
  const server = createServer((request, response) => {
    const item: ReceivedRequest = { method: request.method ?? '', path: request.url ?? '', headers: request.headers, body: Buffer.alloc(0) };
    received.push(item);
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.once('end', () => { item.body = Buffer.concat(chunks); });
    handler(request, response, item);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback fixture did not start.');
  const result = { server, received, agent: new FixtureAgent(address.port) };
  fixtures.push(result);
  return result;
}

afterEach(async () => {
  for (const item of fixtures.splice(0)) {
    item.agent.destroy();
    item.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => item.server.close(error => error ? reject(error) : resolve()));
  }
});

describe('GitHub origin request streaming', () => {
  it('keeps the original URL, Host, method, and streamed POST bytes without resending', async () => {
    const app = await fixture((request, response, item) => {
      request.once('end', () => {
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end(item.body);
      });
    });
    const bytes = Buffer.from('first\u0000chunk\n第二段\nlast chunk', 'utf8');
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 8));
        controller.enqueue(bytes.subarray(8, 17));
        controller.enqueue(bytes.subarray(17));
        controller.close();
      },
    });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', body: source, duplex: 'half',
      headers: { Authorization: 'Bearer fixture-token', Host: 'incorrect.test', 'Content-Type': 'application/octet-stream' } };
    const input = new Request('https://api.github.com/repos/owner/project/git/blobs?test=one%20two', init);
    const response = await fetchGitHubOrigin(input, app.agent);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(input.url).toBe('https://api.github.com/repos/owner/project/git/blobs?test=one%20two');
    expect(app.received).toHaveLength(1);
    expect(app.received[0]).toMatchObject({ method: 'POST', path: '/repos/owner/project/git/blobs?test=one%20two', body: bytes });
    expect(app.received[0]?.headers.host).toBe('api.github.com');
    expect(app.received[0]?.headers.authorization).toBe('Bearer fixture-token');
    expect(app.received[0]?.headers['accept-encoding']).toBe('identity');
    expect(app.agent.connections).toHaveLength(1);
    expect(app.agent.connections[0]?.hostname).toBe('api.github.com');
  });

  it('strips hop and proxy credentials from request and response headers', async () => {
    const app = await fixture((_request, response) => {
      response.setHeader('Proxy-Authenticate', 'Basic realm="fixture"');
      response.setHeader('Connection', 'close');
      response.setHeader('Keep-Alive', 'timeout=5');
      response.setHeader('Upgrade', 'fixture-protocol');
      response.setHeader('X-GitHub-Request-Id', 'fixture-request');
      response.end('ok');
    });
    const response = await fetchGitHubOrigin(new Request('https://github.com/example', { headers: {
      'Proxy-Authorization': 'Basic fixture-proxy-token', 'Proxy-Authenticate': 'Basic fixture',
      Connection: 'close', 'Keep-Alive': 'timeout=5', TE: 'trailers', Trailer: 'x-fixture',
      Upgrade: 'fixture-protocol', 'X-GitHub-Api-Version': '2022-11-28',
    } }), app.agent);
    expect(await response.text()).toBe('ok');
    const headers = app.received[0]?.headers;
    for (const name of ['proxy-authorization', 'proxy-authenticate', 'keep-alive', 'te', 'trailer', 'upgrade']) {
      expect(headers?.[name]).toBeUndefined();
      expect(response.headers.has(name)).toBe(false);
    }
    // Node itself may add its own keep-alive Connection header.
    expect(headers?.connection).not.toBe('close');
    expect(response.headers.has('connection')).toBe(false);
    expect(response.headers.has('transfer-encoding')).toBe(false);
    expect(response.headers.get('x-github-request-id')).toBe('fixture-request');
    expect(headers?.['x-github-api-version']).toBe('2022-11-28');
  });

  it('strips extension hop headers named by Connection in both directions', async () => {
    const app = await fixture((_request, response) => {
      response.setHeader('Connection', 'close, x-fixture-response-hop');
      response.setHeader('X-Fixture-Response-Hop', 'transport-only');
      response.setHeader('X-Fixture-End-To-End', 'retained');
      response.end('ok');
    });
    const response = await fetchGitHubOrigin(new Request('https://api.github.com/example', { headers: {
      Connection: 'keep-alive, X-Fixture-Request-Hop', 'X-Fixture-Request-Hop': 'transport-only',
      'X-Fixture-End-To-End': 'retained',
    } }), app.agent);
    expect(await response.text()).toBe('ok');
    expect(app.received[0]?.headers['x-fixture-request-hop']).toBeUndefined();
    expect(response.headers.has('x-fixture-response-hop')).toBe(false);
    expect(app.received[0]?.headers['x-fixture-end-to-end']).toBe('retained');
    expect(response.headers.get('x-fixture-end-to-end')).toBe('retained');
  });

  it('returns headers and the first body chunk before the upstream finishes', async () => {
    let finish: (() => void) | undefined;
    let ended = false;
    const app = await fixture((_request, response) => {
      response.setHeader('Content-Type', 'text/plain');
      response.flushHeaders();
      response.write('first chunk');
      finish = () => { ended = true; response.end(' and the final chunk'); };
    });
    const response = await fetchGitHubOrigin(new Request('https://raw.githubusercontent.com/owner/project/main/file.txt'), app.agent);
    expect(ended).toBe(false);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader!.read();
    expect(new TextDecoder().decode(first.value)).toBe('first chunk');
    expect(first.done).toBe(false);
    expect(ended).toBe(false);
    finish?.();
    let remainder = '';
    for (;;) {
      const part = await reader!.read();
      if (part.done) break;
      remainder += new TextDecoder().decode(part.value);
    }
    expect(remainder).toBe(' and the final chunk');
  });

  it.each([301, 302, 303, 307, 308])('preserves safe %i redirects without following or resending the request', async status => {
    const location = 'https://release-assets.githubusercontent.com/github-production-release-asset/fixture?download=1';
    const app = await fixture((_request, response) => {
      response.statusCode = status;
      response.setHeader('Location', location);
      response.end('redirect body');
    });
    const response = await fetchGitHubOrigin(new Request('https://github.com/owner/project/releases/download/v1.0/file.zip'), app.agent);
    expect(response.status).toBe(status);
    expect(response.headers.get('location')).toBe(location);
    expect(await response.text()).toBe('redirect body');
    expect(app.received).toHaveLength(1);
    expect(app.agent.connections).toHaveLength(1);
  });

  it('allows safe relative GitHub redirects while preserving their Location header', async () => {
    const app = await fixture((_request, response) => {
      response.statusCode = 302;
      response.setHeader('Location', '../releases/tag/v1.0');
      response.end();
    });
    const response = await fetchGitHubOrigin(new Request('https://github.com/owner/project/releases/latest'), app.agent);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('../releases/tag/v1.0');
    await response.body?.cancel();
    expect(app.received).toHaveLength(1);
  });

  it.each([
    'http://github.com/download.zip', 'file:///C:/Windows/win.ini', 'https://example.com/download.zip',
    'https://github.com.evil.com/download.zip', 'https://github.com:8443/download.zip',
    'https://user:password@github.com/download.zip', '//example.com/download.zip',
  ])('rejects unsafe redirects to %s and closes the upstream stream', async location => {
    let closed = false;
    const app = await fixture((_request, response) => {
      response.statusCode = 302;
      response.setHeader('Location', location);
      response.once('close', () => { closed = true; });
      response.write('untrusted redirect body');
    });
    await expect(fetchGitHubOrigin(new Request('https://github.com/owner/project/releases/download/v1.0/file.zip'), app.agent))
      .rejects.toThrow();
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(app.agent.fixtureSockets.every(socket => socket.destroyed)).toBe(true);
    expect(app.received).toHaveLength(1);
  });

  it.each([
    { method: 'HEAD', status: 200 }, { method: 'GET', status: 204 },
    { method: 'GET', status: 205 }, { method: 'GET', status: 304 },
  ])('keeps $method $status responses bodyless', async ({ method, status }) => {
    const app = await fixture((_request, response) => {
      response.statusCode = status;
      response.setHeader('X-GitHub-Request-Id', 'bodyless');
      response.end();
    });
    const response = await fetchGitHubOrigin(new Request('https://api.github.com/bodyless', { method }), app.agent);
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe('');
    expect(response.headers.get('x-github-request-id')).toBe('bodyless');
  });

  it('disconnects a cancelled request before response headers', async () => {
    let closed = false;
    const app = await fixture((_request, response) => { response.once('close', () => { closed = true; }); });
    const controller = new AbortController();
    const pending = fetchGitHubOrigin(new Request('https://github.com/pending', { signal: controller.signal }), app.agent);
    const rejected = expect(pending).rejects.toThrow('操作已取消');
    await vi.waitFor(() => expect(app.received).toHaveLength(1));
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(app.agent.fixtureSockets.every(socket => socket.destroyed)).toBe(true);
  });

  it('disconnects and fails the response reader when cancelled during streaming', async () => {
    let closed = false;
    const app = await fixture((_request, response) => {
      response.once('close', () => { closed = true; });
      response.write('begin');
    });
    const controller = new AbortController();
    const response = await fetchGitHubOrigin(new Request('https://objects.githubusercontent.com/file', { signal: controller.signal }), app.agent);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('begin');
    const next = reader.read();
    const rejected = expect(next).rejects.toThrow();
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(app.agent.fixtureSockets.every(socket => socket.destroyed)).toBe(true);
  });

  it('closes the upstream when the consumer cancels its response body', async () => {
    let closed = false;
    const app = await fixture((_request, response) => {
      response.once('close', () => { closed = true; });
      response.write('begin');
    });
    const response = await fetchGitHubOrigin(new Request('https://objects.githubusercontent.com/file'), app.agent);
    await response.body!.cancel();
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(app.agent.fixtureSockets.every(socket => socket.destroyed)).toBe(true);
  });

  it('rejects an already cancelled request without sending an HTTP request', async () => {
    const app = await fixture((_request, response) => response.end('unexpected'));
    const controller = new AbortController();
    controller.abort();
    await expect(fetchGitHubOrigin(new Request('https://github.com/cancelled', { signal: controller.signal }), app.agent))
      .rejects.toThrow('操作已取消');
    expect(app.received).toHaveLength(0);
  });

  it('rejects non-GitHub domains, non-HTTPS or non-443 destinations, and credential URLs', async () => {
    const app = await fixture((_request, response) => response.end('unexpected'));
    for (const url of ['http://github.com/file', 'https://example.com/file', 'https://github.com.evil.com/file',
      'https://github.com:8443/file', 'https://user:password@github.com/file']) {
      const request = new Request('https://github.com/placeholder');
      // Web Request already rejects URL userinfo. Override its URL only to
      // exercise the transport's independent validation of Electron input.
      Object.defineProperty(request, 'url', { value: url });
      await expect(fetchGitHubOrigin(request, app.agent)).rejects.toThrow('GitHub 连接地址无效');
    }
    expect(app.received).toHaveLength(0);
    expect(app.agent.connections).toHaveLength(0);
  });
});
