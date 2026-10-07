import { resolve4 } from 'node:dns/promises';
import { Agent } from 'node:https';
import type { RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity, connect } from 'node:tls';
import type { ConnectionOptions, TLSSocket } from 'node:tls';
import type { Duplex } from 'node:stream';

const githubHosts = new Set([
  'github.com', 'www.github.com', 'api.github.com', 'uploads.github.com', 'codeload.github.com',
  'gist.github.com', 'raw.githubusercontent.com', 'gist.githubusercontent.com',
  'avatars.githubusercontent.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com', 'media.githubusercontent.com', 'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com', 'camo.githubusercontent.com', 'desktop.githubusercontent.com',
  'github.githubassets.com', 'opengraph.githubassets.com', 'github.global.ssl.fastly.net', 'github.map.fastly.net',
  'pages.github.com', 'raw.github.com', 'githubusercontent.com', 'cloud.githubusercontent.com', 'support-assets.githubassets.com',
]);

export function isGitHubHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return githubHosts.has(normalized) || /^avatars[0-9]\.githubusercontent\.com$/u.test(normalized) ||
    /^github-production-(?:release-asset|user-asset|repository-file)-[a-z0-9-]+\.s3\.amazonaws\.com$/u.test(normalized) ||
    /^productionresultssa[0-9]{1,3}\.blob\.core\.windows\.net$/u.test(normalized);
}

function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 192 && b === 88 && c === 99) && !(a === 198 && (b === 18 || b === 19)) &&
    !(a === 198 && b === 51 && c === 100) && !(a === 203 && b === 0 && c === 113);
}

export function parseDnsAnswers(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('Status' in value) || value.Status !== 0 ||
      !('Answer' in value) || !Array.isArray(value.Answer)) return [];
  return [...new Set(value.Answer.flatMap((answer: unknown) => {
    if (!answer || typeof answer !== 'object' || !('type' in answer) || answer.type !== 1 ||
        !('data' in answer) || typeof answer.data !== 'string' || !publicIPv4(answer.data)) return [];
    return [answer.data];
  }))].slice(0, 8);
}

export interface OriginRule { addresses?: string[]; dnsName?: string; servername?: string }
interface OriginOptions {
  fetchDns?: (url: string, init: RequestInit) => Promise<Response>;
  connectTls?: typeof connect;
  connectTimeoutMs?: number;
  rules?: Record<string, OriginRule>;
}
interface Route { address: string; servername: string; expires: number }
interface DnsRoute { addresses: string[]; expires: number }
const CACHE_MS = 10 * 60 * 1000;
const DNS_MS = 2000;
const TOTAL_MS = 12000;
function unavailable(): Error { return new Error('暂时无法连接 GitHub，请稍后重试或检查网络。'); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { void promise.catch(() => undefined); reject(unavailable()); return; }
    const abort = (): void => reject(unavailable());
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * GitHub-specific TLS routing. HTTPS requests retain their original URL and Host;
 * only a verified origin socket is substituted before any request bytes are sent.
 * No public relay, certificate trust changes or system network settings are used.
 */
export class GitHubOriginAgent extends Agent {
  private readonly fetchDns: NonNullable<OriginOptions['fetchDns']>;
  private readonly connectTls: typeof connect;
  private readonly connectTimeout: number;
  private readonly dnsCache = new Map<string, DnsRoute>();
  private readonly routes = new Map<string, Route>();
  private readonly dnsJobs = new Map<string, Promise<string[]>>();
  private readonly pending = new Set<AbortController>();
  private rules = new Map<string, OriginRule>();
  private generation = 0;
  private stopped = false;

  constructor(options: OriginOptions = {}) {
    super({ keepAlive: true, maxSockets: 16, maxFreeSockets: 4, maxCachedSessions: 0 });
    this.fetchDns = options.fetchDns ?? ((url, init) => fetch(url, init));
    this.connectTls = options.connectTls ?? connect;
    this.connectTimeout = Math.max(10, Math.min(options.connectTimeoutMs ?? 3000, 3000));
    if (options.rules) this.setRules(options.rules);
  }

  setRules(rules: Record<string, OriginRule>): void {
    const validated = new Map<string, OriginRule>();
    for (const [host, rule] of Object.entries(rules)) {
      const normalized = host.toLowerCase();
      if (!isGitHubHost(normalized) || !rule || typeof rule !== 'object' ||
          rule.addresses !== undefined && (!Array.isArray(rule.addresses) || !rule.addresses.length || rule.addresses.length > 3 || !rule.addresses.every(address => typeof address === 'string' && publicIPv4(address))) ||
          rule.dnsName !== undefined && (typeof rule.dnsName !== 'string' || !isGitHubHost(rule.dnsName) && !['githubapi.rmbgame.net', 'githubdocs.rmbgame.net'].includes(rule.dnsName.toLowerCase())) ||
          rule.servername !== undefined && (typeof rule.servername !== 'string' || !['', 'github', normalized].includes(rule.servername.toLowerCase()))) {
        throw new Error('GitHub 加速规则无效。');
      }
      validated.set(normalized, { addresses: rule.addresses ? [...rule.addresses] : undefined,
        dnsName: rule.dnsName?.toLowerCase(), servername: rule.servername });
    }
    this.rules = validated; this.clearRoutes();
  }

  clearRoutes(): void {
    this.generation++; this.dnsCache.clear(); this.routes.clear(); this.dnsJobs.clear();
    for (const sockets of Object.values(this.freeSockets)) sockets?.forEach(socket => socket.destroy());
  }

  override destroy(): void {
    this.stopped = true;
    this.pending.forEach(controller => controller.abort());
    this.clearRoutes();
    super.destroy();
  }

  override createConnection(options: RequestOptions, callback?: (err: Error | null, stream: Duplex) => void): undefined {
    const host = (options.hostname ?? options.host ?? '').toLowerCase();
    if (!callback) throw new Error('GitHub 连接必须通过异步流程建立。');
    if (this.stopped || !isGitHubHost(host) || options.port !== undefined && Number(options.port) !== 443 ||
        options.auth || options.socketPath || options.protocol && options.protocol !== 'https:') {
      queueMicrotask(() => callback(new Error('GitHub 连接地址无效。'), null as unknown as Duplex));
      return undefined;
    }
    const controller = new AbortController(); this.pending.add(controller);
    const timer = setTimeout(() => controller.abort(), TOTAL_MS);
    const externalAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    void this.openOrigin(host, controller.signal).then(socket => callback(null, socket),
      error => callback(error instanceof Error ? error : unavailable(), null as unknown as Duplex)).finally(() => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', externalAbort); this.pending.delete(controller);
    });
    return undefined;
  }

  private addresses(host: string): Promise<string[]> {
    const cached = this.dnsCache.get(host);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.addresses);
    const pending = this.dnsJobs.get(host); if (pending) return pending;
    const generation = this.generation;
    const rule = this.rules.get(host);
    const job = Promise.all([this.discoverAddresses(rule?.dnsName ?? host),
      rule?.dnsName && rule.dnsName !== host ? this.discoverAddresses(host) : Promise.resolve([])]).then(results => {
      const addresses = [...new Set(results.flat())].slice(0, 3);
      if (addresses.length && !this.stopped && generation === this.generation) this.dnsCache.set(host, { addresses, expires: Date.now() + CACHE_MS });
      return addresses;
    }).finally(() => { if (this.dnsJobs.get(host) === job) this.dnsJobs.delete(host); });
    this.dnsJobs.set(host, job); return job;
  }

  private async discoverAddresses(host: string): Promise<string[]> {
    const providers = [`https://dns.alidns.com/resolve?name=${host}&type=A`,
      `https://cloudflare-dns.com/dns-query?name=${host}&type=A`];
    const query = async (url: string): Promise<string[]> => {
      const signal = AbortSignal.timeout(DNS_MS);
      const response = await abortable(this.fetchDns(url, { method: 'GET', headers: { Accept: 'application/dns-json' }, signal }), signal);
      if (!response.ok || Number(response.headers.get('content-length') || 0) > 65536) return [];
      const text = await abortable(response.text(), signal); if (text.length > 65536) return [];
      return parseDnsAnswers(JSON.parse(text) as unknown);
    };
    // resolve4 has no AbortSignal API. Bound our wait without altering the global resolver.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const system = Promise.race([resolve4(host).then(answers => answers.filter(publicIPv4)),
      new Promise<string[]>(resolve => { timer = setTimeout(() => resolve([]), DNS_MS); })]).finally(() => clearTimeout(timer));
    const results = await Promise.allSettled([...providers.map(query), system]);
    return [...new Set(results.flatMap(result => result.status === 'fulfilled' ? result.value : []))].slice(0, 3);
  }

  private async openOrigin(host: string, signal: AbortSignal): Promise<TLSSocket> {
    const generation = this.generation;
    const cached = this.routes.get(host);
    if (cached && cached.expires > Date.now()) {
      try { return await this.handshake(host, cached.address, cached.servername, signal); }
      catch { if (this.routes.get(host) === cached) this.routes.delete(host); if (signal.aborted) throw unavailable(); }
    }
    const rule = this.rules.get(host);
    const modes = [...new Set([...(rule?.servername !== undefined ? [rule.servername] : []), host])];
    // SteamTools fixed routes do not need a DNS request. Discover a fallback only
    // when none of those origin handshakes are usable on the current network.
    if (rule?.addresses?.length) {
      try { return await this.connectCandidates(host, rule.addresses, modes, signal, generation); }
      catch { if (signal.aborted) throw unavailable(); }
    }
    const addresses = await abortable(this.addresses(host), signal);
    if (signal.aborted || !addresses.length) throw unavailable();
    return this.connectCandidates(host, addresses, modes, signal, generation);
  }

  private async connectCandidates(host: string, addresses: string[], modes: string[], signal: AbortSignal, generation: number): Promise<TLSSocket> {
    if (signal.aborted) throw unavailable();
    const races = new AbortController();
    const onAbort = (): void => races.abort(); signal.addEventListener('abort', onAbort, { once: true });
    const candidates = addresses.map(async address => {
      for (const servername of modes) {
        if (races.signal.aborted) throw unavailable();
        try {
          const socket = await this.handshake(host, address, servername, races.signal);
          if (races.signal.aborted) { socket.destroy(); throw unavailable(); }
          return { socket, address, servername };
        } catch { if (races.signal.aborted) throw unavailable(); }
      }
      throw unavailable();
    });
    try {
      const winner = await Promise.any(candidates);
      if (generation === this.generation && !this.stopped) this.routes.set(host, { address: winner.address, servername: winner.servername, expires: Date.now() + CACHE_MS });
      // Abort listeners dispose connecting losers. Already validated losing
      // candidates need explicit disposal because their handshake is complete.
      races.abort();
      for (const candidate of candidates) void candidate.then(result => { if (result.socket !== winner.socket) result.socket.destroy(); }, () => undefined);
      return winner.socket;
    } catch { throw unavailable(); }
    finally { races.abort(); signal.removeEventListener('abort', onAbort); }
  }

  private handshake(host: string, address: string, servername: string, signal: AbortSignal): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(unavailable()); return; }
      let socket: TLSSocket;
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        socket?.removeListener('secureConnect', secure); socket?.removeListener('error', failed);
      };
      const failed = (): void => {
        if (finished) return; finished = true; cleanup(); socket?.destroy(); reject(unavailable());
      };
      const abort = (): void => failed();
      const secure = (): void => {
        try {
          if (!socket.authorized || checkServerIdentity(host, socket.getPeerCertificate(true))) { failed(); return; }
        } catch { failed(); return; }
        if (finished) return; finished = true; cleanup(); resolve(socket);
      };
      const tlsOptions: ConnectionOptions = {
        host: address, port: 443, servername,
        rejectUnauthorized: true, checkServerIdentity: (_servername, cert) => checkServerIdentity(host, cert),
        minVersion: 'TLSv1.2', ALPNProtocols: ['http/1.1'],
      };
      try {
        socket = this.connectTls(tlsOptions);
        socket.once('secureConnect', secure); socket.once('error', failed);
        // Failed sockets may report a late asynchronous error after disposal.
        socket.on('error', () => undefined);
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(failed, this.connectTimeout);
      } catch { failed(); }
    });
  }
}
