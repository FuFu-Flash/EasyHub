import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export interface MacProxySnapshot {
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'unavailable';
  pacURL: string;
  socksPort: number;
  lastProbe?: string;
  error?: string;
  domains?: number;
}

type ProxyAgent = HttpsProxyAgent<string> | SocksProxyAgent;
const PAC_URL = 'http://127.0.0.1:8869/github.pac';
const SOCKS_PORT = 8868;
const githubRoots = ['github.com', 'githubusercontent.com', 'githubassets.com', 'github.dev', 'githubapp.com', 'github.io'];

export function isGitHubProxyURL(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return ['https:', 'http:'].includes(url.protocol) && githubRoots.some((root) => host === root || host.endsWith(`.${root}`));
  } catch { return false; }
}

/** Preserve PAC order: an earlier DIRECT result wins over a later proxy. */
export function proxyURLFromPAC(choices: string): string | undefined {
  for (const choice of choices.split(';')) {
    if (choice.trim().toUpperCase() === 'DIRECT') return undefined;
    const match = choice.trim().match(/^(PROXY|HTTPS|SOCKS5|SOCKS)\s+(\[[0-9a-f:]+\]|[A-Za-z0-9_.-]+):(\d{1,5})$/i);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const port = Number(match[3]);
    if (port < 1 || port > 65535) throw new Error('代理端口无效。');
    const protocol = /^SOCKS/i.test(match[1]) ? 'socks5h' : match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http';
    return `${protocol}://${match[2]}:${port}`;
  }
  return undefined;
}

/** SOCKS5h keeps GitHub hostname resolution inside the validated Swift resolver. */
export function proxyAgentForURL(proxy: string, destination: string): ProxyAgent | undefined {
  if (!isGitHubProxyURL(destination)) return undefined;
  const url = new URL(proxy);
  if (url.protocol === 'socks5h:' || url.protocol === 'socks5:') {
    url.protocol = 'socks5h:';
    return new SocksProxyAgent(url);
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return new HttpsProxyAgent(proxy);
  throw new Error('此代理类型不受支持。');
}

interface HelperMessage { id?: string; event?: string; ok?: boolean; result?: unknown; error?: string }
interface PendingRequest { resolve: (value: MacProxySnapshot) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

function parseSnapshot(value: unknown): MacProxySnapshot {
  if (typeof value !== 'object' || value === null) throw new Error('代理服务返回了无效状态。');
  const result = value as Record<string, unknown>;
  if (!['disconnected', 'connecting', 'connected', 'disconnecting', 'unavailable'].includes(String(result.status)) ||
      result.pacURL !== PAC_URL || result.socksPort !== SOCKS_PORT ||
      (result.error !== undefined && typeof result.error !== 'string') ||
      (result.lastProbe !== undefined && typeof result.lastProbe !== 'string') ||
      (result.domains !== undefined && (!Number.isSafeInteger(result.domains) || Number(result.domains) < 0))) {
    throw new Error('代理服务返回了无效状态。');
  }
  return { status: result.status as MacProxySnapshot['status'], pacURL: PAC_URL, socksPort: SOCKS_PORT,
    ...(typeof result.error === 'string' ? { error: result.error } : {}),
    ...(typeof result.lastProbe === 'string' ? { lastProbe: result.lastProbe } : {}),
    ...(typeof result.domains === 'number' ? { domains: result.domains } : {}) };
}

export class MacProxyService {
  onChange?: (snapshot: MacProxySnapshot) => void;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly helperPath: string;
  private current: MacProxySnapshot = { status: process.platform === 'darwin' ? 'disconnected' : 'unavailable', pacURL: PAC_URL, socksPort: SOCKS_PORT };
  private readonly pending = new Map<string, PendingRequest>();
  private stdout = '';
  private stderr = '';
  private startup: Promise<void> | null = null;
  private closing = false;

  constructor(resourcesPath: string) { this.helperPath = join(resourcesPath, 'easyhub-proxy-helper'); }

  async status(): Promise<MacProxySnapshot> {
    if (this.child && !this.closing) return this.request('status', 5000);
    if (process.platform === 'darwin' && !this.closing) {
      try {
        await access(this.helperPath, constants.X_OK);
        if (this.current.status === 'unavailable') this.publish({ status: 'disconnected', pacURL: PAC_URL, socksPort: SOCKS_PORT });
      }
      catch { this.publish({ ...this.current, status: 'unavailable', error: 'Mac GitHub 代理组件未安装或不可执行。' }); }
    }
    return { ...this.current };
  }

  async setEnabled(enabled: boolean): Promise<MacProxySnapshot> {
    if (typeof enabled !== 'boolean') throw new Error('代理开关无效。');
    if (!enabled && !this.child) return this.status();
    await this.ensureStarted();
    return this.request(enabled ? 'start' : 'stop', enabled ? 180000 : 10000);
  }

  async probe(): Promise<MacProxySnapshot> {
    if (!this.child || this.current.status !== 'connected') throw new Error('请先开启 GitHub 代理再测试连接。');
    return this.request('probe', 25000);
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    await this.startup?.catch(() => undefined);
    const child = this.child;
    if (!child) return;
    try { await this.request('shutdown', 5000); }
    catch { /* EOF and termination below still release both listeners. */ }
    child.stdin.end();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const graceful = setTimeout(() => child.kill('SIGTERM'), 1500);
      const forced = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3500);
      child.once('exit', () => { clearTimeout(graceful); clearTimeout(forced); resolve(); });
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.closing) throw new Error('EasyHub 正在退出。');
    if (process.platform !== 'darwin') throw new Error('本地 SteamTools 代理组件仅适用于 macOS。');
    if (this.startup) return this.startup;
    if (this.child) return;
    const operation = (async () => {
      try { await access(this.helperPath, constants.X_OK); }
      catch { this.publish({ ...this.current, status: 'unavailable', error: 'Mac GitHub 代理组件未安装或不可执行。' }); throw new Error(this.current.error); }
      if (this.closing) throw new Error('EasyHub 正在退出。');
      const child = spawn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      this.child = child; this.stdout = ''; this.stderr = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.receive(child, chunk));
      child.stderr.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-2048); });
      child.stdin.on('error', () => this.failed(child, new Error('代理控制通道已关闭。')));
      child.on('error', (error) => this.failed(child, error));
      child.on('exit', (code, signal) => this.failed(child, new Error(this.closing ? '代理服务已停止。' : `代理服务意外退出（${signal ?? code ?? 'unknown'}）。`)));
      await this.request('status', 10000);
    })();
    this.startup = operation;
    try { await operation; }
    finally { if (this.startup === operation) this.startup = null; }
  }

  private request(method: string, timeout: number): Promise<MacProxySnapshot> {
    const child = this.child;
    if (!child || child.stdin.destroyed) return Promise.reject(new Error('代理控制通道不可用。'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('代理操作等待时间过长，请重试。'));
        this.failed(child, new Error('代理操作等待时间过长，请重试。'));
        child.stdin.end(); child.kill('SIGTERM');
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method })}\n`, (error) => { if (error) this.failed(child, error); });
    });
  }

  private receive(child: ChildProcessWithoutNullStreams, chunk: string): void {
    if (this.child !== child) return;
    this.stdout += chunk;
    if (this.stdout.length > 65536) { this.failed(child, new Error('代理控制消息过大。')); child.kill('SIGTERM'); return; }
    let boundary: number;
    while ((boundary = this.stdout.indexOf('\n')) >= 0) {
      const line = this.stdout.slice(0, boundary); this.stdout = this.stdout.slice(boundary + 1);
      if (!line) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid control response');
        const message = value as HelperMessage;
        if (message.result !== undefined) this.publish(parseSnapshot(message.result));
        if (message.id) {
          const request = this.pending.get(message.id);
          if (!request) continue;
          clearTimeout(request.timer); this.pending.delete(message.id);
          if (message.ok === true && message.result !== undefined) request.resolve({ ...this.current });
          else request.reject(new Error(typeof message.error === 'string' ? message.error : '代理操作失败。'));
        }
      } catch { this.failed(child, new Error('代理控制消息无效。')); child.kill('SIGTERM'); return; }
    }
  }

  private publish(snapshot: MacProxySnapshot): void {
    const previous = this.current;
    const changed = previous.status !== snapshot.status || previous.pacURL !== snapshot.pacURL ||
      previous.socksPort !== snapshot.socksPort || previous.lastProbe !== snapshot.lastProbe ||
      previous.error !== snapshot.error || previous.domains !== snapshot.domains;
    this.current = snapshot;
    if (changed) this.onChange?.({ ...snapshot });
  }

  private failed(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return;
    this.child = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.publish({ status: 'disconnected', pacURL: PAC_URL, socksPort: SOCKS_PORT, ...(this.closing ? {} : { error: error.message }) });
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end(); child.kill('SIGTERM');
      const forced = setTimeout(() => child.kill('SIGKILL'), 3000);
      forced.unref();
      child.once('exit', () => clearTimeout(forced));
    }
  }
}
