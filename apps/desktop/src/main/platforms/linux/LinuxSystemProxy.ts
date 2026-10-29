import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { SystemProxyStatus } from '../../../shared/systemProxy';

const PROXY_ENV = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY'] as const;

export type DesktopProxyMode = 'none' | 'manual' | 'auto' | 'unknown';

export interface LinuxSystemProxyDependencies {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  /** Read-only desktop setting. Must not change the user's proxy. */
  readDesktopProxy?: () => Promise<DesktopProxyMode>;
}

/** True when the process already inherited a proxy. `direct` is not a proxy. */
export function hasEnvironmentProxy(env: NodeJS.ProcessEnv): boolean {
  return PROXY_ENV.some((key) => {
    const value = env[key]?.trim();
    return !!value && !/^direct$/iu.test(value);
  });
}

export function parseGnomeProxyMode(output: string): DesktopProxyMode {
  const value = output.trim().replace(/^'|'$/gu, '');
  return value === 'none' || value === 'manual' || value === 'auto' ? value : 'unknown';
}

/** Reuse an existing proxy. Never report `managed`: Linux does not write system settings. */
export function classifyLinuxProxy(environmentProxy: boolean, desktop: DesktopProxyMode): SystemProxyStatus {
  if (environmentProxy || desktop === 'manual' || desktop === 'auto') return { mode: 'existing' };
  return { mode: 'off' };
}

async function readGnomeProxyMode(): Promise<DesktopProxyMode> {
  const executable = '/usr/bin/gsettings';
  if (!existsSync(executable)) return 'unknown';
  return new Promise((resolve) => {
    const child = spawn(executable, ['get', 'org.gnome.system.proxy', 'mode'], {
      shell: false, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500,
    });
    let output = '';
    let settled = false;
    const finish = (mode: DesktopProxyMode): void => { if (!settled) { settled = true; resolve(mode); } };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; if (output.length > 64) finish('unknown'); });
    child.on('error', () => finish('unknown'));
    child.on('close', (code) => { finish(code === 0 ? parseGnomeProxyMode(output) : 'unknown'); });
  });
}

/**
 * Read-only Linux proxy adapter. Enabling GitHub access inside EasyHub must not
 * rewrite GNOME, KDE or environment proxy settings the way Windows and macOS can.
 */
export class LinuxSystemProxy {
  private readonly platform: NodeJS.Platform;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly readDesktopProxy: () => Promise<DesktopProxyMode>;

  constructor(deps: LinuxSystemProxyDependencies = {}) {
    this.platform = deps.platform ?? process.platform;
    this.environment = deps.environment ?? process.env;
    this.readDesktopProxy = deps.readDesktopProxy ?? readGnomeProxyMode;
  }

  private async current(): Promise<SystemProxyStatus> {
    if (this.platform !== 'linux') return { mode: 'unavailable', error: '系统代理读取目前仅在 Linux 上使用。' };
    try {
      return classifyLinuxProxy(hasEnvironmentProxy(this.environment), await this.readDesktopProxy());
    } catch {
      return hasEnvironmentProxy(this.environment) ? { mode: 'existing' } : { mode: 'off' };
    }
  }

  initialize(): Promise<SystemProxyStatus> { return this.current(); }
  acquire(_pacUrl: string): Promise<SystemProxyStatus> { return this.current(); }
  release(): Promise<SystemProxyStatus> { return this.current(); }
  status(): Promise<SystemProxyStatus> { return this.current(); }
  destroy(): Promise<SystemProxyStatus> { return this.current(); }
}
