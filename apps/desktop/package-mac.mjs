import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(desktopDir, '../..');
const pnpmEntrypoint = process.env.npm_execpath;
const releaseDirectory = process.env.EASYHUB_DESKTOP_RELEASE_DIR ?? join(desktopDir, 'release', 'macos');
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('请在 Apple Silicon Mac 上生成 macOS 安装包。');
}
if (!pnpmEntrypoint || !isAbsolute(pnpmEntrypoint)) {
  throw new Error('请通过 pnpm --filter @easyhub/desktop package:mac 运行打包命令。');
}
if (!isAbsolute(releaseDirectory)) throw new Error('EASYHUB_DESKTOP_RELEASE_DIR 必须是绝对路径。');
const metadata = JSON.parse(await readFile(join(desktopDir, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/u.test(metadata.version)) throw new Error('无法识别 EasyHub 桌面版本号。');

const environment = { ...process.env,
  PATH: [dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  EASYHUB_MAC_BUNDLE: '1',
  // Reuse the verified workspace dependencies; packaging must not auto-install.
  pnpm_config_verify_deps_before_run: 'warn' };
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
  access(join(desktopDir, 'resources/easyhub-mac.png'), constants.R_OK),
  access(join(desktopDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), constants.X_OK),
]);
await mkdir(join(desktopDir, 'resources'), { recursive: true });
const iconDirectory = await mkdtemp(join(tmpdir(), 'easyhub-desktop-icon-'));
try {
  const iconSet = join(iconDirectory, 'EasyHub.iconset');
  await mkdir(iconSet);
  // The upstream artwork with the transparent margin macOS app icons need; the full-bleed
  // easyhub.png would look a size larger than other Dock icons.
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      run('/usr/bin/sips', ['-z', String(size * scale), String(size * scale),
        join(desktopDir, 'resources/easyhub-mac.png'), '--out', join(iconSet, name)]);
    }
  }
  run('/usr/bin/iconutil', ['-c', 'icns', iconSet, '-o', join(desktopDir, 'resources/easyhub.icns')]);
} finally { await rm(iconDirectory, { recursive: true, force: true }); }

run(process.execPath, [pnpmEntrypoint, 'exec', 'electron-vite', 'build']);
// The Mac copier omits bundled JS dependencies, so an ordinary Windows/dev
// build must never accidentally be packaged with this configuration.
await access(join(desktopDir, 'out/macos/main/bundled-dependency-notices.txt'), constants.R_OK);
await access(join(desktopDir, 'out/macos/renderer/bundled-dependency-notices.txt'), constants.R_OK);
// File Provider can attach Finder metadata during nested helper renames. Sign
// outside the synced checkout, then publish only the verified generated bundle.
const packageDirectory = await mkdtemp(join(tmpdir(), 'easyhub-macos-package-'));
try {
  run(process.execPath, [pnpmEntrypoint, 'exec', 'electron-builder',
    '--config', 'build/macos/electron-builder.yml', '--mac', '--arm64', '--dir', '--publish', 'never',
    `--config.directories.output=${packageDirectory}`]);
  const signedApplication = join(packageDirectory, 'mac-arm64/EasyHub.app');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', signedApplication]);
  // Keep the signed bundle inside the disk image / ZIP. Copying an .app back
  // into a File Provider directory can immediately reattach invalid metadata.
  const imageDirectory = join(packageDirectory, 'image');
  await mkdir(imageDirectory);
  run('/usr/bin/ditto', [signedApplication, join(imageDirectory, 'EasyHub.app')]);
  await symlink('/Applications', join(imageDirectory, 'Applications'));
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(imageDirectory, 'EasyHub.app')]);
  const image = join(packageDirectory, 'EasyHub-macOS.dmg');
  const archive = join(packageDirectory, 'EasyHub-macOS.zip');
  run('/usr/bin/hdiutil', ['create', '-volname', 'EasyHub', '-srcfolder', imageDirectory, '-format', 'ULMO', image]);
  run('/usr/bin/hdiutil', ['verify', image]);
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', signedApplication, archive]);
  await mkdir(releaseDirectory, { recursive: true });
  await rename(image, join(releaseDirectory, 'EasyHub-macOS.dmg'));
  await rename(archive, join(releaseDirectory, 'EasyHub-macOS.zip'));
  process.stdout.write(`EasyHub ${metadata.version} macOS arm64: ${releaseDirectory}/EasyHub-macOS.dmg and EasyHub-macOS.zip\n`);
} finally { await rm(packageDirectory, { recursive: true, force: true }); }
