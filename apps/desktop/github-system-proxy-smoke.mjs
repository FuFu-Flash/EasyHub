import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { build } from 'vite';

// Default checks change isolated Chromium sessions, never Windows or EasyHub preferences.
// Explicit --native also exercises WinINet ownership, preserving any existing proxy
// and verifying exact restoration before stopping a temporarily managed relay.
const desktop = dirname(fileURLToPath(import.meta.url));
const native = process.argv.includes('--native');
const root = await mkdtemp(join(tmpdir(), 'easyhub-system-proxy-smoke-'));
const profile = join(root, 'profile');
const source = join(root, 'transport.ts');
const launcher = join(root, 'launch.cjs');
await mkdir(profile);
const importPath = relative => join(desktop, relative).replaceAll('\\', '/');
await writeFile(source, `
export { GitHubSystemRelay } from ${JSON.stringify(importPath('src/main/services/GitHubSystemRelay.ts'))};
export { GitHubOriginAgent } from ${JSON.stringify(importPath('src/main/services/githubProxyOrigin.ts'))};
export { DEFAULT_GITHUB_RULES } from ${JSON.stringify(importPath('src/main/services/steamGitHubRules.ts'))};
export { WindowsSystemProxy, createWindowsSystemProxyAdapter } from ${JSON.stringify(importPath('src/main/services/WindowsSystemProxy.ts'))};
`, 'utf8');

let running;
try {
  await build({ configFile: false, logLevel: 'silent', root: desktop,
    build: { outDir: join(root, 'bundle'), emptyOutDir: false,
      lib: { entry: source, formats: ['cjs'], fileName: () => 'transport.cjs' },
      rollupOptions: { external: [/^node:/u] } } });
  await writeFile(launcher, `
const { app, BrowserWindow, session } = require('electron');
const { createServer } = require('node:http');
const { GitHubSystemRelay, GitHubOriginAgent, DEFAULT_GITHUB_RULES, WindowsSystemProxy, createWindowsSystemProxyAdapter } = require(${JSON.stringify(join(root, 'bundle/transport.cjs'))});
const fs = require('node:fs/promises');
app.setPath('userData', ${JSON.stringify(profile)});
const resources = { servers: [], relay: null, agent: null, nativeManager: null,
  nativeAdapter: null, nativeOriginal: null, nativeLeasePath: ${JSON.stringify(join(root, 'native-lease.json'))} };
const equalSettings = (left, right) => left.flags === right.flags && left.proxyServer === right.proxyServer &&
  left.proxyBypass === right.proxyBypass && left.autoConfigUrl === right.autoConfigUrl;
const leaseRemoved = async () => {
  try { await fs.stat(resources.nativeLeasePath); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
};
const restoreNative = async () => {
  if (!resources.nativeManager) return { safe: true, restored: true, leaseRemoved: true };
  const release = await resources.nativeManager.release();
  const current = await resources.nativeAdapter.read();
  const restored = equalSettings(current, resources.nativeOriginal);
  const removed = await leaseRemoved();
  return { safe: release.mode === 'off' && restored && removed,
    releaseMode: release.mode, restored, leaseRemoved: removed };
};
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { resources.servers.push(server); resolve(server.address().port); });
});
const fetchText = async (client, url) => {
  const response = await client.fetch(url, { signal: AbortSignal.timeout(25000) });
  return { status: response.status, text: await response.text() };
};
globalThis.easyHubSystemSmoke = {
  runNative: async () => {
    if (process.platform !== 'win32') throw new Error('Native smoke requires Windows.');
    const system = session.fromPartition('easyhub-native-system-smoke');
    await system.setProxy({ mode: 'system' });
    const adapter = resources.nativeAdapter = createWindowsSystemProxyAdapter(${JSON.stringify(join(desktop, 'resources/windows-system-proxy.ps1'))});
    const snapshot = resources.nativeOriginal = await adapter.read();
    // Exact original values remain private; do not include them in returned evidence.
    await fs.writeFile(${JSON.stringify(join(root, 'native-original.json'))}, JSON.stringify(snapshot), { mode: 0o600 });
    const initialChoices = await Promise.all(['https://github.com/', 'https://api.github.com/',
      'https://raw.githubusercontent.com/'].map(url => system.resolveProxy(url)));
    const hasExisting = Boolean((snapshot.flags & 2) && snapshot.proxyServer.trim() ||
      (snapshot.flags & 4) && snapshot.autoConfigUrl.trim() ||
      (snapshot.flags & 8) && initialChoices.some(choice => /(?:^|;)\\s*(?:PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\\s+/i.test(choice)));
    const manager = resources.nativeManager = new WindowsSystemProxy(resources.nativeLeasePath,
      { adapter, resolveExistingProxy: url => system.resolveProxy(url) });
    const attempts = [], tunnels = [];
    const agent = resources.agent = new GitHubOriginAgent({ rules: DEFAULT_GITHUB_RULES,
      fetchDns: (url, init) => system.fetch(url, init) });
    const relay = resources.relay = new GitHubSystemRelay({ connect: async (host, signal) => {
      attempts.push(host); const socket = await agent.openBrowserTunnel(host, signal);
      tunnels.push(host); return socket;
    } });
    const endpoints = await relay.start();
    let evidence;
    try {
      const acquired = await manager.acquire(endpoints.pacUrl);
      const unchangedWhileExisting = hasExisting ? equalSettings(await adapter.read(), snapshot) : null;
      let systemChoiceIsOwned = false, response = null;
      if (acquired.mode === 'managed') {
        await system.closeAllConnections();
        for (let attempt = 0; attempt < 20; attempt++) {
          const choice = await system.resolveProxy('https://api.github.com/repos/octocat/Hello-World');
          if (relay.ownsProxyChoice(choice)) { systemChoiceIsOwned = true; break; }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        try {
          const fetched = await fetchText(system, 'https://api.github.com/repos/octocat/Hello-World');
          response = { status: fetched.status, valid: JSON.parse(fetched.text).full_name === 'octocat/Hello-World' };
        } catch (error) { response = { status: null, valid: false, error: error.message }; }
      }
      evidence = { hasExisting, acquiredMode: acquired.mode, unchangedWhileExisting,
        systemChoiceIsOwned, attempts, tunnels, response };
    } catch (error) { evidence = { hasExisting, error: error.message }; }
    const restoration = await restoreNative();
    if (restoration.safe) await relay.stop();
    return { ...evidence, ...restoration };
  },
  run: async () => {
    const managed = session.fromPartition('easyhub-pac-smoke');
    const existing = session.fromPartition('easyhub-existing-proxy-smoke');
    const originDns = session.fromPartition('easyhub-origin-dns-smoke');
    await originDns.setProxy({ mode: 'direct' });
    let existingRequests = 0;
    const existingPort = await listen(createServer((_request, response) => {
      existingRequests++; response.end('existing-proxy-ok');
    }));
    await existing.setProxy({ mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:' + existingPort });
    const existingUrl = 'http://easyhub-existing-proxy.invalid/sentinel';
    const beforeChoice = await existing.resolveProxy(existingUrl);
    const beforeResponse = await fetchText(existing, existingUrl);
    let directRequests = 0;
    const directPort = await listen(createServer((_request, response) => {
      directRequests++; response.end('non-github-direct-ok');
    }));
    const attempts = [], tunnels = [];
    const agent = resources.agent = new GitHubOriginAgent({ rules: DEFAULT_GITHUB_RULES,
      fetchDns: (url, init) => originDns.fetch(url, init) });
    const relay = resources.relay = new GitHubSystemRelay({ connect: async (host, signal) => {
      attempts.push(host);
      const socket = await agent.openBrowserTunnel(host, signal);
      tunnels.push(host); return socket;
    } });
    const endpoints = await relay.start();
    await managed.setProxy({ mode: 'pac_script', pacScript: endpoints.pacUrl });
    await managed.closeAllConnections();
    const choices = {
      github: await managed.resolveProxy('https://github.com/octocat/Hello-World'),
      api: await managed.resolveProxy('https://api.github.com/repos/octocat/Hello-World'),
      nonGithub: await managed.resolveProxy('https://example.com/'),
      plainHttp: await managed.resolveProxy('http://github.com/'),
      nonstandardPort: await managed.resolveProxy('https://github.com:8443/')
    };
    const directResponse = await fetchText(managed, 'http://127.0.0.1:' + directPort + '/direct');
    const nonGithubTouchedRelay = attempts.length !== 0;
    const live = await Promise.all([
      ['github', 'https://github.com/octocat/Hello-World'],
      ['api', 'https://api.github.com/repos/octocat/Hello-World'],
      ['nonGithub', 'https://example.com/']
    ].map(async ([name, url]) => {
      try {
        const response = await fetchText(managed, url);
        return { name, status: response.status,
          valid: name === 'api' ? JSON.parse(response.text).full_name === 'octocat/Hello-World'
            : name === 'github' ? response.text.includes('octocat/Hello-World') : response.text.includes('Example Domain') };
      } catch (error) { return { name, status: null, valid: false, error: error.message }; }
    }));
    const duringChoice = await existing.resolveProxy(existingUrl);
    const duringResponse = await fetchText(existing, existingUrl);
    await relay.stop();
    const afterChoice = await existing.resolveProxy(existingUrl);
    const afterResponse = await fetchText(existing, existingUrl);
    // Stop has no authority to change even this isolated session's proxy.
    await managed.setProxy({ mode: 'direct' });
    await managed.closeAllConnections();
    return { endpoints, choices, directResponse, directRequests, nonGithubTouchedRelay,
      attempts, tunnels, live, existingRequests,
      existing: { beforeChoice, duringChoice, afterChoice, beforeResponse, duringResponse, afterResponse } };
  },
  cleanup: async () => {
    const restoration = await restoreNative();
    if (!restoration.safe) return false;
    await resources.relay?.stop(); resources.agent?.destroy();
    for (const server of resources.servers) {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
    return true;
  }
};
app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false });
  window.loadURL('data:text/html,<title>Isolated system proxy smoke</title>');
});
`, 'utf8');
  running = await electron.launch({ executablePath: electronPath, args: [launcher], cwd: desktop });
  await running.firstWindow();
  assert.equal(await running.evaluate(({ app }) => app.getPath('userData')), profile);
  if (native) {
    const result = await running.evaluate(() => globalThis.easyHubSystemSmoke.runNative());
    console.log(JSON.stringify({ nativeMode: result.acquiredMode, existingSettingsPreserved: result.unchangedWhileExisting,
      systemChoiceIsOwned: result.systemChoiceIsOwned, attempts: result.attempts, tunnels: result.tunnels,
      publicRequest: result.response, restored: result.restored, leaseRemoved: result.leaseRemoved }));
    assert.equal(result.safe, true, 'Native restoration could not be verified. Keep the live relay and private snapshot for recovery.');
    assert.equal(result.acquiredMode, result.hasExisting ? 'existing' : 'managed');
    if (result.hasExisting) {
      assert.equal(result.unchangedWhileExisting, true);
      console.log('PASS Native WinINet: existing manual/PAC/effective WPAD configuration was reused without changing any setting; release preserved the exact original snapshot and left no lease.');
    } else {
      assert.equal(result.systemChoiceIsOwned, true);
      assert.ok(result.response.status === 200 && result.response.valid, 'Native system-mode GitHub HTTPS fetch failed.');
      assert.ok(result.tunnels.includes('api.github.com'));
      console.log('PASS Native WinINet: production helper applied the temporary PAC; a Chromium system-mode session fetched GitHub API HTTPS through the live relay; all original settings restored exactly and lease removed.');
    }
  } else {
  const result = await running.evaluate(() => globalThis.easyHubSystemSmoke.run());
  const proxyAuthority = new URL(result.endpoints.proxyUrl).host;
  assert.equal(result.choices.github, `PROXY ${proxyAuthority};DIRECT`);
  assert.equal(result.choices.api, `PROXY ${proxyAuthority};DIRECT`);
  assert.equal(result.choices.nonGithub, 'DIRECT');
  assert.equal(result.choices.plainHttp, 'DIRECT');
  assert.equal(result.choices.nonstandardPort, 'DIRECT');
  assert.deepEqual(result.directResponse, { status: 200, text: 'non-github-direct-ok' });
  assert.equal(result.directRequests, 1);
  assert.equal(result.nonGithubTouchedRelay, false);
  assert.equal(result.existing.beforeChoice, result.existing.duringChoice);
  assert.equal(result.existing.beforeChoice, result.existing.afterChoice);
  assert.match(result.existing.beforeChoice, /^PROXY 127\.0\.0\.1:[0-9]+$/u);
  for (const response of [result.existing.beforeResponse, result.existing.duringResponse, result.existing.afterResponse]) {
    assert.deepEqual(response, { status: 200, text: 'existing-proxy-ok' });
  }
  assert.equal(result.existingRequests, 3);
  console.log('PASS Chromium PAC routing: GitHub HTTPS uses production relay; non-GitHub and HTTP use DIRECT; an independent existing proxy remains usable before, during and after relay shutdown.');
  console.log(JSON.stringify({ attempts: result.attempts, tunnels: result.tunnels, publicRequests: result.live }));
  for (const resultItem of result.live) assert.ok(resultItem.status === 200 && resultItem.valid,
    `Real ${resultItem.name} HTTPS request failed with TLS verification enabled: ${JSON.stringify(resultItem)}`);
  assert.ok(result.tunnels.includes('github.com'));
  assert.ok(result.tunnels.includes('api.github.com'));
  assert.ok(!result.attempts.includes('example.com'));
  console.log('PASS Public Chromium HTTPS: GitHub page and API JSON via CONNECT, example.com DIRECT; original certificates verified; no Windows, hosts or certificate changes.');
  }
} finally {
  if (running) {
    const safeToClose = await running.evaluate(() => globalThis.easyHubSystemSmoke.cleanup()).catch(() => !native);
    if (!safeToClose) {
      console.error('Native proxy restoration is incomplete. Keeping Electron, relay, guardian and private recovery files alive at: ' + root);
      // A test failure must not terminate its relay while Windows still uses its PAC.
      await new Promise(() => undefined);
    }
    await running.close();
  }
  const absolute = await realpath(root);
  assert.ok(absolute.startsWith(`${await realpath(tmpdir())}${sep}`) && absolute.includes('easyhub-system-proxy-smoke-'));
  await rm(absolute, { recursive: true, force: true });
}
