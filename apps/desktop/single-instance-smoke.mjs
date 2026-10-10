import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { smokeExecutable, smokeEnvironment } from './smoke-runtime.mjs';

// Both real app processes use one disposable profile. App-only transport mode
// excludes the Windows proxy manager; the blank renderer never reads an account.
const desktop = dirname(fileURLToPath(import.meta.url));
const executable = smokeExecutable(desktop);
const root = await mkdtemp(join(tmpdir(), 'easyhub-single-instance-smoke-'));
const profile = join(root, 'profile');
const launcher = join(root, 'launch.cjs');
const secondaryMarker = join(root, 'secondary.json');
await mkdir(profile);
await writeFile(launcher, `
const { app } = require('electron');
const fs = require('node:fs');
app.setPath('userData', ${JSON.stringify(profile)});
process.env.EASYHUB_PROXY_APP_ONLY_TEST = '1';
process.env.ELECTRON_RENDERER_URL = 'data:text/html,<title>Isolated single instance smoke</title>';
globalThis.easyHubSingleInstanceSmoke = { secondEvents: 0 };
app.on('second-instance', () => { globalThis.easyHubSingleInstanceSmoke.secondEvents++; });
if (process.argv.includes('--smoke-secondary')) {
  const marker = { userDataMatches: app.getPath('userData') === ${JSON.stringify(profile)}, readyCalls: 0 };
  const write = () => fs.writeFileSync(${JSON.stringify(secondaryMarker)}, JSON.stringify(marker));
  const ready = app.whenReady.bind(app);
  app.whenReady = (...args) => { marker.readyCalls++; write(); return ready(...args); };
  write();
}
require(${JSON.stringify(join(desktop, 'out/main/index.js'))});
`, 'utf8');

let primary;
let secondary;
async function waitForWindow(predicate, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const status = await primary.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      const window = windows[0];
      return { count: windows.length, alive: Boolean(window && !window.isDestroyed()),
        visible: window?.isVisible(), minimized: window?.isMinimized(), focused: window?.isFocused(),
        secondEvents: globalThis.easyHubSingleInstanceSmoke.secondEvents };
    });
    if (predicate(status)) return status;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(label);
}

try {
  primary = await electron.launch({ executablePath: executable || electronPath, args: executable ? [] : [launcher], cwd: desktop, env: smokeEnvironment(profile) });
  if (executable) await primary.evaluate(({ app }) => {
    globalThis.easyHubSingleInstanceSmoke = { secondEvents: 0 };
    app.on('second-instance', () => { globalThis.easyHubSingleInstanceSmoke.secondEvents++; });
  });
  const page = await primary.firstWindow();
  await page.waitForLoadState();
  assert.equal(await primary.evaluate(({ app }) => app.getPath('userData')), profile);
  await waitForWindow(status => status.alive && status.visible, 'Primary app window did not appear.');
  await primary.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.minimize();
  });
  await waitForWindow(status => status.minimized, 'Primary fixture window did not minimize.');
  await primary.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].hide(); });
  // AppKit can clear the miniaturized state while ordering the window out.
  await waitForWindow(status => !status.visible && (process.platform === 'darwin' || status.minimized), 'Primary fixture window did not hide.');
  const exit = await new Promise((resolve, reject) => {
    secondary = spawn(executable || electronPath, executable ? [] : [launcher, '--smoke-secondary'], { cwd: desktop, windowsHide: true,
      env: smokeEnvironment(profile), stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { secondary.kill(); reject(new Error('Secondary app did not exit promptly.')); }, 10000);
    secondary.once('error', error => { clearTimeout(timer); reject(error); });
    secondary.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.deepEqual(exit, { code: 0, signal: null });
  if (!executable) assert.deepEqual(JSON.parse(await readFile(secondaryMarker, 'utf8')), { userDataMatches: true, readyCalls: 0 });
  const restored = await waitForWindow(status => status.count === 1 && status.alive && status.visible &&
    !status.minimized && status.focused && status.secondEvents === 1,
  'Second instance did not restore, show and focus the existing primary window.');
  assert.equal(restored.count, 1);
  if (!executable) assert.equal(await page.title(), 'Isolated single instance smoke');
  else assert.equal(await primary.evaluate(({ app }) => app.isPackaged), true);
  console.log('PASS Two real EasyHub processes, one isolated profile: secondary exited 0 without a second window; primary window remained alive, restored, visible and focused. No Windows proxy or user account changes.');
} finally {
  if (secondary && secondary.exitCode === null) secondary.kill();
  await primary?.close();
  const absolute = await realpath(root);
  assert.ok(absolute.startsWith(`${await realpath(tmpdir())}${sep}`) && absolute.includes('easyhub-single-instance-smoke-'));
  await rm(absolute, { recursive: true, force: true });
}
