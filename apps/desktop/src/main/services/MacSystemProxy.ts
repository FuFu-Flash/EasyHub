import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { WindowsSystemProxyStatus } from './WindowsSystemProxy';

interface ManualProxy { enabled: boolean; server: string; port: number; authenticated: boolean }
export interface MacProxySettings {
  service: string;
  automatic: { enabled: boolean; url: string };
  discovery: boolean;
  web: ManualProxy;
  secureWeb: ManualProxy;
  socks: ManualProxy;
  bypass: string[];
}
export interface MacProxyRestoreTransition { service: string; before: MacProxySettings; intermediate: MacProxySettings; target: MacProxySettings }
export interface MacProxyLease {
  version: 1; previous: MacProxySettings[]; applied: MacProxySettings[];
  /** networksetup enables a PAC when changing its URL. Own this exact intermediate state too. */
  restoring?: MacProxyRestoreTransition[];
}
export interface MacSystemProxyAdapter {
  read(): Promise<MacProxySettings[]>;
  /** Read a formerly active service even if another app disabled it. Null means removed. */
  readOwned?(service: string): Promise<MacProxySettings | null>;
  /** Only the PAC URL/state may change; compare every proxy field immediately before each write. */
  compareAndSet(expected: MacProxySettings, replacement: MacProxySettings, progress?: { started?: boolean }): Promise<boolean>;
  armRecovery?(leasePath: string): Promise<void>;
}
export interface MacProxyLeaseStore {
  load(): Promise<unknown | null>;
  save(lease: MacProxyLease): Promise<void>;
  remove(): Promise<void>;
}
export interface MacSystemProxyDependencies {
  adapter?: MacSystemProxyAdapter;
  store?: MacProxyLeaseStore;
  platform?: NodeJS.Platform;
  resolveExistingProxy?: (url: string) => Promise<string>;
}
type NetworksetupExecutor = (args: string[]) => Promise<string>;
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** Self-contained so the same adapter can also run in the detached crash guardian. */
export function createMacSystemProxyAdapter(execute?: NetworksetupExecutor): MacSystemProxyAdapter {
  const run = execute ?? ((args: string[]) => new Promise<string>((resolve, reject) => {
    const { execFile } = require('node:child_process') as typeof import('node:child_process');
    execFile('/usr/sbin/networksetup', args, { timeout: 10000, maxBuffer: 256 * 1024,
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }, (error, stdout) => {
      // networksetup sometimes reports an error with exit status zero.
      if (error || /(?:Error:|requires admin|not a recognized network service|not authorized)/iu.test(stdout)) {
        reject(new Error('Unable to access macOS network proxy configuration.'));
      } else resolve(stdout);
    });
  }));
  const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
  const fields = (output: string): Record<string, string> => Object.fromEntries(output.trim().split(/\r?\n/u).map(line => {
    const colon = line.indexOf(':'); return colon < 0 ? ['', ''] : [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }));
  const enabled = (value: string | undefined): boolean => {
    if (value === 'Yes' || value === 'On' || value === '1') return true;
    if (value === 'No' || value === 'Off' || value === '0') return false;
    throw new Error('Unrecognized macOS proxy state.');
  };
  const manual = (output: string): ManualProxy => {
    const values = fields(output); const port = Number(values.Port);
    if (!Number.isInteger(port) || port < 0 || port > 65535 || values.Server === undefined) throw new Error('Invalid macOS proxy address.');
    return { enabled: enabled(values.Enabled), server: values.Server, port,
      authenticated: enabled(values['Authenticated Proxy Enabled']) };
  };
  const readService = async (service: string): Promise<MacProxySettings> => {
    const [pac, discovery, web, secureWeb, socks, bypass] = await Promise.all([
      run(['-getautoproxyurl', service]), run(['-getproxyautodiscovery', service]),
      run(['-getwebproxy', service]), run(['-getsecurewebproxy', service]), run(['-getsocksfirewallproxy', service]),
      run(['-getproxybypassdomains', service]),
    ]);
    const automatic = fields(pac); const autoDiscovery = fields(discovery);
    if (automatic.URL === undefined) throw new Error('Missing macOS PAC address.');
    return { service, automatic: { enabled: enabled(automatic.Enabled), url: automatic.URL === '(null)' ? '' : automatic.URL },
      discovery: enabled(autoDiscovery['Auto Proxy Discovery']), web: manual(web), secureWeb: manual(secureWeb), socks: manual(socks),
      bypass: /^There aren't any bypass domains/iu.test(bypass.trim()) ? [] : bypass.trim().split(/\r?\n/u).filter(Boolean) };
  };
  return {
    async read() {
      const output = await run(['-listallnetworkservices']);
      const services = output.trim().split(/\r?\n/u).slice(1).filter(name => name && !name.startsWith('*'));
      if (!services.length || services.some(name => name.includes('\0') || name.includes('\n'))) throw new Error('No available macOS network service.');
      return Promise.all(services.map(readService));
    },
    async readOwned(service) {
      const output = await run(['-listallnetworkservices']);
      const services = output.trim().split(/\r?\n/u).slice(1).map(name => name.replace(/^\*/u, ''));
      return services.includes(service) ? readService(service) : null;
    },
    async compareAndSet(expected, replacement, progress) {
      if (progress) progress.started = false;
      if (expected.service !== replacement.service || !same({ ...expected, automatic: replacement.automatic }, replacement)) {
        throw new Error('Only PAC settings may be changed.');
      }
      let current = await readService(expected.service);
      if (!same(current, expected)) return false;
      if (current.automatic.url !== replacement.automatic.url) {
        if (progress) progress.started = true;
        await run(['-setautoproxyurl', expected.service, replacement.automatic.url || '']);
        const intermediate = { ...expected, automatic: { ...expected.automatic, url: replacement.automatic.url } };
        current = await readService(expected.service);
        // Setting the URL can also turn PAC on. This intermediate state is still owned
        // by us; every other field must match before touching the enabled flag.
        if (current.automatic.url !== replacement.automatic.url || !same({ ...current, automatic: intermediate.automatic }, intermediate)) return false;
      }
      if (current.automatic.enabled !== replacement.automatic.enabled) {
        const checked = await readService(expected.service);
        if (!same(checked, current)) return false;
        if (progress) progress.started = true;
        await run(['-setautoproxystate', expected.service, replacement.automatic.enabled ? 'on' : 'off']);
      }
      return same(await readService(expected.service), replacement);
    },
  };
}

function validSettings(value: unknown): value is MacProxySettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as MacProxySettings;
  const text = (value_: unknown): value_ is string => typeof value_ === 'string' && value_.length <= 32768 && !value_.includes('\0');
  const manual = (proxy: ManualProxy): boolean => !!proxy && typeof proxy.enabled === 'boolean' && text(proxy.server) &&
    Number.isInteger(proxy.port) && proxy.port >= 0 && proxy.port <= 65535 && typeof proxy.authenticated === 'boolean';
  return text(settings.service) && !!settings.service && !!settings.automatic && typeof settings.automatic.enabled === 'boolean' &&
    text(settings.automatic.url) && typeof settings.discovery === 'boolean' && manual(settings.web) && manual(settings.secureWeb) &&
    manual(settings.socks) && Array.isArray(settings.bypass) && settings.bypass.every(text);
}
function validPacUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port &&
    Number(url.port) > 0 && !url.username && !url.password && !url.hash; } catch { return false; }
}
function validLease(value: unknown): value is MacProxyLease {
  if (!value || typeof value !== 'object') return false;
  const lease = value as MacProxyLease;
  return lease.version === 1 && Array.isArray(lease.previous) && lease.previous.length > 0 &&
    Array.isArray(lease.applied) && lease.previous.length === lease.applied.length &&
    new Set(lease.previous.map(item => item.service)).size === lease.previous.length &&
    lease.previous.every((previous, index) => {
      const applied = lease.applied[index];
      return validSettings(previous) && validSettings(applied) && applied.automatic.enabled && validPacUrl(applied.automatic.url) &&
        equal({ ...previous, automatic: applied.automatic }, applied);
    }) && (lease.restoring === undefined || (Array.isArray(lease.restoring) && lease.restoring.length <= lease.applied.length &&
      new Set(lease.restoring.map(item => item?.service)).size === lease.restoring.length && lease.restoring.every(transition => {
        if (!transition || !validSettings(transition.before) || !validSettings(transition.intermediate) || !validSettings(transition.target)) return false;
        const index = lease.applied.findIndex(item => item.service === transition.service); if (index < 0) return false;
        const previous = lease.previous[index]!; const applied = lease.applied[index]!;
        return transition.before.service === transition.service && transition.before.automatic.url === applied.automatic.url &&
          equal(transition.intermediate, { ...transition.before, automatic: { enabled: true, url: previous.automatic.url } }) &&
          equal(transition.target, { ...transition.before, automatic: previous.automatic });
      })));
}

/** Cross-process coordination for the parent and its hash-bound crash guardian. */
async function withMacLeaseLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const fs = require('node:fs/promises') as typeof import('node:fs/promises');
  const pathModule = require('node:path') as typeof import('node:path');
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
  await fs.mkdir(pathModule.dirname(path), { recursive: true });
  const lockPath = `${path}.lock`; const ownerPath = pathModule.join(lockPath, 'owner.json');
  const deadline = Date.now() + 10000;
  while (true) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      await fs.writeFile(ownerPath, JSON.stringify({ format: 'EasyHub system proxy lease lock', pid: process.pid }), { mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const bytes = await fs.readFile(ownerPath, 'utf8'); const owner = JSON.parse(bytes) as { format?: string; pid?: number };
        if (owner.format !== 'EasyHub system proxy lease lock' || !Number.isSafeInteger(owner.pid) || !owner.pid || owner.pid < 1) throw new Error('Invalid proxy lease lock.');
        try { process.kill(owner.pid, 0); } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === 'ESRCH' && await fs.readFile(ownerPath, 'utf8') === bytes) {
            // Rename the entire stale lock atomically so cleanup cannot remove a
            // newly created lock at the original path.
            const stale = `${lockPath}.stale-${randomUUID()}`;
            await fs.rename(lockPath, stale); await fs.rm(pathModule.join(stale, 'owner.json'), { force: true }); await fs.rmdir(stale); continue;
          }
        }
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
        // A killed process may have created the directory but not its owner file.
        // Give a live creator time to finish before reclaiming an empty old lock.
        try { if (Date.now() - (await fs.stat(lockPath)).mtimeMs > 10000) {
          const stale = `${lockPath}.stale-${randomUUID()}`; await fs.rename(lockPath, stale);
          await fs.rm(pathModule.join(stale, 'owner.json'), { force: true }); await fs.rmdir(stale); continue;
        } } catch (missing) { if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing; }
      }
      if (Date.now() >= deadline) throw new Error('Proxy lease is busy.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try { return await work(); } finally { await fs.rm(ownerPath, { force: true }); await fs.rmdir(lockPath); }
}
export function createMacProxyLeaseStore(path: string): MacProxyLeaseStore {
  return {
    load: () => withMacLeaseLock(path, async () => { try { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }),
    save: lease => withMacLeaseLock(path, async () => { const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(lease), { mode: 0o600 }); await rename(temporary, path); }),
    remove: () => withMacLeaseLock(path, () => rm(path, { force: true })),
  };
}

export function macProxyRecoverySource(leasePath: string, hash: string, ownerPid: number): string {
  return `const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const createAdapter = ${createMacSystemProxyAdapter.toString()};
const withLeaseLock = ${withMacLeaseLock.toString()};
const adapter = createAdapter();
const leasePath = ${JSON.stringify(leasePath)};
let hash = ${JSON.stringify(hash)};
const ownerPid = ${ownerPid};
let restoring = false;
const attempted = new Map();
async function saveLease(lease) {
  await withLeaseLock(leasePath, async () => {
    const latest = await fs.readFile(leasePath);
    if (crypto.createHash('sha256').update(latest).digest('hex') !== hash) process.exit(0);
    const replacement = JSON.stringify(lease); const temporary = leasePath + '.tmp';
    await fs.writeFile(temporary, replacement, {mode:0o600}); await fs.rename(temporary, leasePath);
    hash = crypto.createHash('sha256').update(replacement).digest('hex');
  });
}
async function tick() {
  if (restoring) return;
  let bytes; try { bytes = await fs.readFile(leasePath); } catch { process.exit(0); }
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash) process.exit(0);
  try { process.kill(ownerPid, 0); return; } catch (error) { if (error.code !== 'ESRCH') return; }
  restoring = true;
  try {
    const lease = JSON.parse(bytes);
    for (let index = 0; index < lease.applied.length; index++) {
      const own = lease.applied[index];
      const current = adapter.readOwned ? await adapter.readOwned(own.service) : (await adapter.read()).find(item => item.service === own.service);
      if (!current) continue;
      const transition = attempted.get(own.service) || (lease.restoring || []).find(item => item.service === own.service);
      const exactIntermediate = transition && JSON.stringify(current) === JSON.stringify(transition.intermediate);
      if (current.automatic.url !== own.automatic.url && !exactIntermediate) {
        if (transition && JSON.stringify(current.automatic) === JSON.stringify(transition.intermediate.automatic)) throw new Error('Uncertain partial restoration ownership');
        continue;
      }
      const target = {...current, automatic: lease.previous[index].automatic};
      const next = {service:own.service, before:current, target, intermediate:{...current, automatic:{enabled:true,url:target.automatic.url}}};
      const priorTransitions = lease.restoring;
      let recorded = false;
      if (!exactIntermediate && current.automatic.url !== target.automatic.url) {
        lease.restoring = [...(lease.restoring || []).filter(item=>item.service!==own.service), next];
        await saveLease(lease); recorded = true;
      }
      attempted.set(own.service, next);
      const progress = {};
      let changed = false;
      try { changed = await adapter.compareAndSet(current, target, progress); }
      finally {
        if (!changed && recorded && progress.started === false) {
          lease.restoring = priorTransitions; attempted.delete(own.service); await saveLease(lease);
        }
      }
      if (!changed) throw new Error('Ownership changed');
    }
    await withLeaseLock(leasePath, async () => {
      const latest = await fs.readFile(leasePath);
      if (crypto.createHash('sha256').update(latest).digest('hex') === hash) await fs.unlink(leasePath);
    });
    process.exit(0);
  } catch { restoring = false; }
}
process.stdout.write('ready\\n');
setInterval(() => { void tick(); }, 1000);
`;
}

async function armMacRecovery(leasePath: string): Promise<void> {
  const hash = createHash('sha256').update(await readFile(leasePath)).digest('hex');
  const recoveryPath = `${leasePath}.recovery.cjs`;
  // The guardian uses the shipped Electron runtime. No system Python/Node install,
  // shell text, administrator password, or active user account is required.
  const source = macProxyRecoverySource(leasePath, hash, process.pid);
  await writeFile(recoveryPath, source, { mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [recoveryPath], { detached: true, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    let settled = false;
    const fail = (): void => { if (settled) return; settled = true; clearTimeout(timeout); child.kill(); reject(new Error('Unable to start macOS proxy recovery.')); };
    const timeout = setTimeout(fail, 15000);
    child.on('error', fail); child.on('exit', fail);
    child.stdout.setEncoding('utf8');
    child.stdout.once('data', (data: string) => { if (!data.startsWith('ready')) return fail();
      settled = true; clearTimeout(timeout); child.stdout.destroy(); child.unref(); resolve(); });
  });
}

/** Own PAC settings per network service, while preserving every foreign proxy field. */
export class MacSystemProxy {
  private readonly adapter: MacSystemProxyAdapter;
  private readonly store: MacProxyLeaseStore;
  private readonly platform: NodeJS.Platform;
  private lease: MacProxyLease | null = null;
  private ready = false;
  private state: WindowsSystemProxyStatus = { mode: 'off' };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly leasePath: string, private readonly deps: MacSystemProxyDependencies = {}) {
    this.adapter = deps.adapter ?? { ...createMacSystemProxyAdapter(), armRecovery: armMacRecovery };
    this.store = deps.store ?? createMacProxyLeaseStore(leasePath);
    this.platform = deps.platform ?? process.platform;
  }
  private serial(work: () => Promise<void>): Promise<WindowsSystemProxyStatus> {
    const operation = this.queue.then(work, work).then(() => ({ ...this.state }));
    this.queue = operation.catch(() => undefined); return operation;
  }
  private async discard(): Promise<void> { await this.store.remove(); this.lease = null; }
  private async restore(): Promise<void> {
    if (!this.lease) { this.state = { mode: 'off' }; return; }
    const lease = this.lease; let external = false;
    for (let index = 0; index < lease.applied.length; index++) {
      const applied = lease.applied[index]!; const previous = lease.previous[index]!;
      const current = await this.readOwned(applied.service);
      if (!current) { external = true; continue; }
      const transition = lease.restoring?.find(item => item.service === applied.service);
      const intermediate = transition && equal(current, transition.intermediate);
      if (!equal(current, applied) && !intermediate) external ||= !equal(current, previous);
      if (intermediate && !equal({ ...current, automatic: applied.automatic }, applied)) external = true;
      // Another application owns the new PAC URL. Never overwrite it.
      if (current.automatic.url !== applied.automatic.url && !intermediate) {
        if (transition && equal(current.automatic, transition.intermediate.automatic)) throw new Error('Partial macOS PAC restoration ownership is uncertain.');
        continue;
      }
      // If manual settings changed, remove only our PAC and preserve their changes.
      const priorTransitions = lease.restoring; let recorded = false;
      if (!intermediate && current.automatic.url !== previous.automatic.url) {
        const next: MacProxyRestoreTransition = { service: applied.service, before: current,
          intermediate: { ...current, automatic: { enabled: true, url: previous.automatic.url } }, target: { ...current, automatic: previous.automatic } };
        if (!equal(next, transition)) {
          lease.restoring = [...(lease.restoring ?? []).filter(item => item.service !== applied.service), next];
          await this.store.save(lease); await this.adapter.armRecovery?.(this.leasePath);
          recorded = true;
        }
      }
      const progress: { started?: boolean } = {}; let changed = false;
      try { changed = await this.adapter.compareAndSet(current, { ...current, automatic: previous.automatic }, progress); }
      finally {
        // A failed initial comparison means no native setter was even attempted.
        // Withdraw only this invocation's new intent so a foreign old URL is not
        // mistaken for our half-restored PAC on the next status/shutdown call.
        if (!changed && recorded && progress.started === false) {
          lease.restoring = priorTransitions; await this.store.save(lease); await this.adapter.armRecovery?.(this.leasePath);
        }
      }
      if (!changed) {
        const latest = await this.readOwned(applied.service);
        const restoring = lease.restoring?.find(item => item.service === applied.service);
        if (latest?.automatic.url === applied.automatic.url || (restoring && latest && equal(latest.automatic, restoring.intermediate.automatic))) {
          throw new Error('macOS PAC ownership changed during restoration.');
        }
        external = true;
      }
    }
    await this.discard(); this.state = { mode: external ? 'external' : 'off' };
  }
  private async readOwned(service: string): Promise<MacProxySettings | null> {
    return this.adapter.readOwned ? this.adapter.readOwned(service) : (await this.adapter.read()).find(item => item.service === service) ?? null;
  }
  private async initializeInternal(): Promise<void> {
    if (this.ready) return;
    if (this.platform !== 'darwin') { this.state = { mode: 'unavailable', error: '系统代理目前仅支持 macOS。' }; return; }
    try { const saved = await this.store.load();
      if (saved !== null) { if (!validLease(saved)) throw new Error('Invalid macOS proxy lease.'); this.lease = saved; await this.restore(); }
      this.ready = true;
    } catch { this.state = { mode: 'unavailable', error: '无法恢复之前的系统代理设置，请稍后重试。' }; }
  }
  initialize(): Promise<WindowsSystemProxyStatus> { return this.serial(() => this.initializeInternal()); }
  acquire(pacUrl: string, existingEffectiveProxy?: boolean): Promise<WindowsSystemProxyStatus> {
    return this.serial(async () => {
      await this.initializeInternal(); if (!this.ready) return;
      if (!validPacUrl(pacUrl)) { this.state = { mode: 'unavailable', error: '本地系统代理地址无效。' }; return; }
      try {
        let previous = await this.adapter.read();
        if (this.lease) {
          if (!equal(previous, this.lease.applied)) { await this.restore(); this.state = { mode: 'external' }; return; }
          if (this.lease.applied.every(item => item.automatic.url === pacUrl)) { this.state = { mode: 'managed' }; return; }
          await this.restore(); if (this.state.mode !== 'off') return; previous = await this.adapter.read();
        }
        // Discovery can affect sites other than GitHub. Uncertainty preserves it.
        if (existingEffectiveProxy || previous.some(item => item.discovery || (item.automatic.enabled && !!item.automatic.url) ||
          [item.web, item.secureWeb, item.socks].some(proxy => proxy.enabled && !!proxy.server))) {
          this.state = { mode: 'existing' }; return;
        }
        if (this.deps.resolveExistingProxy) {
          const choices = await Promise.all(['https://github.com/', 'https://api.github.com/', 'https://raw.githubusercontent.com/']
            .map(url => this.deps.resolveExistingProxy!(url)));
          if (choices.some(choice => /(?:^|;)\s*(?:PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+/iu.test(choice))) {
            this.state = { mode: 'existing' }; return;
          }
          if (choices.some(choice => !/^\s*DIRECT\s*(?:;\s*DIRECT\s*)*$/iu.test(choice))) throw new Error('Unknown effective system proxy.');
        }
        const applied = previous.map(item => ({ ...item, automatic: { enabled: true, url: pacUrl } }));
        const lease: MacProxyLease = { version: 1, previous, applied };
        await this.store.save(lease); this.lease = lease;
        await this.adapter.armRecovery?.(this.leasePath);
        for (let index = 0; index < previous.length; index++) {
          if (!await this.adapter.compareAndSet(previous[index]!, applied[index]!)) {
            await this.restore(); this.state = { mode: 'external' }; return;
          }
        }
        if (!equal(await this.adapter.read(), applied)) { await this.restore(); this.state = { mode: 'external' }; return; }
        this.state = { mode: 'managed' };
      } catch {
        if (this.lease) { try { await this.restore(); } catch { /* Keep lease for shutdown, guardian, or next launch. */ } }
        this.state = { mode: 'unavailable', error: '系统代理启用失败，请检查 macOS 网络设置权限。' };
      }
    });
  }
  status(): Promise<WindowsSystemProxyStatus> {
    return this.serial(async () => { await this.initializeInternal(); if (!this.ready || !this.lease) return;
      try { if (!equal(await this.adapter.read(), this.lease.applied)) { await this.restore(); this.state = { mode: 'external' }; }
        else this.state = { mode: 'managed' }; }
      catch { this.state = { mode: 'unavailable', error: '无法检查系统代理状态。' }; }
    });
  }
  release(): Promise<WindowsSystemProxyStatus> {
    return this.serial(async () => { await this.initializeInternal(); if (!this.ready) return;
      try { await this.restore(); } catch { this.state = { mode: 'unavailable', error: '系统代理恢复失败，请稍后重试。' }; }
    });
  }
  destroy(): Promise<WindowsSystemProxyStatus> { return this.release(); }
}
