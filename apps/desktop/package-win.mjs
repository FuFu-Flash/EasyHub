import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = dirname(fileURLToPath(import.meta.url));
const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) {
  process.stderr.write('请通过 pnpm package:win 运行打包命令。\n');
  process.exit(1);
}

const environment = {
  ...process.env,
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ?? 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

for (const args of [
  ['exec', 'electron-vite', 'build'],
  ['exec', 'electron-builder', '--win', '--x64', '--publish', 'never'],
]) {
  const result = spawnSync(process.execPath, [pnpmEntrypoint, ...args], {
    cwd: desktopDir,
    stdio: 'inherit',
    env: environment,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const { version } = JSON.parse(await readFile(join(desktopDir, 'package.json'), 'utf8'));
const shellDir = join(desktopDir, 'installer-shell');
const { version: shellVersion } = JSON.parse(await readFile(join(shellDir, 'package.json'), 'utf8'));
if (version !== shellVersion) throw new Error('安装器版本与 EasyHub 版本不一致。');
const payloadDir = join(desktopDir, 'out', 'installer-shell-payload');
await mkdir(payloadDir, { recursive: true });
const core = join(desktopDir, 'release', `EasyHub-${version}-core.exe`);
const payload = join(payloadDir, 'core-installer.exe');
await copyFile(core, payload);
const shell = spawnSync(process.execPath, [pnpmEntrypoint, 'exec', 'electron-builder', '--projectDir', shellDir,
  '--config', join(shellDir, 'electron-builder.yml'), '--win', 'portable', '--x64', '--publish', 'never'], {
  cwd: desktopDir, stdio: 'inherit', env: environment,
});
if (shell.status !== 0) process.exit(shell.status ?? 1);
await copyFile(join(desktopDir, 'out', 'installer-shell-build', `EasyHub-${version}-setup.exe`),
  join(desktopDir, 'release', `EasyHub-${version}-setup.exe`));
await Promise.all([rm(core), rm(`${core}.blockmap`, { force: true }), rm(payload),
  rm(join(desktopDir, 'release', `EasyHub-${version}-setup.exe.blockmap`), { force: true })]);
