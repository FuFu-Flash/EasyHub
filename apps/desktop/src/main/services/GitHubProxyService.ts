import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { GitHubProxyStatus } from '@easyhub/types';
import { GitHubOriginAgent, isGitHubHost } from './githubProxyOrigin';
import type { OriginRule } from './githubProxyOrigin';
import { DEFAULT_GITHUB_RULES, parseSteamGitHubRules } from './steamGitHubRules';
import { GITHUB_CLIENT_ID } from './githubAuthConfig';
import type { WindowsSystemProxy } from './WindowsSystemProxy';
import type { GitHubSystemRelay } from './GitHubSystemRelay';

interface ProxyDependencies {
  nativeFetch: (request: Request) => Promise<Response>;
  resolveProxy: (url: string) => Promise<string>;
  legacyHosts: () => Promise<boolean>;
  closeConnections?: () => Promise<void>;
  originFetch?: (request: Request, agent: GitHubOriginAgent) => Promise<Response>;
  systemProxy?: Pick<WindowsSystemProxy, 'initialize' | 'acquire' | 'release' | 'status' | 'destroy'>;
  systemRelay?: Pick<GitHubSystemRelay, 'start' | 'stop' | 'ownsProxyChoice'>;
}

const RULES_URL = 'https://api.steampp.net/accelerator/projectgroups';
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const CONNECT_TIMEOUT = 20000;

async function readRoutingJson(response: Response): Promise<unknown> {
  const maximum = 1024 * 1024;
  if (Number(response.headers.get('content-length') ?? 0) > maximum || !response.body) {
    await response.body?.cancel(); throw new Error('连接配置无效。');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > maximum) { await reader.cancel(); throw new Error('连接配置无效。'); }
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { reader.releaseLock(); }
}

/** Stream directly from GitHub. TLS is verified against the original URL by the agent. */
export function fetchGitHubOrigin(input: Request, agent: GitHubOriginAgent): Promise<Response> {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || !isGitHubHost(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) {
    return Promise.reject(new Error('GitHub 连接地址无效。'));
  }
  return new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = {};
    const requestHopHeaders = new Set([...HOP_HEADERS, ...(input.headers.get('connection') ?? '').toLowerCase().split(',').map(key => key.trim())]);
    input.headers.forEach((value, key) => { if (!requestHopHeaders.has(key) && key !== 'host') headers[key] = value; });
    headers.host = url.host;
    headers['accept-encoding'] = 'identity';
    headers['user-agent'] ||= 'EasyHub';
    const request = httpsRequest(url, { method: input.method, headers, agent }, (response) => {
      clearTimeout(connectTimer);
      const status = response.statusCode ?? 502;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        try {
          const target = new URL(response.headers.location, url);
          if (target.protocol !== 'https:' || !isGitHubHost(target.hostname) || target.username || target.password ||
              (target.port && target.port !== '443')) throw new Error('不支持的 GitHub 下载地址。');
        } catch {
          response.destroy(); cleanup(); reject(new Error('GitHub 返回了无效的下载地址，请重试。')); return;
        }
      }
      const responseHeaders = new Headers();
      const responseHopHeaders = new Set([...HOP_HEADERS, ...(response.headers.connection ?? '').toLowerCase().split(',').map(key => key.trim())]);
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        const key = response.rawHeaders[index]!;
        const value = response.rawHeaders[index + 1]!;
        if (!responseHopHeaders.has(key.toLowerCase())) responseHeaders.append(key, value);
      }
      const noBody = input.method === 'HEAD' || status === 204 || status === 205 || status === 304;
      response.once('end', cleanup);
      response.once('close', cleanup);
      response.setTimeout(30000, () => response.destroy(new Error('GitHub 响应等待时间过长，请重试。')));
      if (noBody) response.resume();
      resolve(new Response(noBody ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>, {
        status, headers: responseHeaders,
      }));
    });
    const connectTimer = setTimeout(() => request.destroy(new Error('连接 GitHub 超时，请重试。')), CONNECT_TIMEOUT);
    request.once('socket', () => clearTimeout(connectTimer));
    request.setTimeout(30000, () => request.destroy(new Error('GitHub 响应等待时间过长，请重试。')));
    const abort = (): void => { request.destroy(new Error('操作已取消。')); };
    function cleanup(): void { clearTimeout(connectTimer); input.signal.removeEventListener('abort', abort); }
    request.once('error', (error) => { cleanup(); reject(error); });
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) { abort(); return; }
    if (input.body) {
      void pipeline(Readable.fromWeb(input.body as import('node:stream/web').ReadableStream<Uint8Array>), request)
        .catch(error => { request.destroy(error instanceof Error ? error : new Error('发送失败。')); });
    } else request.end();
  });
}

/** App-local adaptation of SteamTools origin/DNS/SNI routing, with strict TLS verification. */
export class GitHubProxyService {
  private enabled = false;
  private state: GitHubProxyStatus['state'] = 'off';
  private error: string | null = null;
  private checkedAt: string | null = null;
  private checks: GitHubProxyStatus['checks'] = [];
  private rules: Record<string, OriginRule> = DEFAULT_GITHUB_RULES;
  private checkJob: AbortController | null = null;
  private systemState: GitHubProxyStatus['system'];
  private monitor: ReturnType<typeof setInterval> | undefined;
  private operationTail: Promise<void> = Promise.resolve();
  private destroyed = false;
  private systemRead: Promise<void> | null = null;
  private systemCheckedAt = 0;
  private systemVersion = 0;
  private destroyJob: Promise<void> | null = null;
  readonly agent: GitHubOriginAgent;

  constructor(private readonly settingsPath: string, private readonly deps: ProxyDependencies) {
    this.agent = new GitHubOriginAgent({ rules: this.rules,
      fetchDns: (url, init) => deps.nativeFetch(new Request(url, init)) });
  }

  async initialize(): Promise<void> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.settingsPath, 'utf8'));
      this.enabled = !!saved && typeof saved === 'object' && 'enabled' in saved && saved.enabled === true;
    } catch { this.enabled = false; }
    this.state = 'off';
    if (this.deps.systemProxy) {
      try {
        this.systemState = await this.deps.systemProxy.initialize();
        if (this.enabled) await this.activateSystem();
      } catch {
        this.state = 'error'; this.error = '无法设置系统代理，请关闭后重试。';
        this.systemState = { mode: 'unavailable' };
      }
    }
  }

  isEnabled(): boolean { return this.enabled; }
  originRules(): Record<string, OriginRule> { return structuredClone(this.rules); }

  async status(): Promise<GitHubProxyStatus> {
    if (this.deps.systemProxy && Date.now() - this.systemCheckedAt >= 1500) {
      const version = this.systemVersion;
      this.systemRead ??= this.deps.systemProxy.status().then(async value => {
        if (version !== this.systemVersion || this.destroyed) return;
        this.systemState = value;
        if (value.mode === 'external') await this.deps.systemRelay?.stop();
      }).catch(() => {
        if (version === this.systemVersion && !this.destroyed) this.systemState = { mode: 'unavailable' };
      }).finally(() => {
        if (version === this.systemVersion) this.systemCheckedAt = Date.now();
        this.systemRead = null;
      });
      await this.systemRead;
    }
    return { enabled: this.enabled, state: this.state, checkedAt: this.checkedAt, error: this.error,
      checks: this.checks.map(check => ({ ...check })), legacyHosts: await this.deps.legacyHosts().catch(() => false),
      ...(this.systemState ? { system: { ...this.systemState } } : {}) };
  }

  setEnabled(enabled: boolean): Promise<GitHubProxyStatus> {
    const next = this.operationTail.then(() => this.changeEnabled(enabled));
    this.operationTail = next.then(() => undefined, () => undefined);
    return next;
  }

  private async activateSystem(): Promise<void> {
    if (!this.deps.systemProxy || !this.deps.systemRelay) return;
    const endpoint = await this.deps.systemRelay.start();
    try {
      this.systemState = await this.deps.systemProxy.acquire(endpoint.pacUrl);
      this.systemVersion++;
      this.systemCheckedAt = Date.now();
      if (this.systemState.mode === 'unavailable') throw new Error('无法设置系统代理，请关闭后重试。');
      if (this.systemState.mode !== 'managed') await this.deps.systemRelay.stop();
    } catch {
      if (!await this.releaseSystem()) throw new Error(this.error!);
      throw new Error('无法设置系统代理，请关闭后重试。');
    }
    clearInterval(this.monitor);
    let reading = false;
    this.monitor = setInterval(() => {
      if (reading || this.destroyed) return;
      reading = true;
      void this.status().catch(() => undefined).finally(() => { reading = false; });
    }, 5000);
    this.monitor.unref();
  }

  /** Keep serving the PAC until Windows has confirmed that it no longer points here. */
  private async releaseSystem(): Promise<boolean> {
    if (this.deps.systemProxy) {
      try { this.systemState = await this.deps.systemProxy.release(); }
      catch { this.systemState = { mode: 'unavailable' }; }
      this.systemVersion++;
      this.systemCheckedAt = Date.now();
      if (this.systemState.mode === 'unavailable') {
        this.enabled = true;
        this.state = 'error'; this.error = '系统代理还未恢复，请重试关闭。';
        return false;
      }
    }
    await this.deps.systemRelay?.stop();
    return true;
  }

  private async changeEnabled(enabled: boolean): Promise<GitHubProxyStatus> {
    if (this.destroyed) throw new Error('应用正在退出，请稍后再试。');
    this.systemVersion++;
    this.cancel();
    if (enabled) await this.activateSystem();
    else {
      clearInterval(this.monitor);
      if (!await this.releaseSystem()) throw new Error(this.error!);
    }
    try {
      await mkdir(dirname(this.settingsPath), { recursive: true });
      const pending = `${this.settingsPath}.tmp`;
      await writeFile(pending, JSON.stringify({ enabled }), { mode: 0o600 });
      await rename(pending, this.settingsPath);
    } catch {
      if (enabled && this.deps.systemProxy) {
        if (!await this.releaseSystem()) throw new Error(this.error!);
      }
      throw new Error('无法保存代理设置，请检查应用数据目录后重试。');
    }
    this.enabled = enabled;
    this.state = 'off'; this.error = null; this.checks = [];
    this.agent.clearRoutes();
    await this.deps.closeConnections?.();
    if (this.destroyed) return this.status();
    return enabled ? this.refresh() : this.status();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!this.enabled || url.protocol !== 'https:' || !isGitHubHost(url.hostname) || url.username || url.password ||
        (url.port && url.port !== '443')) return this.deps.nativeFetch(request);
    // Existing SteamTools, VPN and system proxy configuration takes priority.
    const choice = await this.deps.resolveProxy(url.href);
    if (!this.ownsProxyChoice(choice) && /(?:^|;)\s*(?:PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+/iu.test(choice)) return this.deps.nativeFetch(request);
    return (this.deps.originFetch ?? fetchGitHubOrigin)(request, this.agent);
  }

  async refresh(): Promise<GitHubProxyStatus> {
    this.cancel();
    if (!this.enabled) return this.status();
    const controller = new AbortController();
    this.checkJob = controller;
    this.state = 'checking'; this.error = null; this.checks = [];
    const timeout = setTimeout(() => controller.abort(), 24000);
    try {
      // Public routing metadata only. No GitHub tokens or user content are sent here.
      const rulesTimeout = AbortSignal.timeout(2500);
      try {
        const response = await this.deps.nativeFetch(new Request(RULES_URL, {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}',
          signal: AbortSignal.any([controller.signal, rulesTimeout]),
        }));
        if (response.ok) {
          const parsed = parseSteamGitHubRules(await readRoutingJson(response));
          if (this.checkJob === controller && !controller.signal.aborted && Object.keys(parsed).length) {
            const rules = { ...DEFAULT_GITHUB_RULES, ...parsed };
            this.agent.setRules(rules);
            this.rules = rules;
          }
        }
      } catch { /* The bundled routes remain usable when the rule service is unavailable. */ }
      if (this.checkJob !== controller || controller.signal.aborted) return this.status();
      const probes: { target: GitHubProxyStatus['checks'][number]['target']; request: Request; valid: (status: number) => boolean }[] = [
        { target: 'login', request: new Request('https://github.com/login/device/code', { method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'repo' }), signal: controller.signal }),
          valid: status => status >= 200 && status < 400 },
        { target: 'api', request: new Request('https://api.github.com/rate_limit', { signal: controller.signal }),
          valid: status => status === 200 || status === 403 || status === 429 },
        { target: 'download', request: new Request('https://raw.githubusercontent.com/BeyondDimension/SteamTools/develop/README.md',
          { method: 'HEAD', signal: controller.signal }), valid: status => status === 200 },
      ];
      await Promise.all(probes.map(async probe => {
        let ok = false;
        try {
          // The system route is tested exactly as a browser would use it, rather
          // than letting our app-only TLS route hide a browser connection failure.
          const response = await (this.systemState?.mode === 'managed' ? this.deps.nativeFetch(probe.request) : this.fetch(probe.request));
          ok = probe.valid(response.status); await response.body?.cancel();
        }
        catch { /* Return a natural connection result, never a transport exception. */ }
        if (this.checkJob === controller && !controller.signal.aborted) this.checks = [...this.checks, { target: probe.target, ok }];
      }));
      if (this.checkJob === controller) {
        this.state = !controller.signal.aborted && this.checks.length === 3 && this.checks.every(check => check.ok) ? 'ready' : 'error';
        this.error = this.state === 'error' ? '部分连接暂时不可用，请检查网络后重试。' : null;
        this.checkedAt = new Date().toISOString();
      }
    } finally {
      clearTimeout(timeout);
      if (this.checkJob === controller) this.checkJob = null;
    }
    return this.status();
  }

  cancel(): void {
    this.checkJob?.abort(); this.checkJob = null;
    if (this.state === 'checking') { this.state = 'off'; this.error = null; }
  }
  ownsProxyChoice(choice: string): boolean { return this.deps.systemRelay?.ownsProxyChoice(choice) ?? false; }
  destroy(): Promise<void> {
    if (this.destroyJob) return this.destroyJob;
    this.destroyed = true; this.cancel(); clearInterval(this.monitor);
    this.systemVersion++;
    this.destroyJob = this.operationTail.then(async () => {
      this.cancel(); clearInterval(this.monitor);
      try { await this.deps.systemProxy?.destroy(); }
      // The guardian retains the recovery lease if Windows cannot restore at exit.
      finally { await this.deps.systemRelay?.stop(); this.agent.destroy(); }
    });
    return this.destroyJob;
  }
}

let activeService: GitHubProxyService | undefined;
export function useGitHubProxy(service: GitHubProxyService): void { activeService = service; }
export function githubOriginAgent(): GitHubOriginAgent | undefined { return activeService?.isEnabled() ? activeService.agent : undefined; }
export function githubOriginRules(): Record<string, OriginRule> | undefined { return activeService?.isEnabled() ? activeService.originRules() : undefined; }
export function isEasyHubProxyChoice(choice: string): boolean { return activeService?.ownsProxyChoice(choice) ?? false; }
