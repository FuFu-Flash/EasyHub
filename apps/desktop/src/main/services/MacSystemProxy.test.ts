import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createMacProxyLeaseStore, createMacSystemProxyAdapter, MacSystemProxy, macProxyRecoverySource } from './MacSystemProxy';
import type { MacProxyLease, MacProxySettings, MacSystemProxyDependencies } from './MacSystemProxy';

const PAC = 'http://127.0.0.1:45678/private-fixture.pac';
const clone = <T>(value: T): T => structuredClone(value);
function direct(service = 'Wi-Fi'): MacProxySettings {
  return { service, automatic: { enabled: false, url: 'https://old.example/disabled.pac' }, discovery: false,
    web: { enabled: false, server: 'old-web', port: 8080, authenticated: true },
    secureWeb: { enabled: false, server: 'old-https', port: 8443, authenticated: false },
    socks: { enabled: false, server: 'old-socks', port: 1080, authenticated: false }, bypass: ['*.local', '10.*'] };
}
function fixture(previous = [direct()], overrides: Partial<MacSystemProxyDependencies> = {}) {
  let current = clone(previous); let saved: unknown | null = null;
  const read = vi.fn(async () => clone(current));
  const compareAndSet = vi.fn(async (expected: MacProxySettings, replacement: MacProxySettings) => {
    const index = current.findIndex(item => item.service === expected.service);
    if (index < 0 || JSON.stringify(current[index]) !== JSON.stringify(expected)) return false;
    current[index] = clone(replacement); return true;
  });
  const armRecovery = vi.fn(async () => undefined);
  const load = vi.fn(async () => clone(saved));
  const save = vi.fn(async (lease: MacProxyLease) => { saved = clone(lease); });
  const remove = vi.fn(async () => { saved = null; });
  const deps = { platform: 'darwin' as const, adapter: { read, compareAndSet, armRecovery }, store: { load, save, remove }, ...overrides };
  const service = new MacSystemProxy('/fixture/mac-system-proxy-lease.json', deps);
  return { service, deps, read, compareAndSet, armRecovery, load, save, remove,
    current: () => clone(current), setCurrent: (value: MacProxySettings[]) => { current = clone(value); },
    saved: () => clone(saved), setSaved: (value: unknown) => { saved = clone(value); } };
}
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('macOS per-service PAC ownership', () => {
  it('persists and arms recovery before the first mutation; restores disabled stored values exactly across all services', async () => {
    const original = [direct(), direct('USB Ethernet')]; const f = fixture(original);
    f.compareAndSet.mockImplementation(async (expected, replacement) => {
      expect(f.saved()).not.toBeNull(); expect(f.armRecovery).toHaveBeenCalled();
      const values = f.current(); values[values.findIndex(item => item.service === expected.service)] = clone(replacement); f.setCurrent(values); return true;
    });
    expect(await f.service.acquire(PAC)).toEqual({ mode: 'managed' });
    expect(f.current().map(item => item.automatic)).toEqual([{ enabled: true, url: PAC }, { enabled: true, url: PAC }]);
    expect(await f.service.release()).toEqual({ mode: 'off' }); expect(f.current()).toEqual(original); expect(f.saved()).toBeNull();
  });
  it.each(['web', 'secureWeb', 'socks'] as const)('reuses an existing %s proxy without any writes', async field => {
    const original = direct(); original[field].enabled = true; const f = fixture([original]);
    expect(await f.service.acquire(PAC)).toEqual({ mode: 'existing' }); expect(f.compareAndSet).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
  });
  it('reuses an existing PAC on any network service', async () => {
    const other = direct('Ethernet'); other.automatic.enabled = true; const f = fixture([direct(), other]);
    expect(await f.service.acquire(PAC)).toEqual({ mode: 'existing' }); expect(f.current()[1]).toEqual(other); expect(f.compareAndSet).not.toHaveBeenCalled();
  });
  it('preserves WPAD discovery even when GitHub resolution is DIRECT', async () => {
    const previous = direct(); previous.discovery = true; const f = fixture([previous]);
    expect(await f.service.acquire(PAC, false)).toEqual({ mode: 'existing' }); expect(f.compareAndSet).not.toHaveBeenCalled();
  });
  it('reuses an effective proxy detected by the source framework', async () => {
    const f = fixture(); expect(await f.service.acquire(PAC, true)).toEqual({ mode: 'existing' }); expect(f.save).not.toHaveBeenCalled();
  });
  it('reuses an effective session proxy even when static service settings are direct', async () => {
    const resolveExistingProxy = vi.fn(async (url: string) => url.includes('api.github') ? 'SOCKS5 127.0.0.1:7890' : 'DIRECT');
    const f = fixture([direct()], { resolveExistingProxy }); expect(await f.service.acquire(PAC)).toEqual({ mode: 'existing' });
    expect(resolveExistingProxy).toHaveBeenCalledTimes(3); expect(f.save).not.toHaveBeenCalled();
  });
  it('fails closed when effective proxy resolution is unavailable or ambiguous', async () => {
    const f = fixture([direct()], { resolveExistingProxy: async () => 'UNKNOWN' }); expect((await f.service.acquire(PAC)).mode).toBe('unavailable'); expect(f.save).not.toHaveBeenCalled();
  });
  it('acquires a PAC only after all effective choices have been confirmed direct', async () => {
    const f = fixture([direct()], { resolveExistingProxy: async () => 'DIRECT' }); expect(await f.service.acquire(PAC)).toEqual({ mode: 'managed' });
  });
  it('does not overwrite a foreign PAC takeover during status or shutdown', async () => {
    const f = fixture(); await f.service.acquire(PAC); const other = f.current()[0]!; other.automatic = { enabled: true, url: 'https://other.example/active.pac' }; f.setCurrent([other]);
    expect(await f.service.status()).toEqual({ mode: 'external' }); expect(f.current()[0]).toEqual(other); expect(f.saved()).toBeNull();
    await f.service.destroy(); expect(f.current()[0]).toEqual(other);
  });
  it('preserves a foreign app that enables the previously disabled PAC URL before any restoration began', async () => {
    const original = direct(); const f = fixture([original]); await f.service.acquire(PAC);
    const foreign = { ...original, automatic: { enabled: true, url: original.automatic.url } }; f.setCurrent([foreign]);
    const count = f.compareAndSet.mock.calls.length;
    expect(await f.service.status()).toEqual({ mode: 'external' }); expect(f.current()).toEqual([foreign]); expect(f.compareAndSet).toHaveBeenCalledTimes(count); expect(f.saved()).toBeNull();
  });
  it('removes only its PAC after another app changes HTTP, SOCKS, bypass and discovery', async () => {
    const original = direct(); const f = fixture([original]); await f.service.acquire(PAC);
    const other = f.current()[0]!; other.web = { enabled: true, server: 'external', port: 1234, authenticated: true }; other.socks.enabled = true;
    other.bypass = ['external.example']; other.discovery = true; f.setCurrent([other]);
    expect(await f.service.status()).toEqual({ mode: 'external' }); expect(f.current()[0]).toEqual({ ...other, automatic: original.automatic });
  });
  it('yields when network services change and restores only services it owned', async () => {
    const f = fixture(); await f.service.acquire(PAC); const added = direct('New external interface'); added.socks.enabled = true;
    f.setCurrent([...f.current(), added]); expect(await f.service.status()).toEqual({ mode: 'external' });
    expect(f.current()).toEqual([direct(), added]);
  });
  it('tolerates an owned service disappearing without mutating the new service', async () => {
    const f = fixture(); await f.service.acquire(PAC); const other = direct('Replacement Ethernet'); f.setCurrent([other]);
    expect(await f.service.release()).toEqual({ mode: 'external' }); expect(f.current()).toEqual([other]); expect(f.saved()).toBeNull();
  });
  it('cleans its PAC from a service another app has disabled without enabling that service', async () => {
    const f = fixture(); let disabled: MacProxySettings | null = null;
    const readOwned = vi.fn(async () => clone(disabled ?? f.current()[0]!));
    f.deps.adapter = { ...f.deps.adapter, readOwned };
    const service = new MacSystemProxy('/fixture/lease', f.deps); await service.acquire(PAC);
    disabled = f.current()[0]!; f.setCurrent([]);
    f.compareAndSet.mockImplementation(async (_expected, replacement) => { disabled = clone(replacement); return true; });
    expect(await service.status()).toEqual({ mode: 'external' }); expect(disabled).toEqual(direct()); expect(f.current()).toEqual([]);
  });
  it('compensates only completed services when another app wins a CAS race', async () => {
    const originals = [direct(), direct('Ethernet')]; const f = fixture(originals);
    f.compareAndSet.mockImplementation(async (expected, replacement) => {
      const values = f.current(); const index = values.findIndex(item => item.service === expected.service);
      if (expected.service === 'Ethernet' && replacement.automatic.url === PAC) { values[index]!.socks.enabled = true; f.setCurrent(values); return false; }
      values[index] = clone(replacement); f.setCurrent(values); return true;
    });
    expect(await f.service.acquire(PAC)).toEqual({ mode: 'external' });
    expect(f.current()[0]).toEqual(originals[0]); expect(f.current()[1]!.socks.enabled).toBe(true); expect(f.saved()).toBeNull();
  });
  it('rolls back a partial permission failure and reports unavailable', async () => {
    const originals = [direct(), direct('Ethernet')]; const f = fixture(originals); const originalCas = f.compareAndSet.getMockImplementation()!;
    f.compareAndSet.mockImplementation(async (expected, replacement) => {
      if (expected.service === 'Ethernet' && replacement.automatic.url === PAC) throw new Error('Not authorized');
      return originalCas(expected, replacement);
    });
    expect((await f.service.acquire(PAC)).mode).toBe('unavailable'); expect(f.current()).toEqual(originals); expect(f.saved()).toBeNull();
  });
  it('retains its recovery lease if removal fails and retries during shutdown', async () => {
    const f = fixture(); await f.service.acquire(PAC); const originalCas = f.compareAndSet.getMockImplementation()!;
    f.compareAndSet.mockRejectedValueOnce(new Error('Temporary permission failure'));
    expect((await f.service.release()).mode).toBe('unavailable'); expect(f.saved()).not.toBeNull();
    f.compareAndSet.mockImplementation(originalCas); expect(await f.service.destroy()).toEqual({ mode: 'off' }); expect(f.saved()).toBeNull();
  });
  it('restores a valid stale lease on startup before taking a new lease', async () => {
    const f = fixture(); await f.service.acquire(PAC); const recovered = new MacSystemProxy('/fixture/lease', f.deps);
    expect(await recovered.initialize()).toEqual({ mode: 'off' }); expect(f.current()).toEqual([direct()]); expect(f.saved()).toBeNull();
  });
  it('does not touch foreign settings when a crash lease has already been superseded', async () => {
    const f = fixture(); await f.service.acquire(PAC); const foreign = direct(); foreign.automatic = { enabled: true, url: 'https://external.example/pac' }; f.setCurrent([foreign]);
    const recovered = new MacSystemProxy('/fixture/lease', f.deps); expect(await recovered.initialize()).toEqual({ mode: 'external' }); expect(f.current()).toEqual([foreign]);
  });
  it.each([{}, { version: 2 }, { version: 1, previous: [], applied: [] }, { version: 1, previous: [null], applied: [null] }])('rejects malformed leases without writes: %j', async lease => {
    const f = fixture(); f.setSaved(lease); expect((await f.service.initialize()).mode).toBe('unavailable'); expect(f.compareAndSet).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
  });
  it.each(['https://127.0.0.1:1234/pac', 'http://localhost:1234/pac', 'http://127.0.0.1/pac', 'http://user:secret@127.0.0.1:1234/pac'])('rejects unsafe PAC URL %s before mutation', async url => {
    const f = fixture(); expect((await f.service.acquire(url)).mode).toBe('unavailable'); expect(f.save).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });
  it('serializes an enable immediately followed by disable', async () => {
    const f = fixture(); const results = await Promise.all([f.service.acquire(PAC), f.service.release()]);
    expect(results.map(result => result.mode)).toEqual(['managed', 'off']); expect(f.current()).toEqual([direct()]);
  });
  it('does not invoke native configuration on an unsupported platform', async () => {
    const f = fixture([direct()], { platform: 'linux' }); expect((await f.service.acquire(PAC)).mode).toBe('unavailable'); expect(f.read).not.toHaveBeenCalled();
  });
});

function commandFixture() {
  let current = direct('Wi-Fi with spaces'); const mutations: string[][] = [];
  const execute = vi.fn(async (args: string[]) => {
    const command = args[0];
    if (command === '-listallnetworkservices') return 'An asterisk (*) denotes that a network service is disabled.\nWi-Fi with spaces\n*Disabled service\n';
    if (args[1] !== current.service) throw new Error('Wrong service');
    if (command === '-getautoproxyurl') return `URL: ${current.automatic.url || '(null)'}\nEnabled: ${current.automatic.enabled ? 'Yes' : 'No'}\n`;
    if (command === '-getproxyautodiscovery') return `Auto Proxy Discovery: ${current.discovery ? 'On' : 'Off'}\n`;
    if (command === '-getproxybypassdomains') return current.bypass.join('\n');
    const key = command === '-getwebproxy' ? 'web' : command === '-getsecurewebproxy' ? 'secureWeb' : 'socks';
    if (command?.startsWith('-get')) { const proxy = current[key]; return `Enabled: ${proxy.enabled ? 'Yes' : 'No'}\nServer: ${proxy.server}\nPort: ${proxy.port}\nAuthenticated Proxy Enabled: ${proxy.authenticated ? '1' : '0'}\n`; }
    mutations.push(args);
    if (command === '-setautoproxyurl') current.automatic = { url: args[2]!, enabled: true };
    else if (command === '-setautoproxystate') current.automatic.enabled = args[2] === 'on';
    else throw new Error('Disallowed native mutation');
    return '';
  });
  return { execute, mutations, current: () => clone(current), setCurrent: (value: MacProxySettings) => { current = clone(value); } };
}
describe('fixed-argument networksetup adapter', () => {
  it('reads stored settings and skips disabled network services', async () => {
    const f = commandFixture(); const adapter = createMacSystemProxyAdapter(f.execute);
    expect(await adapter.read()).toEqual([f.current()]); expect(f.mutations).toEqual([]);
  });
  it('changes and restores only PAC fields, retaining every disabled value', async () => {
    const f = commandFixture(); const adapter = createMacSystemProxyAdapter(f.execute); const original = f.current();
    const applied = { ...original, automatic: { enabled: true, url: PAC } };
    expect(await adapter.compareAndSet(original, applied)).toBe(true);
    expect(await adapter.compareAndSet(applied, original)).toBe(true); expect(f.current()).toEqual(original);
    expect(f.mutations.map(args => args[0])).toEqual(['-setautoproxyurl', '-setautoproxyurl', '-setautoproxystate']);
  });
  it('refuses a manual settings change and does not invoke networksetup setters', async () => {
    const f = commandFixture(); const adapter = createMacSystemProxyAdapter(f.execute); const original = f.current();
    await expect(adapter.compareAndSet(original, { ...original, discovery: true })).rejects.toThrow('Only PAC'); expect(f.mutations).toEqual([]);
  });
  it('stops before the first write when a competing setting has changed', async () => {
    const f = commandFixture(); const adapter = createMacSystemProxyAdapter(f.execute); const original = f.current(); const external = clone(original); external.socks.enabled = true; f.setCurrent(external);
    expect(await adapter.compareAndSet(original, { ...original, automatic: { enabled: true, url: PAC } })).toBe(false); expect(f.mutations).toEqual([]);
  });
  it('does not toggle enabled after a foreign PAC URL wins the intermediate write race', async () => {
    const f = commandFixture(); const originalExecute = f.execute.getMockImplementation()!; const original = f.current();
    f.execute.mockImplementation(async args => {
      const output = await originalExecute(args);
      if (args[0] === '-setautoproxyurl') { const external = f.current(); external.automatic = { enabled: false, url: 'https://foreign.example/pac' }; f.setCurrent(external); }
      return output;
    });
    const adapter = createMacSystemProxyAdapter(f.execute);
    expect(await adapter.compareAndSet(original, { ...original, automatic: { enabled: true, url: PAC } })).toBe(false);
    expect(f.mutations).toHaveLength(1); expect(f.current().automatic).toEqual({ enabled: false, url: 'https://foreign.example/pac' });
  });
  it('keeps a disabled-PAC restoration lease across consecutive URL/flag failures and finishes on retry', async () => {
    const f = commandFixture(); const original = f.current(); const execute = f.execute.getMockImplementation()!; let failures = 0;
    f.execute.mockImplementation(async args => {
      if (args[0] === '-setautoproxystate' && args[2] === 'off' && failures > 0) { failures--; throw new Error('Temporary permission failure'); }
      return execute(args);
    });
    let saved: unknown | null = null; const store = { load: async () => clone(saved), save: async (lease: MacProxyLease) => { saved = clone(lease); }, remove: async () => { saved = null; } };
    const service = new MacSystemProxy('/fixture/lease', { platform: 'darwin', adapter: createMacSystemProxyAdapter(f.execute), store });
    expect(await service.acquire(PAC)).toEqual({ mode: 'managed' }); failures = 2;
    expect((await service.release()).mode).toBe('unavailable'); expect(f.current().automatic).toEqual({ enabled: true, url: original.automatic.url }); expect(saved).not.toBeNull();
    expect((await service.release()).mode).toBe('unavailable'); expect(saved).not.toBeNull();
    expect(await service.release()).toEqual({ mode: 'off' }); expect(f.current()).toEqual(original); expect(saved).toBeNull();
  });
  it('repairs a saved intermediate state on the next launch after restoration failed', async () => {
    const f = commandFixture(); const original = f.current(); const execute = f.execute.getMockImplementation()!; let failOff = false;
    f.execute.mockImplementation(async args => { if (args[0] === '-setautoproxystate' && failOff) { failOff = false; throw new Error('Temporary failure'); } return execute(args); });
    let saved: unknown | null = null; const deps = { platform: 'darwin' as const, adapter: createMacSystemProxyAdapter(f.execute),
      store: { load: async () => clone(saved), save: async (lease: MacProxyLease) => { saved = clone(lease); }, remove: async () => { saved = null; } } };
    const service = new MacSystemProxy('/fixture/lease', deps); await service.acquire(PAC); failOff = true;
    expect((await service.release()).mode).toBe('unavailable'); expect(saved).not.toBeNull();
    const recovered = new MacSystemProxy('/fixture/lease', deps); expect(await recovered.initialize()).toEqual({ mode: 'off' }); expect(f.current()).toEqual(original); expect(saved).toBeNull();
  });
  it('withdraws a newly saved restoration intent if a foreign old URL wins before the native CAS begins', async () => {
    const f = commandFixture(); const original = f.current(); let saved: unknown | null = null; let takeover = false;
    const store = { load: async () => clone(saved), save: async (lease: MacProxyLease) => {
      saved = clone(lease); if (takeover && lease.restoring?.length) { takeover = false; f.setCurrent({ ...original, automatic: { enabled: true, url: original.automatic.url } }); }
    }, remove: async () => { saved = null; } };
    const service = new MacSystemProxy('/fixture/lease', { platform: 'darwin', adapter: createMacSystemProxyAdapter(f.execute), store });
    await service.acquire(PAC); const writes = f.mutations.length; takeover = true;
    expect(await service.release()).toEqual({ mode: 'external' }); expect(f.mutations).toHaveLength(writes);
    expect(f.current().automatic).toEqual({ enabled: true, url: original.automatic.url }); expect(saved).toBeNull();
    await service.destroy(); expect(f.mutations).toHaveLength(writes);
  });
});

describe('lease storage and crash guardian', () => {
  it('writes an atomic private recovery lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-mac-proxy-store-')); roots.push(root); const path = join(root, 'lease.json'); const store = createMacProxyLeaseStore(path);
    expect(await store.load()).toBeNull(); const lease: MacProxyLease = { version: 1, previous: [direct()], applied: [{ ...direct(), automatic: { enabled: true, url: PAC } }] };
    await store.save(lease); expect(await store.load()).toEqual(lease); expect((await stat(path)).mode & 0o777).toBe(0o600);
    await store.remove(); expect(await store.load()).toBeNull();
  });
  it('recovers an exclusive lease lock left by a killed parent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-mac-proxy-lock-')); roots.push(root); const path = join(root, 'lease.json');
    await mkdir(`${path}.lock`); await writeFile(join(`${path}.lock`, 'owner.json'), JSON.stringify({ format: 'EasyHub system proxy lease lock', pid: 2147483647 }));
    const store = createMacProxyLeaseStore(path); expect(await store.load()).toBeNull(); await expect(stat(`${path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('a real detached guardian process removes only its own PAC after owner death', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-mac-proxy-guardian-')); roots.push(root);
    const path = join(root, 'lease.json'); const currentPath = join(root, 'settings.json'); const script = join(root, 'recovery.cjs');
    const previous = direct(); const applied = { ...previous, automatic: { enabled: true, url: PAC } };
    const lease = JSON.stringify({ version: 1, previous: [previous], applied: [applied] }); await writeFile(path, lease);
    const external = { ...applied, web: { ...applied.web, enabled: true, server: 'external-after-crash' }, bypass: ['external.example'] };
    await writeFile(currentPath, JSON.stringify([external]));
    const fakeAdapter = `const adapter = {
      read: async () => JSON.parse(await fs.readFile(${JSON.stringify(currentPath)}, 'utf8')),
      compareAndSet: async (expected, replacement) => { const current = JSON.parse(await fs.readFile(${JSON.stringify(currentPath)}, 'utf8'));
        if (JSON.stringify(current[0]) !== JSON.stringify(expected)) return false;
        await fs.writeFile(${JSON.stringify(currentPath)}, JSON.stringify([replacement])); return true; }
    };`;
    await writeFile(script, macProxyRecoverySource(path, createHash('sha256').update(lease).digest('hex'), 2147483647).replace('const adapter = createAdapter();', fakeAdapter));
    const result = await promisify(execFile)(process.execPath, [script], { timeout: 7000 }); expect(result.stdout).toBe('ready\n');
    expect(JSON.parse(await readFile(currentPath, 'utf8'))).toEqual([{ ...external, automatic: previous.automatic }]); await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('a guardian bound to an older lease leaves the new lease and settings alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-mac-proxy-old-guardian-')); roots.push(root); const path = join(root, 'lease.json'); const script = join(root, 'recovery.cjs');
    await writeFile(path, 'new lease'); await writeFile(script, macProxyRecoverySource(path, createHash('sha256').update('old lease').digest('hex'), 2147483647));
    await promisify(execFile)(process.execPath, [script], { timeout: 5000 }); expect(await readFile(path, 'utf8')).toBe('new lease');
  });
  it('a real guardian retries a partial URL/flag restoration without losing the disabled-PAC lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-mac-proxy-guardian-partial-')); roots.push(root);
    const path = join(root, 'lease.json'); const currentPath = join(root, 'settings.json'); const script = join(root, 'recovery.cjs');
    const previous = direct(); const applied = { ...previous, automatic: { enabled: true, url: PAC } };
    const intermediate = { ...applied, automatic: { enabled: true, url: previous.automatic.url } };
    const lease = JSON.stringify({ version: 1, previous: [previous], applied: [applied], restoring: [{ service: previous.service, before: applied, intermediate, target: previous }] });
    await writeFile(path, lease); await writeFile(currentPath, JSON.stringify([applied]));
    const fakeAdapter = `let first = true; const adapter = {
      read: async () => JSON.parse(await fs.readFile(${JSON.stringify(currentPath)}, 'utf8')),
      compareAndSet: async (expected, replacement) => {
        const current = JSON.parse(await fs.readFile(${JSON.stringify(currentPath)}, 'utf8'));
        if (JSON.stringify(current[0]) !== JSON.stringify(expected)) return false;
        if(first) { first=false; await fs.writeFile(${JSON.stringify(currentPath)}, ${JSON.stringify(JSON.stringify([intermediate]))}); throw Error('Temporary flag failure'); }
        await fs.writeFile(${JSON.stringify(currentPath)}, JSON.stringify([replacement])); return true; }
    };`;
    await writeFile(script, macProxyRecoverySource(path, createHash('sha256').update(lease).digest('hex'), 2147483647).replace('const adapter = createAdapter();', fakeAdapter));
    await promisify(execFile)(process.execPath, [script], { timeout: 6000 });
    expect(JSON.parse(await readFile(currentPath, 'utf8'))).toEqual([previous]); await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('persists a guardian-initiated transition so a replacement guardian completes a killed partial restoration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-mac-proxy-guardian-restart-')); roots.push(root);
    const path = join(root, 'lease.json'); const currentPath = join(root, 'settings.json'); const script = join(root, 'recovery.cjs');
    const previous = direct(); const applied = { ...previous, automatic: { enabled: true, url: PAC } };
    const intermediate = { ...applied, automatic: { enabled: true, url: previous.automatic.url } };
    const lease = JSON.stringify({ version: 1, previous: [previous], applied: [applied] }); await writeFile(path, lease); await writeFile(currentPath, JSON.stringify([applied]));
    const fakeAdapter = (crash: boolean): string => `const adapter = {
      read: async () => JSON.parse(await fs.readFile(${JSON.stringify(currentPath)}, 'utf8')),
      compareAndSet: async (expected, replacement) => {
        const current = JSON.parse(await fs.readFile(${JSON.stringify(currentPath)}, 'utf8'));
        if (JSON.stringify(current[0]) !== JSON.stringify(expected)) return false;
        ${crash ? `await fs.writeFile(${JSON.stringify(currentPath)}, ${JSON.stringify(JSON.stringify([intermediate]))}); process.exit(73);` : `await fs.writeFile(${JSON.stringify(currentPath)}, JSON.stringify([replacement])); return true;`}
      }
    };`;
    await writeFile(script, macProxyRecoverySource(path, createHash('sha256').update(lease).digest('hex'), 2147483647).replace('const adapter = createAdapter();', fakeAdapter(true)));
    await expect(promisify(execFile)(process.execPath, [script], { timeout: 6000 })).rejects.toMatchObject({ code: 73 });
    const updatedLease = await readFile(path); expect(JSON.parse(updatedLease.toString()).restoring[0].intermediate).toEqual(intermediate);
    await writeFile(script, macProxyRecoverySource(path, createHash('sha256').update(updatedLease).digest('hex'), 2147483647).replace('const adapter = createAdapter();', fakeAdapter(false)));
    await promisify(execFile)(process.execPath, [script], { timeout: 6000 }); expect(JSON.parse(await readFile(currentPath, 'utf8'))).toEqual([previous]);
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
