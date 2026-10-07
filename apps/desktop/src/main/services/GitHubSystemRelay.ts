import { randomBytes } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { connect as connectTcp } from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { isGitHubHost, parseDnsAnswers } from './githubProxyOrigin';

interface RelayOptions { connect?: (host: string, signal: AbortSignal) => Promise<Duplex> }
interface RelayEndpoints { pacUrl: string; proxyUrl: string }
const CONNECT_TIMEOUT_MS = 12000;
const IDLE_TIMEOUT_MS = 60000;
const MAX_CONNECTIONS = 32;

// PAC engines need an ES5 predicate. Every literal is checked against the
// application's authoritative host predicate before publishing the script.
const PAC_HOSTS = [
  'github.com', 'www.github.com', 'api.github.com', 'uploads.github.com', 'codeload.github.com',
  'gist.github.com', 'raw.githubusercontent.com', 'gist.githubusercontent.com',
  'avatars.githubusercontent.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com', 'media.githubusercontent.com', 'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com', 'camo.githubusercontent.com', 'desktop.githubusercontent.com',
  'github.githubassets.com', 'opengraph.githubassets.com', 'github.global.ssl.fastly.net', 'github.map.fastly.net',
  'pages.github.com', 'raw.github.com', 'githubusercontent.com', 'cloud.githubusercontent.com', 'support-assets.githubassets.com',
].filter(isGitHubHost);

function pacScript(port: number): string {
  return `function FindProxyForURL(url, host) {
  if (!/^https:\\/\\/[^/:]+(?::443)?(?:\\/|$)/.test(url)) return "DIRECT";
  host = host.toLowerCase();
  var hosts = ${JSON.stringify(PAC_HOSTS)};
  var allowed = /^avatars[0-9]\\.githubusercontent\\.com$/.test(host) ||
    /^github-production-(?:release-asset|user-asset|repository-file)-[a-z0-9-]+\\.s3\\.amazonaws\\.com$/.test(host) ||
    /^productionresultssa[0-9]{1,3}\\.blob\\.core\\.windows\\.net$/.test(host);
  for (var i = 0; i < hosts.length; i++) if (hosts[i] === host) allowed = true;
  return allowed ? "PROXY 127.0.0.1:${port}; DIRECT" : "DIRECT";
}\n`;
}

/** Default transport preserves the browser's TLS bytes and original SNI. */
async function openTcp(host: string, signal: AbortSignal): Promise<Duplex> {
  if (signal.aborted) throw new Error('Connection cancelled.');
  const answers = await resolve4(host);
  const addresses = parseDnsAnswers({ Status: 0, Answer: answers.map(data => ({ type: 1, data })) });
  for (const address of addresses) {
    if (signal.aborted) throw new Error('Connection cancelled.');
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connectTcp({ host: address, port: 443, signal, allowHalfOpen: true });
        const failed = (error: Error): void => { socket.destroy(); reject(error); };
        socket.once('error', failed);
        socket.once('connect', () => {
          socket.removeListener('error', failed);
          // A transport error can occur before the relay attaches listeners.
          socket.on('error', () => undefined);
          resolve(socket);
        });
      });
    } catch { if (signal.aborted) throw new Error('Connection cancelled.'); }
  }
  throw new Error('GitHub connection unavailable.');
}

function reply(socket: Duplex, status: string): void {
  if (!socket.destroyed && socket.writable) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Loopback-only HTTPS CONNECT relay. It never terminates or changes TLS. */
export class GitHubSystemRelay {
  private readonly connector: NonNullable<RelayOptions['connect']>;
  private server: Server | null = null;
  private endpoints: RelayEndpoints | null = null;
  private pacPath = '';
  private localAuthority = '';
  private startJob: Promise<RelayEndpoints> | null = null;
  private stopJob: Promise<void> | null = null;
  private stopping = false;
  private readonly sockets = new Set<Socket>();
  private readonly upstreams = new Set<Duplex>();
  private readonly pending = new Set<AbortController>();

  constructor(options: RelayOptions = {}) { this.connector = options.connect ?? openTcp; }

  async start(): Promise<RelayEndpoints> {
    if (this.stopJob) await this.stopJob;
    if (this.endpoints) return { ...this.endpoints };
    if (this.startJob) return this.startJob;
    this.startJob = this.listen();
    try { return await this.startJob; }
    finally { this.startJob = null; }
  }

  private async listen(): Promise<RelayEndpoints> {
    this.stopping = false;
    this.pacPath = `/easyhub-${randomBytes(24).toString('hex')}.pac`;
    const server = createServer({ maxHeaderSize: 8192, headersTimeout: 10000,
      requestTimeout: 10000, keepAliveTimeout: 1000 },
    (request, response) => this.servePac(request, response));
    this.server = server;
    server.maxConnections = MAX_CONNECTIONS;
    server.maxHeadersCount = 32;
    server.on('connection', socket => {
      if (this.stopping) { socket.destroy(); return; }
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      // Covers incomplete headers as well as idle tunnels.
      socket.setTimeout(10000, () => socket.destroy());
      socket.on('error', () => undefined);
    });
    server.on('connect', (request, socket, head) => { void this.tunnel(request, socket as Socket, head); });
    server.on('upgrade', (_request, socket) => reply(socket, '403 Forbidden'));
    server.on('clientError', (error, socket) => reply(socket,
      'code' in error && error.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large' : '400 Bad Request'));
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error): void => reject(error);
        server.once('error', failed);
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', failed); resolve(); });
      });
      server.on('error', () => { void this.stop(); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Local relay unavailable.');
      this.localAuthority = `127.0.0.1:${address.port}`;
      this.endpoints = { pacUrl: `http://${this.localAuthority}${this.pacPath}`, proxyUrl: `http://${this.localAuthority}` };
      return { ...this.endpoints };
    } catch (error) { this.server = null; server.close(); throw error; }
  }

  private servePac(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader('Connection', 'close');
    if (this.stopping || request.method !== 'GET' || request.url !== this.pacPath ||
        request.headers.host !== this.localAuthority || request.headers['transfer-encoding'] ||
        request.headers['content-length'] && request.headers['content-length'] !== '0') {
      response.writeHead(403); response.end(); return;
    }
    response.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(pacScript(Number(this.localAuthority.split(':')[1])));
  }

  private async tunnel(request: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    const match = /^([a-z0-9][a-z0-9.-]*):443$/iu.exec(request.url ?? '');
    const host = match?.[1]?.toLowerCase();
    if (this.stopping || !host || !isGitHubHost(host) || request.headers['content-length'] ||
        request.headers['transfer-encoding']) { reply(client, '403 Forbidden'); return; }
    client.pause();
    const controller = new AbortController(); this.pending.add(controller);
    let upstream: Duplex | undefined;
    let established = false;
    let failed = false;
    const cancel = (): void => { controller.abort(); upstream?.destroy(); };
    const fail = (status: string): void => {
      if (failed || established) return;
      failed = true; controller.abort(); reply(client, status);
    };
    client.once('close', cancel);
    client.once('error', cancel);
    const timer = setTimeout(() => fail('504 Gateway Timeout'), CONNECT_TIMEOUT_MS);
    client.setTimeout(IDLE_TIMEOUT_MS, () => { cancel(); client.destroy(); });
    try {
      upstream = await this.connector(host, controller.signal);
      if (controller.signal.aborted || client.destroyed || this.stopping) { upstream.destroy(); return; }
      this.upstreams.add(upstream);
      upstream.once('close', () => {
        this.upstreams.delete(upstream!);
        if (!upstream!.readableEnded) client.destroy();
      });
      upstream.once('error', () => client.destroy());
      established = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      // The head is already TLS payload, never another HTTP request to inspect.
      if (head.length && !upstream.write(head)) await new Promise<void>(resolve => {
        const finish = (): void => {
          upstream!.removeListener('drain', finish); upstream!.removeListener('close', finish); resolve();
        };
        upstream!.once('drain', finish); upstream!.once('close', finish);
      });
      if (client.destroyed || upstream.destroyed) return;
      client.pipe(upstream); upstream.pipe(client); client.resume();
    } catch {
      if (established) { cancel(); client.destroy(); }
      else fail('502 Bad Gateway');
    }
    finally { clearTimeout(timer); this.pending.delete(controller); }
  }

  ownsProxyChoice(choice: string): boolean {
    if (!this.endpoints) return false;
    const entries = choice.split(';').map(entry => entry.trim()).filter(entry => entry && !/^DIRECT$/iu.test(entry));
    return entries.length > 0 && entries.every(entry => entry.toUpperCase() === `PROXY ${this.localAuthority}`.toUpperCase());
  }

  async stop(): Promise<void> {
    if (this.stopJob) return this.stopJob;
    this.stopJob = this.close();
    try { await this.stopJob; }
    finally { this.stopJob = null; }
  }

  private async close(): Promise<void> {
    if (this.startJob) await this.startJob.catch(() => undefined);
    this.stopping = true;
    this.endpoints = null;
    this.pending.forEach(controller => controller.abort()); this.pending.clear();
    this.upstreams.forEach(socket => socket.destroy()); this.upstreams.clear();
    this.sockets.forEach(socket => socket.destroy()); this.sockets.clear();
    const server = this.server; this.server = null;
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    this.localAuthority = ''; this.pacPath = '';
  }
}
