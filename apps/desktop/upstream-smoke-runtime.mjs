import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { smokeExecutable, smokeEnvironment, smokeRenderer } from './smoke-runtime.mjs';

// Test-only startup. A packaged run starts the selected app, rather than loading
// its ASAR into a different Electron binary. All credential stores remain memory-only.
export async function launchUpstreamFixture(desktop, { profile, launcher, registerName, rejectedName = 'upstreamRejectedIPC', title, allowedFlags = [] }) {
  const executable = smokeExecutable(desktop, allowedFlags);
  if (!executable) await writeFile(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
globalThis[${JSON.stringify(registerName)}] = ipcMain.handle.bind(ipcMain);
globalThis[${JSON.stringify(rejectedName)}] = [];
const safeNativeUI = new Set(['easyhub:menu-state', 'easyhub:window-set-style']);
ipcMain.handle = (channel, handler) => globalThis[${JSON.stringify(registerName)}](channel,
  channel.startsWith('easyhub:') && !safeNativeUI.has(channel) ? () => {
    globalThis[${JSON.stringify(rejectedName)}].push(channel);
    throw new Error('Unmocked isolated fixture IPC: ' + channel);
  } : handler);
require(${JSON.stringify(join(desktop, 'out/main/index.js'))});
`, 'utf8');
  const app = await electron.launch({ executablePath: executable ?? electronPath,
    args: executable ? ['--user-data-dir=' + profile] : [launcher], cwd: desktop,
    env: { ...smokeEnvironment(profile), ELECTRON_RENDERER_URL: 'data:text/html,<title>' + title + '</title>' } });
  try {
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    assert.deepEqual(await app.evaluate(() => [process.env.EASYHUB_TEST_MODE, process.env.EASYHUB_PROXY_APP_ONLY_TEST]), ['1', '1']);
    await app.evaluate(({ ipcMain, session }, { registerName, rejectedName, packaged }) => {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
      if (!packaged) return;
      const register = ipcMain.handle.bind(ipcMain);
      globalThis[registerName] = register;
      globalThis[rejectedName] = [];
      const safeNativeUI = new Set(['easyhub:menu-state', 'easyhub:window-set-style']);
      // Electron's test-side IPC registry lets this fixture deny every production
      // bridge operation before reloading the renderer. Only its mocks opt in.
      for (const channel of [...ipcMain._invokeHandlers.keys()]) {
        if (!channel.startsWith('easyhub:') || safeNativeUI.has(channel)) continue;
        ipcMain.removeHandler(channel);
        register(channel, () => {
          globalThis[rejectedName].push(channel);
          throw new Error('Unmocked isolated fixture IPC: ' + channel);
        });
      }
    }, { registerName, rejectedName, packaged: Boolean(executable) });
    return { app, executable, renderer: smokeRenderer(desktop, executable), packaged: Boolean(executable) };
  } catch (cause) {
    await app.close();
    throw cause;
  }
}
