import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Launch an actual app bundle when requested; never inherit the user's profile or secrets. */
export function smokeExecutable(desktopDirectory, allowedFlags = []) {
  const arguments_ = process.argv.slice(2);
  for (const argument of arguments_) {
    if (argument !== '--packaged' && !argument.startsWith('--executable=') && !allowedFlags.includes(argument)) {
      throw new Error(`Unknown smoke argument: ${argument}`);
    }
  }
  const explicit = arguments_.filter(value => value.startsWith('--executable='));
  if (explicit.length > 1) throw new Error('Only one --executable argument is allowed.');
  const executable = explicit[0]?.slice('--executable='.length) ?? (arguments_.includes('--packaged')
    ? process.env.EASYHUB_PACKAGED_EXECUTABLE || (process.platform === 'darwin'
      ? '/tmp/easyhub-desktop-release/mac-arm64/EasyHub.app/Contents/MacOS/EasyHub'
      : join(desktopDirectory, 'release/win-unpacked/EasyHub.exe')) : undefined);
  if (executable !== undefined && (!isAbsolute(executable) || !existsSync(executable))) {
    throw new Error('The selected executable must be an existing absolute path.');
  }
  return executable;
}

export function smokeEnvironment(profileDirectory) {
  return { ...process.env, ELECTRON_RENDERER_URL: '', EASYHUB_TEST_MODE: '1',
    EASYHUB_TEST_USER_DATA: profileDirectory, EASYHUB_PROXY_APP_ONLY_TEST: '1' };
}

export function smokeRenderer(desktopDirectory, executable) {
  if (!executable) return join(desktopDirectory, 'out/renderer/index.html');
  return process.platform === 'darwin'
    ? join(executable, '../../Resources/app.asar/out/renderer/index.html')
    : join(executable, '../resources/app.asar/out/renderer/index.html');
}
