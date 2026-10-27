import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Select a packaged executable using an explicit flag or platform default. */
export function smokeExecutable(desktopDirectory, allowedFlags = []) {
  const arguments_ = process.argv.slice(2);
  for (const argument of arguments_) {
    if (argument !== '--packaged' && !argument.startsWith('--executable=') && !allowedFlags.includes(argument)) {
      throw new Error(`Unknown smoke argument: ${argument}`);
    }
  }
  const explicit = arguments_.filter(value => value.startsWith('--executable='));
  if (explicit.length > 1) throw new Error('Only one --executable argument is allowed.');
  const defaults = {
    darwin: '/tmp/easyhub-desktop-release/mac-arm64/EasyHub.app/Contents/MacOS/EasyHub',
    win32: join(desktopDirectory, 'release', 'windows', 'win-unpacked', 'EasyHub.exe'),
    linux: join(desktopDirectory, 'release', 'linux-unpacked', 'easyhub'),
  };
  const executable = explicit[0]?.slice('--executable='.length) ?? (arguments_.includes('--packaged')
    ? process.env.EASYHUB_PACKAGED_EXECUTABLE || defaults[process.platform] : undefined);
  if (arguments_.includes('--packaged') && executable === undefined) {
    throw new Error(`Pass --executable for platform ${process.platform}.`);
  }
  if (executable !== undefined && (!isAbsolute(executable) || !existsSync(executable))) {
    throw new Error('The selected executable must be an existing absolute path.');
  }
  return executable;
}

export function smokeEnvironment(profileDirectory) {
  if (!isAbsolute(profileDirectory)) throw new Error('The smoke profile must use an absolute path.');
  const environment = { ...process.env, ELECTRON_RENDERER_URL: '', NODE_OPTIONS: '',
    EASYHUB_TEST_MODE: '1', EASYHUB_TEST_USER_DATA: profileDirectory, EASYHUB_PROXY_APP_ONLY_TEST: '1' };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NAPI_RS_NATIVE_LIBRARY_PATH;
  return environment;
}

export function smokeRenderer(desktopDirectory, executable) {
  if (!executable) return join(desktopDirectory, 'out', 'renderer', 'index.html');
  return process.platform === 'darwin'
    ? join(executable, '../../Resources/app.asar/out/renderer/index.html')
    : join(executable, '../resources/app.asar/out/renderer/index.html');
}
