import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWindowsProxyLeaseStore, WindowsSystemProxy } from './WindowsSystemProxy';
import type { WindowsProxyLease, WindowsProxySettings, WindowsSystemProxyDependencies } from './WindowsSystemProxy';

const PAC_URL = 'http://127.0.0.1:45678/github-random-lease.pac';
const DIRECT: WindowsProxySettings = { flags: 1, proxyServer: '', proxyBypass: '', autoConfigUrl: '' };
const MANUAL: WindowsProxySettings = { flags: 3, proxyServer: '127.0.0.1:7890', proxyBypass: '<local>;*.local', autoConfigUrl: '' };
const roots: string[] = [];

function fixture(previous: WindowsProxySettings = DIRECT, overrides: Partial<WindowsSystemProxyDependencies> = {}) {
  let current = { ...previous };
  let saved: unknown | null = null;
  const read = vi.fn(async () => ({ ...current }));
  const compareAndSet = vi.fn(async (expected: WindowsProxySettings, replacement: WindowsProxySettings) => {
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
    current = { ...replacement };
    return true;
  });
  const armRecovery = vi.fn(async () => undefined);
  const detectAutomaticProxy = vi.fn(async () => false);
  const load = vi.fn(async () => saved);
  const save = vi.fn(async (lease: WindowsProxyLease) => { saved = structuredClone(lease); });
  const remove = vi.fn(async () => { saved = null; });
  const resolveExistingProxy = vi.fn(async (_url: string) => 'DIRECT');
  const deps = { platform: 'win32' as const, adapter: { read, compareAndSet, armRecovery, detectAutomaticProxy },
    store: { load, save, remove }, resolveExistingProxy, ...overrides };
  const service = new WindowsSystemProxy('C:\\fixture\\system-proxy-lease.json', deps);
  return { service, deps, read, compareAndSet, armRecovery, detectAutomaticProxy, load, save, remove, resolveExistingProxy,
    settings: () => ({ ...current }), setSettings: (settings: WindowsProxySettings) => { current = { ...settings }; },
    saved: () => saved, setSaved: (lease: unknown) => { saved = lease; } };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('Windows current-user proxy ownership', () => {
  it('persists before applying a PAC and exactly restores disabled server, bypass, PAC and auto-detection choices', async () => {
    const original = { flags: 9, proxyServer: 'old-proxy:8080', proxyBypass: '<local>;10.*', autoConfigUrl: 'https://old.example/disabled.pac' };
    const f = fixture(original);
    f.compareAndSet.mockImplementationOnce(async (_expected, replacement) => {
      expect(f.saved()).toEqual({ version: 1, previous: original, applied: replacement });
      expect(f.armRecovery).toHaveBeenCalledOnce();
      f.setSettings(replacement); return true;
    });
    expect(await f.service.initialize()).toEqual({ mode: 'off' });
    expect(await f.service.acquire(PAC_URL)).toEqual({ mode: 'managed' });
    expect(f.settings()).toEqual({ ...original, flags: 5, autoConfigUrl: PAC_URL });
    expect(f.detectAutomaticProxy).toHaveBeenCalledOnce();
    expect(f.resolveExistingProxy).not.toHaveBeenCalled();
    expect(await f.service.release()).toEqual({ mode: 'off' });
    expect(f.settings()).toEqual(original);
    expect(f.saved()).toBeNull();
  });

  it.each([
    MANUAL,
    { ...DIRECT, flags: 5, autoConfigUrl: 'https://other.example/proxy.pac' },
  ])('respects existing active configuration: %j', async settings => {
    const f = fixture(settings);
    expect(await f.service.acquire(PAC_URL)).toEqual({ mode: 'existing' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.armRecovery).not.toHaveBeenCalled();
    expect(await f.service.release()).toEqual({ mode: 'off' });
    expect(f.settings()).toEqual(settings);
  });

  it('preserves discovered WPAD even when GitHub routes are DIRECT, and only acquires after native discovery confirms no WPAD', async () => {
    const f = fixture({ ...DIRECT, flags: 9 });
    f.detectAutomaticProxy.mockResolvedValue(true);
    expect(await f.service.acquire(PAC_URL)).toEqual({ mode: 'existing' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.settings()).toEqual({ ...DIRECT, flags: 9 });
    expect(f.resolveExistingProxy).not.toHaveBeenCalled();
    f.detectAutomaticProxy.mockResolvedValue(false);
    expect(await f.service.acquire(PAC_URL)).toEqual({ mode: 'managed' });
    await f.service.release();
    expect(f.settings()).toEqual({ ...DIRECT, flags: 9 });
  });

  it('accepts a positive resolved proxy but never treats a negative per-URL result as proof of no WPAD', async () => {
    const f = fixture({ ...DIRECT, flags: 9 });
    const service = new WindowsSystemProxy('C:\\fixture\\lease.json', { ...f.deps,
      adapter: { read: f.read, compareAndSet: f.compareAndSet }, resolveExistingProxy: undefined });
    expect(await service.acquire(PAC_URL)).toMatchObject({ mode: 'unavailable', error: expect.any(String) });
    expect(f.compareAndSet).not.toHaveBeenCalled();
    expect(await service.acquire(PAC_URL, true)).toEqual({ mode: 'existing' });
    expect(await service.acquire(PAC_URL, false)).toMatchObject({ mode: 'unavailable' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
  });

  it('uses the resolver fallback only as positive evidence and refuses takeover when all tested GitHub URLs are DIRECT', async () => {
    const f = fixture({ ...DIRECT, flags: 9 });
    const service = new WindowsSystemProxy('C:\\fixture\\lease.json', { ...f.deps,
      adapter: { read: f.read, compareAndSet: f.compareAndSet } });
    f.resolveExistingProxy.mockImplementation(async url => url.includes('api.github.com') ? 'PROXY corp.example:8080; DIRECT' : 'DIRECT');
    expect(await service.acquire(PAC_URL)).toEqual({ mode: 'existing' });
    f.resolveExistingProxy.mockResolvedValue('DIRECT');
    expect(await service.acquire(PAC_URL)).toMatchObject({ mode: 'unavailable' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(['Detection timed out', 'Discovery service unavailable'])('refuses takeover when native WPAD discovery is uncertain: %s', async message => {
    const f = fixture({ ...DIRECT, flags: 9 });
    f.detectAutomaticProxy.mockRejectedValue(new Error(message));
    expect(await f.service.acquire(PAC_URL)).toMatchObject({ mode: 'unavailable' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.settings()).toEqual({ ...DIRECT, flags: 9 });
  });

  it('restores a crash lease on startup before acquiring another local PAC', async () => {
    const f = fixture({ ...DIRECT, flags: 9 });
    await f.service.acquire(PAC_URL);
    const restarted = new WindowsSystemProxy('C:\\fixture\\system-proxy-lease.json', f.deps);
    expect(await restarted.initialize()).toEqual({ mode: 'off' });
    expect(f.settings()).toEqual({ ...DIRECT, flags: 9 });
    expect(f.saved()).toBeNull();
    expect(await restarted.acquire('http://127.0.0.1:34567/new-lease.pac')).toEqual({ mode: 'managed' });
  });

  it('leaves a newer external PAC untouched on startup, status and exit', async () => {
    const f = fixture();
    await f.service.acquire(PAC_URL);
    const foreign = { ...MANUAL, flags: 7, autoConfigUrl: 'https://external.example/other.pac' };
    f.setSettings(foreign); f.compareAndSet.mockClear();
    expect(await f.service.status()).toEqual({ mode: 'external' });
    expect(f.settings()).toEqual(foreign);
    expect(f.compareAndSet).not.toHaveBeenCalled();
    expect(f.saved()).toBeNull();
    await f.service.destroy();
    expect(f.settings()).toEqual(foreign);
  });

  it('does not restore a stale crash lease over an external manual proxy', async () => {
    const f = fixture();
    await f.service.acquire(PAC_URL);
    f.setSettings(MANUAL); f.compareAndSet.mockClear();
    const restarted = new WindowsSystemProxy('C:\\fixture\\system-proxy-lease.json', f.deps);
    expect(await restarted.initialize()).toEqual({ mode: 'external' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
    expect(f.settings()).toEqual(MANUAL);
    expect(f.saved()).toBeNull();
  });

  it.each(['status', 'release', 'initialize'] as const)
    ('removes only its retained PAC when another app changes server/bypass/flags during %s', async operation => {
      const original = { ...DIRECT, flags: 9, autoConfigUrl: 'https://old.example/disabled.pac' };
      const f = fixture(original);
      await f.service.acquire(PAC_URL);
      const foreign = { ...MANUAL, flags: 15, proxyBypass: 'corp.example;<local>', autoConfigUrl: PAC_URL };
      f.setSettings(foreign);
      const target = operation === 'initialize' ? new WindowsSystemProxy('C:\\fixture\\system-proxy-lease.json', f.deps) : f.service;
      expect(await target[operation]()).toEqual({ mode: 'external' });
      expect(f.settings()).toEqual({ ...foreign, flags: 11, autoConfigUrl: original.autoConfigUrl });
      expect(f.saved()).toBeNull();
    });

  it('gives up acquisition when another proxy changes settings during the native comparison', async () => {
    const f = fixture();
    f.compareAndSet.mockImplementationOnce(async () => { f.setSettings(MANUAL); return false; });
    expect(await f.service.acquire(PAC_URL)).toEqual({ mode: 'external' });
    expect(f.settings()).toEqual(MANUAL);
    expect(f.saved()).toBeNull();
    expect(f.compareAndSet).toHaveBeenCalledOnce();
  });

  it('recovers its managed status after a temporary native read failure', async () => {
    const f = fixture();
    await f.service.acquire(PAC_URL);
    f.read.mockRejectedValueOnce(new Error('Temporary WinINet failure'));
    expect(await f.service.status()).toMatchObject({ mode: 'unavailable' });
    expect(await f.service.status()).toEqual({ mode: 'managed' });
    expect(f.settings().autoConfigUrl).toBe(PAC_URL);
    expect(f.saved()).not.toBeNull();
  });

  it('rechecks a release race and never writes over a new external PAC', async () => {
    const f = fixture();
    await f.service.acquire(PAC_URL);
    const foreign = { ...MANUAL, flags: 7, autoConfigUrl: 'https://external.example/other.pac' };
    f.compareAndSet.mockClear();
    f.compareAndSet.mockImplementationOnce(async () => { f.setSettings(foreign); return false; });
    expect(await f.service.release()).toEqual({ mode: 'external' });
    expect(f.settings()).toEqual(foreign);
    expect(f.compareAndSet).toHaveBeenCalledOnce();
  });

  it('cleans its retained PAC when a manual proxy takes ownership during release comparison', async () => {
    const f = fixture();
    await f.service.acquire(PAC_URL);
    const foreign = { ...MANUAL, flags: 7, autoConfigUrl: PAC_URL };
    f.compareAndSet.mockImplementationOnce(async () => { f.setSettings(foreign); return false; });
    expect(await f.service.release()).toEqual({ mode: 'external' });
    expect(f.settings()).toEqual(MANUAL);
  });

  it('rolls back a native error after the settings were already applied', async () => {
    const f = fixture({ ...DIRECT, flags: 9 });
    f.compareAndSet.mockImplementationOnce(async (_expected, replacement) => {
      f.setSettings(replacement); throw new Error('Refresh broadcast failed');
    });
    expect(await f.service.acquire(PAC_URL)).toMatchObject({ mode: 'unavailable', error: expect.any(String) });
    expect(f.settings()).toEqual({ ...DIRECT, flags: 9 });
    expect(f.saved()).toBeNull();
    expect(f.compareAndSet).toHaveBeenCalledTimes(2);
  });

  it('preserves a recovery lease if both applying and rolling back fail, then recovers on the next start', async () => {
    const f = fixture();
    f.compareAndSet.mockImplementationOnce(async (_expected, replacement) => {
      f.setSettings(replacement); throw new Error('Partial write failed');
    });
    f.compareAndSet.mockRejectedValueOnce(new Error('Restore temporarily blocked'));
    expect(await f.service.acquire(PAC_URL)).toMatchObject({ mode: 'unavailable' });
    expect(f.saved()).not.toBeNull();
    expect(f.settings().autoConfigUrl).toBe(PAC_URL);
    const restarted = new WindowsSystemProxy('C:\\fixture\\system-proxy-lease.json', f.deps);
    expect(await restarted.initialize()).toEqual({ mode: 'off' });
    expect(f.settings()).toEqual(DIRECT);
    expect(f.saved()).toBeNull();
  });

  it('does not mutate settings when saving the lease or arming crash recovery fails', async () => {
    const f = fixture();
    f.save.mockRejectedValueOnce(new Error('Disk full'));
    expect(await f.service.acquire(PAC_URL)).toMatchObject({ mode: 'unavailable' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
    f.armRecovery.mockRejectedValueOnce(new Error('PowerShell blocked'));
    expect(await f.service.acquire(PAC_URL)).toMatchObject({ mode: 'unavailable' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
    expect(f.settings()).toEqual(DIRECT);
    expect(f.saved()).toBeNull();
  });

  it('leaves a corrupted lease untouched and retries loading before any acquisition', async () => {
    const f = fixture();
    f.setSaved({ version: 1, previous: DIRECT, applied: { ...DIRECT, flags: 5, autoConfigUrl: 'https://foreign.example/a.pac' } });
    expect(await f.service.initialize()).toMatchObject({ mode: 'unavailable' });
    expect(await f.service.acquire(PAC_URL)).toMatchObject({ mode: 'unavailable' });
    expect(f.compareAndSet).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    f.setSaved(null);
    expect(await f.service.acquire(PAC_URL)).toEqual({ mode: 'managed' });
  });

  it('serializes acquisition and shutdown so exiting cannot strand a newly applied PAC', async () => {
    const f = fixture();
    const results = await Promise.all([f.service.acquire(PAC_URL), f.service.destroy()]);
    expect(results).toEqual([{ mode: 'managed' }, { mode: 'off' }]);
    expect(f.settings()).toEqual(DIRECT);
    expect(f.saved()).toBeNull();
  });

  it.each(['http://localhost:8080/a.pac', 'https://127.0.0.1:8080/a.pac', 'http://127.0.0.1/a.pac',
    'http://user:password@127.0.0.1:8080/a.pac', 'http://127.0.0.1:8080/a.pac#fragment'])
    ('rejects a nonlocal or invalid PAC address: %s', async url => {
      const f = fixture();
      expect(await f.service.acquire(url)).toMatchObject({ mode: 'unavailable' });
      expect(f.compareAndSet).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
    });

  it('reports unsupported operating systems without invoking native code', async () => {
    const f = fixture(DIRECT, { platform: 'linux' });
    expect(await f.service.acquire(PAC_URL)).toMatchObject({ mode: 'unavailable' });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
  });

  it('saves and loads a complete lease atomically and deletes it on release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-system-proxy-'));
    roots.push(root);
    const path = join(root, 'preferences', 'system-proxy-lease.json');
    const store = createWindowsProxyLeaseStore(path);
    expect(await store.load()).toBeNull();
    const lease: WindowsProxyLease = { version: 1, previous: DIRECT, applied: { ...DIRECT, flags: 5, autoConfigUrl: PAC_URL } };
    await store.save(lease);
    expect(await store.load()).toEqual(lease);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(lease);
    await store.remove();
    expect(await store.load()).toBeNull();
  });

  it.skipIf(process.platform !== 'win32')('runs the crash guardian against an isolated native stub without touching OS settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-proxy-guardian-'));
    roots.push(root);
    const leasePath = join(root, 'lease.json');
    const statePath = join(root, 'restored.txt');
    const scriptPath = join(root, 'guardian-fixture.ps1');
    const source = await readFile(join(__dirname, '../../../resources/windows-system-proxy.ps1'), 'utf8');
    // Replace the entire WinINet assembly before executing the watcher; all mutations
    // go to a temporary fixture file. No test starts the real native write operation.
    const assembly = `Add-Type -TypeDefinition @'
using System;
using System.IO;
public sealed class EasyHubProxySettings {
    public uint flags;
    public string proxyServer;
    public string proxyBypass;
    public string autoConfigUrl;
}
public static class EasyHubWinInetProxy {
    private static int Attempts;
    public static EasyHubProxySettings Current = new EasyHubProxySettings {
        flags=5, proxyServer="", proxyBypass="", autoConfigUrl="${PAC_URL}"
    };
    public static EasyHubProxySettings Read() { return Current; }
    public static bool Equal(EasyHubProxySettings left, EasyHubProxySettings right) {
        return left.flags==right.flags && left.proxyServer==right.proxyServer &&
            left.proxyBypass==right.proxyBypass && left.autoConfigUrl==right.autoConfigUrl;
    }
    public static bool CompareAndSet(EasyHubProxySettings expected, EasyHubProxySettings replacement) {
        if (Environment.GetEnvironmentVariable("EASYHUB_GUARDIAN_FIXTURE_RETRY") == "1" && Attempts++ == 0) return false;
        if (!Equal(Current, expected)) throw new Exception("Unsafe comparison");
        Current=replacement;
        File.WriteAllText(Environment.GetEnvironmentVariable("EASYHUB_GUARDIAN_FIXTURE_STATE"),
            replacement.flags+"\\n"+replacement.proxyServer+"\\n"+replacement.proxyBypass+"\\n"+replacement.autoConfigUrl);
        return true;
    }
}
'@`;
    const fixtureScript = source.replace(/Add-Type -TypeDefinition @'[\s\S]+?\r?\n'@/u, assembly);
    expect(fixtureScript).not.toContain('DllImport');
    await writeFile(scriptPath, fixtureScript);
    const previous: WindowsProxySettings = { flags: 9, proxyServer: 'inactive:8080', proxyBypass: '<local>', autoConfigUrl: 'https://inactive.example/a.pac' };
    const applied = { ...previous, flags: 5, autoConfigUrl: PAC_URL };
    // Align the stub with saved inactive fields while keeping all native calls replaced.
    await writeFile(scriptPath, fixtureScript.replace('flags=5, proxyServer="", proxyBypass="",', 'flags=5, proxyServer="inactive:8080", proxyBypass="<local>",'));
    const savedLease = JSON.stringify({ version: 1, previous, applied });
    await writeFile(leasePath, savedLease);
    const expectedLeaseHash = createHash('sha256').update(savedLease).digest('hex');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      input: JSON.stringify({ operation: 'watch', ownerPid: 2147483647, leasePath, expectedLeaseHash }), windowsHide: true,
      env: { ...process.env, EASYHUB_GUARDIAN_FIXTURE_STATE: statePath }, encoding: 'utf8', timeout: 10000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ready');
    expect(await readFile(statePath, 'utf8')).toBe('9\ninactive:8080\n<local>\nhttps://inactive.example/a.pac');
    expect(await createWindowsProxyLeaseStore(leasePath).load()).toBeNull();

    // A transient failed comparison must be retried with the same saved lease.
    await writeFile(leasePath, savedLease);
    await rm(statePath);
    const retrying = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      input: JSON.stringify({ operation: 'watch', ownerPid: 2147483647, leasePath, expectedLeaseHash }), windowsHide: true,
      env: { ...process.env, EASYHUB_GUARDIAN_FIXTURE_STATE: statePath, EASYHUB_GUARDIAN_FIXTURE_RETRY: '1' }, encoding: 'utf8', timeout: 10000,
    });
    expect(retrying.error).toBeUndefined();
    expect(retrying.status).toBe(0);
    expect(await readFile(statePath, 'utf8')).toBe('9\ninactive:8080\n<local>\nhttps://inactive.example/a.pac');
    expect(await createWindowsProxyLeaseStore(leasePath).load()).toBeNull();

    // An old guardian must leave a replacement lease and its new owner's PAC alone.
    const replacementLease = JSON.stringify({ version: 1, previous, applied: { ...applied, autoConfigUrl: 'http://127.0.0.1:45679/new-owner.pac' } });
    await writeFile(leasePath, replacementLease);
    await rm(statePath);
    const stale = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      input: JSON.stringify({ operation: 'watch', ownerPid: 2147483647, leasePath, expectedLeaseHash }), windowsHide: true,
      env: { ...process.env, EASYHUB_GUARDIAN_FIXTURE_STATE: statePath }, encoding: 'utf8', timeout: 10000,
    });
    expect(stale.error).toBeUndefined();
    expect(stale.status).toBe(0);
    expect(await readFile(leasePath, 'utf8')).toBe(replacementLease);
    await expect(readFile(statePath)).rejects.toMatchObject({ code: 'ENOENT' });

    // Also replace the lease after a guardian is already monitoring a live parent.
    // It must exit on its next poll without restoring or deleting the newer lease.
    await writeFile(leasePath, savedLease);
    await new Promise<void>((resolve, reject) => {
      const watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
        windowsHide: true, env: { ...process.env, EASYHUB_GUARDIAN_FIXTURE_STATE: statePath },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let ready = false;
      let stderr = '';
      const timer = setTimeout(() => { watcher.kill(); reject(new Error('Guardian did not relinquish the replacement lease')); }, 5000);
      watcher.stdout.setEncoding('utf8');
      watcher.stdout.on('data', (chunk: string) => {
        if (!ready && chunk.includes('ready')) {
          ready = true;
          void writeFile(leasePath, replacementLease).catch(reject);
        }
      });
      watcher.stderr.setEncoding('utf8');
      watcher.stderr.on('data', (chunk: string) => { stderr += chunk; });
      watcher.on('error', error => { clearTimeout(timer); reject(error); });
      watcher.on('close', code => {
        clearTimeout(timer);
        if (!ready || code !== 0 || stderr) reject(new Error(`Guardian failed: ${stderr}`));
        else resolve();
      });
      watcher.stdin.end(JSON.stringify({ operation: 'watch', ownerPid: process.pid, leasePath, expectedLeaseHash }));
    });
    expect(await readFile(leasePath, 'utf8')).toBe(replacementLease);
    await expect(readFile(statePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
