import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Current user's default/LAN WinINet connection. Disabled values are saved too. */
export interface WindowsProxySettings {
  flags: number;
  proxyServer: string;
  proxyBypass: string;
  autoConfigUrl: string;
}

export interface WindowsSystemProxyStatus {
  mode: 'off' | 'managed' | 'existing' | 'external' | 'unavailable';
  error?: string;
}

export interface WindowsSystemProxyAdapter {
  read(): Promise<WindowsProxySettings>;
  /** Discover DHCP/DNS WPAD without downloading or exposing its URL. Uncertainty rejects. */
  detectAutomaticProxy?(): Promise<boolean>;
  /** Recheck in the native process immediately before writing. False means another app changed it. */
  compareAndSet(expected: WindowsProxySettings, replacement: WindowsProxySettings): Promise<boolean>;
  /** Hidden helper restores the saved lease if the Electron process exits unexpectedly. */
  armRecovery?(leasePath: string): Promise<void>;
}

export interface WindowsProxyLease {
  version: 1;
  previous: WindowsProxySettings;
  applied: WindowsProxySettings;
}

export interface WindowsProxyLeaseStore {
  load(): Promise<unknown | null>;
  save(lease: WindowsProxyLease): Promise<void>;
  remove(): Promise<void>;
}

export interface WindowsSystemProxyDependencies {
  adapter?: WindowsSystemProxyAdapter;
  store?: WindowsProxyLeaseStore;
  scriptPath?: string;
  platform?: NodeJS.Platform;
  /** Resolve the original OS configuration, without the EasyHub PAC override. */
  resolveExistingProxy?: (url: string) => Promise<string>;
}

const DIRECT = 1;
const MANUAL = 2;
const PAC = 4;
const AUTO_DETECT = 8;
const DETECTION_URLS = ['https://github.com/', 'https://api.github.com/', 'https://raw.githubusercontent.com/'];

function equalSettings(left: WindowsProxySettings, right: WindowsProxySettings): boolean {
  return left.flags === right.flags && left.proxyServer === right.proxyServer &&
    left.proxyBypass === right.proxyBypass && left.autoConfigUrl === right.autoConfigUrl;
}

function validSettings(value: unknown): value is WindowsProxySettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<WindowsProxySettings>;
  return Number.isSafeInteger(settings.flags) && settings.flags! >= 0 && settings.flags! <= 0xffffffff &&
    [settings.proxyServer, settings.proxyBypass, settings.autoConfigUrl]
      .every(item => typeof item === 'string' && item.length <= 32768 && !item.includes('\0'));
}

function validPacUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port &&
      Number(url.port) > 0 && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

function validLease(value: unknown): value is WindowsProxyLease {
  if (!value || typeof value !== 'object') return false;
  const lease = value as Partial<WindowsProxyLease>;
  return lease.version === 1 && validSettings(lease.previous) && validSettings(lease.applied) &&
    validPacUrl(lease.applied.autoConfigUrl) && !!(lease.applied.flags & PAC) &&
    lease.applied.proxyServer === lease.previous.proxyServer && lease.applied.proxyBypass === lease.previous.proxyBypass;
}

export function createWindowsProxyLeaseStore(path: string): WindowsProxyLeaseStore {
  return {
    async load() {
      try { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(lease) {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(lease), { mode: 0o600 });
      await rename(temporary, path);
    },
    async remove() { await rm(path, { force: true }); },
  };
}

/** Only fixed commands and JSON go to the shipped helper; no shell or renderer command text. */
export function createWindowsSystemProxyAdapter(scriptPath: string): WindowsSystemProxyAdapter {
  async function invoke(request: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      let failed = false;
      const fail = (): void => { if (!failed) { failed = true; child.kill(); reject(new Error('无法更新系统代理设置。')); } };
      const timeout = setTimeout(fail, 15000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { output += chunk; if (output.length > 65536) fail(); });
      child.stderr.resume();
      child.on('error', fail);
      child.stdin.on('error', fail);
      child.on('close', code => {
        clearTimeout(timeout);
        if (failed) return;
        if (code !== 0) { fail(); return; }
        try { resolve(JSON.parse(output.trim()) as unknown); } catch { fail(); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
  return {
    async read() {
      const settings = await invoke({ operation: 'read' });
      if (!validSettings(settings)) throw new Error('系统代理设置无效。');
      return settings;
    },
    async detectAutomaticProxy() {
      const result = await invoke({ operation: 'detectAutomaticProxy' });
      if (!result || typeof result !== 'object' || !('detected' in result) || typeof result.detected !== 'boolean') {
        throw new Error('无法确认自动代理配置。');
      }
      return result.detected;
    },
    async compareAndSet(expected, replacement) {
      if (!validSettings(expected) || !validSettings(replacement)) throw new Error('系统代理设置无效。');
      const result = await invoke({ operation: 'compareAndSet', expected, replacement });
      if (!result || typeof result !== 'object' || !('changed' in result) || typeof result.changed !== 'boolean') {
        throw new Error('无法确认系统代理设置。');
      }
      return result.changed;
    },
    async armRecovery(leasePath) {
      // Bind this guardian to the exact lease bytes present before spawning. An
      // older process must never restore a lease created by the next instance.
      const expectedLeaseHash = createHash('sha256').update(await readFile(leasePath)).digest('hex');
      await new Promise<void>((resolve, reject) => {
        const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
          { windowsHide: true, detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
        let output = '';
        let settled = false;
        const timeout = setTimeout(fail, 15000);
        function fail(): void {
          if (settled) return;
          settled = true; clearTimeout(timeout); child.kill(); reject(new Error('无法启动系统代理恢复。'));
        }
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          output += chunk;
          if (output.length > 1024) { fail(); return; }
          if (output.includes('ready')) {
            settled = true; clearTimeout(timeout); child.stdout.destroy(); child.unref(); resolve();
          }
        });
        child.on('error', fail);
        child.on('exit', () => { if (!settled) fail(); });
        child.stdin.on('error', fail);
        child.stdin.end(JSON.stringify({ operation: 'watch', leasePath, ownerPid: process.pid, expectedLeaseHash }));
      });
    },
  };
}

/** Own a temporary PAC only while all four settings still match the saved lease. */
export class WindowsSystemProxy {
  private readonly adapter: WindowsSystemProxyAdapter;
  private readonly store: WindowsProxyLeaseStore;
  private readonly platform: NodeJS.Platform;
  private state: WindowsSystemProxyStatus = { mode: 'off' };
  private lease: WindowsProxyLease | null = null;
  private ready = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly leasePath: string, private readonly deps: WindowsSystemProxyDependencies = {}) {
    this.adapter = deps.adapter ?? createWindowsSystemProxyAdapter(deps.scriptPath ?? join(__dirname, '../../resources/windows-system-proxy.ps1'));
    this.store = deps.store ?? createWindowsProxyLeaseStore(leasePath);
    this.platform = deps.platform ?? process.platform;
  }

  private serial(work: () => Promise<WindowsSystemProxyStatus>): Promise<WindowsSystemProxyStatus> {
    const operation = this.queue.then(work, work);
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private result(): WindowsSystemProxyStatus { return { ...this.state }; }

  private async initializeInternal(): Promise<void> {
    if (this.ready) return;
    if (this.platform !== 'win32') {
      this.state = { mode: 'unavailable', error: '系统代理目前仅支持 Windows。' };
      return;
    }
    try {
      const saved = await this.store.load();
      if (saved !== null) {
        if (!validLease(saved)) throw new Error('Invalid saved proxy lease');
        this.lease = saved;
        await this.restoreLease();
      }
      this.ready = true;
    } catch {
      this.state = { mode: 'unavailable', error: '无法恢复之前的系统代理设置，请稍后重试。' };
    }
  }

  initialize(): Promise<WindowsSystemProxyStatus> {
    return this.serial(async () => { await this.initializeInternal(); return this.result(); });
  }

  private async discardLease(): Promise<void> {
    await this.store.remove();
    this.lease = null;
  }

  private async restoreLease(): Promise<void> {
    if (!this.lease) { this.state = { mode: 'off' }; return; }
    const lease = this.lease;
    const current = await this.adapter.read();
    if (!equalSettings(current, lease.applied)) {
      await this.clearOwnedPac(current, lease);
      await this.discardLease();
      this.state = { mode: equalSettings(current, lease.previous) ? 'off' : 'external' };
      return;
    }
    const restored = await this.adapter.compareAndSet(lease.applied, lease.previous);
    // If a foreign manual proxy won the comparison but retained our PAC, remove
    // just that field using a fresh comparison rather than restoring the old server.
    if (!restored) await this.clearOwnedPac(await this.adapter.read(), lease);
    await this.discardLease();
    this.state = { mode: restored ? 'off' : 'external' };
  }

  private async clearOwnedPac(current: WindowsProxySettings, lease: WindowsProxyLease): Promise<void> {
    if (current.autoConfigUrl !== lease.applied.autoConfigUrl) return;
    // Other proxies sometimes leave our PAC URL in place while enabling their server.
    // Remove only our PAC field and flag, preserving all of their other settings.
    const cleaned = await this.adapter.compareAndSet(current, { ...current, autoConfigUrl: lease.previous.autoConfigUrl,
      flags: (current.flags & ~PAC) | (lease.previous.flags & PAC) });
    if (!cleaned && (await this.adapter.read()).autoConfigUrl === lease.applied.autoConfigUrl) {
      // Keep the saved lease so a later poll or process guardian can retry safely.
      throw new Error('Proxy ownership changed while removing the PAC');
    }
  }

  private async existingProxy(current: WindowsProxySettings, supplied?: boolean): Promise<boolean> {
    if ((current.flags & MANUAL) && current.proxyServer.trim()) return true;
    if ((current.flags & PAC) && current.autoConfigUrl.trim()) return true;
    if (!(current.flags & AUTO_DETECT)) return false;
    if (supplied === true) return true;
    if (this.adapter.detectAutomaticProxy) return this.adapter.detectAutomaticProxy();
    if (!this.deps.resolveExistingProxy) throw new Error('No automatic proxy resolver');
    const choices = await Promise.all(DETECTION_URLS.map(url => this.deps.resolveExistingProxy!(url)));
    if (choices.some(choice => /(?:^|;)\s*(?:PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+/iu.test(choice))) return true;
    // A corporate PAC can use DIRECT for GitHub and a proxy for other websites.
    // GitHub-only resolution cannot prove that no WPAD configuration exists.
    throw new Error('Automatic proxy discovery could not be confirmed');
  }

  acquire(pacUrl: string, existingEffectiveProxy?: boolean): Promise<WindowsSystemProxyStatus> {
    return this.serial(async () => {
      await this.initializeInternal();
      if (!this.ready) return this.result();
      if (!validPacUrl(pacUrl)) {
        this.state = { mode: 'unavailable', error: '本地系统代理地址无效。' };
        return this.result();
      }
      try {
        const current = await this.adapter.read();
        if (this.lease) {
          if (!equalSettings(current, this.lease.applied)) {
            await this.clearOwnedPac(current, this.lease);
            await this.discardLease(); this.state = { mode: 'external' }; return this.result();
          }
          if (this.lease.applied.autoConfigUrl === pacUrl) {
            this.state = { mode: 'managed' }; return this.result();
          }
          await this.restoreLease();
          if (this.state.mode !== 'off') return this.result();
        }
        const previous = await this.adapter.read();
        if (await this.existingProxy(previous, existingEffectiveProxy)) {
          this.state = { mode: 'existing' }; return this.result();
        }
        const applied: WindowsProxySettings = { ...previous,
          flags: (previous.flags & ~(MANUAL | AUTO_DETECT)) | DIRECT | PAC, autoConfigUrl: pacUrl };
        const lease: WindowsProxyLease = { version: 1, previous, applied };
        // Save before native mutation so a crash can always undo our settings.
        await this.store.save(lease);
        this.lease = lease;
        await this.adapter.armRecovery?.(this.leasePath);
        if (!await this.adapter.compareAndSet(previous, applied)) {
          await this.discardLease(); this.state = { mode: 'external' }; return this.result();
        }
        if (!equalSettings(await this.adapter.read(), applied)) {
          await this.clearOwnedPac(await this.adapter.read(), lease);
          await this.discardLease(); this.state = { mode: 'external' }; return this.result();
        }
        this.state = { mode: 'managed' };
      } catch {
        if (this.lease) {
          try { await this.restoreLease(); } catch { /* Retain the lease for shutdown or the next start. */ }
        }
        this.state = { mode: 'unavailable', error: '系统代理启用失败，请稍后重试。' };
      }
      return this.result();
    });
  }

  status(): Promise<WindowsSystemProxyStatus> {
    return this.serial(async () => {
      await this.initializeInternal();
      if (this.ready && this.lease) {
        try {
          if (!equalSettings(await this.adapter.read(), this.lease.applied)) {
            await this.clearOwnedPac(await this.adapter.read(), this.lease);
            await this.discardLease(); this.state = { mode: 'external' };
          } else this.state = { mode: 'managed' };
        } catch { this.state = { mode: 'unavailable', error: '无法检查系统代理状态。' }; }
      }
      return this.result();
    });
  }

  release(): Promise<WindowsSystemProxyStatus> {
    return this.serial(async () => {
      await this.initializeInternal();
      if (!this.ready) return this.result();
      try { await this.restoreLease(); }
      catch { this.state = { mode: 'unavailable', error: '系统代理恢复失败，请稍后重试。' }; }
      return this.result();
    });
  }

  destroy(): Promise<WindowsSystemProxyStatus> { return this.release(); }
}
