import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { smokeEnvironment, smokeExecutable } from './smoke-runtime.mjs';

const desktop = dirname(fileURLToPath(import.meta.url));
const triggerFlags = ['--trigger=app-quit', '--trigger=native-menu'];
const executable = smokeExecutable(desktop, triggerFlags);
const trigger = process.argv.find(value => value.startsWith('--trigger='))?.slice('--trigger='.length);
const triggers = trigger ? [trigger] : process.platform === 'darwin' ? ['app-quit', 'native-menu'] : ['app-quit'];
const mode = executable ? 'packaged' : 'development';
const output = join(desktop, 'out', 'quit-lifecycle');
await mkdir(output, { recursive: true });
const cases = [];

for (const selectedTrigger of triggers) {
  const root = await mkdtemp(join(tmpdir(), 'easyhub-quit-lifecycle-'));
  const profile = join(root, 'profile');
  const traceFile = join(root, 'lifecycle.jsonl');
  await mkdir(profile);
  let application;
  let child;
  let exit;
  const result = { trigger: selectedTrigger, mode, status: 'failed', timeoutMilliseconds: 8000,
    isolatedUserData: true, inMemoryCredentials: true, systemProxyWrites: false, remoteWrites: false };
  try {
    application = await electron.launch({ executablePath: executable || electronPath,
      args: executable ? [] : [desktop], cwd: desktop,
      env: { ...smokeEnvironment(profile), ELECTRON_RENDERER_URL: 'data:text/html,<title>Isolated quit lifecycle</title>' } });
    child = application.process();
    result.pid = child.pid;
    result.application = await application.evaluate(({ app }) => ({ isPackaged: app.isPackaged, version: app.getVersion() }));
    assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
    await application.firstWindow();
    await application.evaluate(async ({ app, BrowserWindow, session }, traceFile) => {
      const fs = process.getBuiltinModule('node:fs');
      const trace = (name, details = {}) => fs.appendFileSync(traceFile, `${JSON.stringify({ name,
        timestamp: Date.now(), windows: BrowserWindow.getAllWindows().length, ...details })}\n`);
      globalThis.easyHubQuitLifecycleTrace = trace;
      trace('ready', { beforeQuitListeners: app.listenerCount('before-quit') });
      app.on('before-quit', event => trace('before-quit', { prevented: event.defaultPrevented }));
      app.on('will-quit', event => trace('will-quit', { prevented: event.defaultPrevented }));
      app.on('quit', (_event, exitCode) => trace('quit', { exitCode }));
      app.on('window-all-closed', () => trace('window-all-closed'));
      for (const window of BrowserWindow.getAllWindows()) window.on('closed', () => trace('window-closed'));
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
      await BrowserWindow.getAllWindows()[0].loadURL('data:text/html,<title>Isolated quit lifecycle</title>');
    }, traceFile);
    let started = Date.now();
    const exited = new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) resolve({ code: child.exitCode, signal: child.signalCode });
      else child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    // Invoke the real application lifecycle. Do not use ElectronApplication.close(),
    // window.close(), or process termination to obtain the passing exit signal.
    if (selectedTrigger === 'native-menu') {
      // Native macOS role actions are owned by AppKit, so MenuItem.click() is not
      // the same trigger. Use CUA on this exact disposable app instance; start
      // the exit deadline only after the real before-quit event is observed.
      result.nativeInteraction = 'CUA native Quit menu or Cmd-Q on the disposable app instance';
      const ready = { pid: child.pid, executable: executable || electronPath, profile,
        application: result.application, readyAt: new Date().toISOString() };
      await writeFile(join(output, 'cua-ready.json'), `${JSON.stringify(ready, null, 2)}\n`);
      process.stdout.write(`CUA_READY ${JSON.stringify(ready)}\n`);
      const triggerDeadline = Date.now() + 120000;
      let observed;
      while (Date.now() < triggerDeadline) {
        const trace = (await readFile(traceFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        observed = trace.find(event => event.name === 'before-quit');
        if (observed) break;
        if (child.exitCode !== null || child.signalCode !== null) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(observed, 'CUA must trigger a real native before-quit event before testing process exit');
      started = observed.timestamp;
    } else {
      await application.evaluate(({ app }) => {
        globalThis.easyHubQuitLifecycleTrace('trigger', { trigger: 'app-quit' });
        app.quit();
      }).catch(error => { result.dispatchError = error.message; });
    }
    let timer;
    exit = await Promise.race([exited, new Promise(resolve => {
      timer = setTimeout(() => resolve(null), result.timeoutMilliseconds);
    })]);
    clearTimeout(timer);
    result.elapsedMilliseconds = Date.now() - started;
    result.exit = exit;
    if (!exit) {
      try {
        result.aliveSnapshot = await application.evaluate(({ app, BrowserWindow }) => ({ ready: app.isReady(),
          windows: BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), destroyed: window.isDestroyed() })),
          activeHandles: process._getActiveHandles().map(handle => handle.constructor?.name ?? 'unknown'),
        }));
      } catch (error) { result.snapshotError = error.message; }
      assert.fail('Real app quit did not terminate the main process within 8 seconds');
    }
    assert.deepEqual(exit, { code: 0, signal: null }, 'The main process must exit naturally with code 0');
    result.status = 'passed';
  } catch (error) {
    result.error = error.message;
  } finally {
    result.lifecycle = (await readFile(traceFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    // Cleanup applies only to the disposable process after recording a failure;
    // a cleanup SIGTERM must never count as a successful application quit.
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      result.failureCleanup = 'SIGTERM (with bounded SIGKILL fallback) after failed assertion';
    }
    const resolved = await realpath(root);
    assert.ok(resolved.startsWith(`${await realpath(tmpdir())}${sep}easyhub-quit-lifecycle-`));
    await rm(resolved, { recursive: true, force: true });
    cases.push(result);
    process.stdout.write(`${result.status.toUpperCase()} ${selectedTrigger}: ${JSON.stringify(result)}\n`);
  }
}
const report = { status: cases.every(result => result.status === 'passed') ? 'passed' : 'failed',
  executable: executable || electronPath, generatedAt: new Date().toISOString(), cases,
  scope: 'Real Electron main-process exit; no real account, repository, or system proxy settings.' };
await writeFile(join(output, `${mode}-results.json`), `${JSON.stringify(report, null, 2)}\n`);
if (report.status !== 'passed') process.exitCode = 1;
