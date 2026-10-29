import { spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = dirname(fileURLToPath(import.meta.url));
if (process.platform !== 'linux') {
  throw new Error('Linux 安装包请在 Linux 上构建；Windows 使用 package:win，macOS 使用 package:mac。');
}
if (process.arch !== 'x64' && process.arch !== 'arm64') {
  throw new Error('Linux 安装包目前支持 x64 和 arm64。');
}
const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) {
  process.stderr.write('请通过 pnpm package:linux 运行打包命令。\n');
  process.exit(1);
}

const environment = { ...process.env, EASYHUB_LINUX_BUNDLE: '1' };
delete environment.EASYHUB_TEST_MODE;
delete environment.EASYHUB_TEST_USER_DATA;
delete environment.EASYHUB_PROXY_APP_ONLY_TEST;

function run(args) {
  const result = spawnSync(process.execPath, [pnpmEntrypoint, ...args], {
    cwd: desktopDir, stdio: 'inherit', env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['exec', 'electron-vite', 'build']);

const sourceConfig = await readFile(join(desktopDir, 'build/linux/electron-builder.yml'), 'utf8');
if (!sourceConfig.includes('keyring-linux-x64-gnu')) throw new Error('Linux 打包配置缺少 x64 密钥环过滤。');
const keyring = process.arch === 'arm64' ? 'keyring-linux-arm64-gnu' : 'keyring-linux-x64-gnu';
const archName = process.arch === 'arm64' ? 'arm64' : 'x64';
// Keep the resolved file beside the committed config so electron-builder still
// resolves bundled paths from the desktop project, then delete it.
const configFile = join(desktopDir, 'build/linux/electron-builder.resolved.yml');
try {
  const configText = sourceConfig.replaceAll('keyring-linux-x64-gnu', keyring)
    .replaceAll('EasyHub-${version}-x64.${ext}', `EasyHub-\${version}-${archName}.\${ext}`);
  await writeFile(configFile, configText);
  run(['exec', 'electron-builder', '--config', 'build/linux/electron-builder.resolved.yml', '--linux', `--${process.arch}`, '--publish', 'never']);
} finally {
  await rm(configFile, { force: true });
}
