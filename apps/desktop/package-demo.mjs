import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = dirname(fileURLToPath(import.meta.url));
const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) {
  process.stderr.write('请通过 pnpm package:demo 运行打包命令。\n');
  process.exit(1);
}

const environment = {
  ...process.env,
  VITE_EASYHUB_DEMO_ONLY: 'true',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ?? 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

for (const args of [
  ['exec', 'electron-vite', 'build'],
  ['exec', 'electron-builder', '--config', 'electron-builder.demo.yml', '--win', 'portable', '--x64', '--publish', 'never'],
]) {
  const result = spawnSync(process.execPath, [pnpmEntrypoint, ...args], {
    cwd: desktopDir,
    stdio: 'inherit',
    env: environment,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
