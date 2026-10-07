import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(desktopDir, '../..');
const pnpmEntrypoint = process.env.npm_execpath;
const releaseDirectory = process.env.EASYHUB_DESKTOP_RELEASE_DIR ?? '/tmp/easyhub-desktop-release';
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('请在 Apple Silicon Mac 上生成 macOS 安装包。');
}
if (!pnpmEntrypoint || !isAbsolute(pnpmEntrypoint)) {
  throw new Error('请通过 pnpm --filter @easyhub/desktop package:mac 运行打包命令。');
}
if (!isAbsolute(releaseDirectory)) throw new Error('EASYHUB_DESKTOP_RELEASE_DIR 必须是绝对路径。');
const metadata = JSON.parse(await readFile(join(desktopDir, 'package.json'), 'utf8'));
if (metadata.version !== '1.0.1') throw new Error('此构建配置对应 EasyHub 1.0.1 (15)。');

const environment = { ...process.env,
  PATH: [dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
// Test-only isolation and fixtures must never become release launch defaults.
delete environment.EASYHUB_TEST_MODE;
delete environment.EASYHUB_TEST_USER_DATA;
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: desktopDir, stdio: 'inherit', env: environment });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`构建命令失败：${executable}（${result.status ?? result.signal ?? 'unknown'}）。`);
}

await Promise.all([
  access(join(sourceRoot, 'LICENSE'), constants.R_OK),
  access(join(sourceRoot, 'UPSTREAM.txt'), constants.R_OK),
  access(join(desktopDir, 'resources/easyhub.png'), constants.R_OK),
  access(join(desktopDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), constants.X_OK),
]);
await mkdir(join(desktopDir, 'resources'), { recursive: true });
const iconDirectory = await mkdtemp(join(tmpdir(), 'easyhub-desktop-icon-'));
try {
  const iconSet = join(iconDirectory, 'EasyHub.iconset');
  await mkdir(iconSet);
  // Use the upstream application's artwork, including the renderer's original brand.
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      run('/usr/bin/sips', ['-z', String(size * scale), String(size * scale),
        join(desktopDir, 'resources/easyhub.png'), '--out', join(iconSet, name)]);
    }
  }
  run('/usr/bin/iconutil', ['-c', 'icns', iconSet, '-o', join(desktopDir, 'resources/easyhub.icns')]);
} finally { await rm(iconDirectory, { recursive: true, force: true }); }

run(process.execPath, [pnpmEntrypoint, 'exec', 'electron-vite', 'build']);
run(process.execPath, [pnpmEntrypoint, 'exec', 'electron-builder',
  '--config', 'electron-builder-mac.yml', '--mac', '--arm64', '--dir', '--publish', 'never',
  `--config.directories.output=${releaseDirectory}`]);

const application = join(releaseDirectory, 'mac-arm64/EasyHub.app');
const contents = join(application, 'Contents');
await access(join(contents, 'Resources/app.asar.unpacked'), constants.R_OK);
await access(join(contents, 'Resources/UPSTREAM.txt'), constants.R_OK);
await access(join(contents, 'Resources/LICENSE'), constants.R_OK);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', application]);
process.stdout.write(`EasyHub 1.0.1 (15) macOS arm64 app: ${application}\n`);
