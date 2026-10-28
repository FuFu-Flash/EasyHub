import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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

// The installer window: a branded background plus Finder icon positions, written straight
// into the image's .DS_Store by dmgbuild (no Finder automation). Its three pure-Python
// dependencies are hash-locked and kept in a cache outside the project.
const dmgDirectory = join(desktopDir, 'build/macos/dmg');
async function buildStyledImage({ application, scratch, output, version }) {
  const toolEnvironment = { ...process.env, PYTHONPATH: '', NODE_OPTIONS: '' };
  const tools = join(homedir(), '.cache/easyhub-build-tools/dmgbuild-1.6.5');
  const python = join(tools, 'bin/python');
  const check = () => spawnSync(python, ['-c',
    "from importlib.metadata import version; assert [version(p) for p in ('dmgbuild', 'ds-store', 'mac-alias')] == ['1.6.5', '1.3.1', '2.2.2']"],
  { env: toolEnvironment }).status === 0;
  if (!check()) {
    const python3 = process.env.EASYHUB_DMG_PYTHON ?? '/usr/bin/python3';
    const bootstrap = (executable, args) => {
      const result = spawnSync(executable, args, { stdio: 'inherit', env: toolEnvironment });
      if (result.status !== 0) throw new Error('无法准备安装镜像工具（dmgbuild）；请联网后重试，或设置 EASYHUB_DMG_PYTHON。');
    };
    bootstrap(python3, ['-m', 'venv', tools]);
    bootstrap(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:',
      '--no-deps', '--require-hashes', '-r', join(dmgDirectory, 'requirements.txt')]);
  }
  const art = join(scratch, 'dmg-art');
  await mkdir(art);
  run('/usr/bin/swift', [join(dmgDirectory, 'background.swift'), art, join(desktopDir, 'resources/easyhub-mac.png')]);
  const background = join(art, 'background.tiff');
  run('/usr/bin/tiffutil', ['-cathidpicheck', join(art, 'background.png'), join(art, 'background@2x.png'), '-out', background]);
  const settings = join(art, 'settings.json');
  await writeFile(settings, JSON.stringify({
    format: 'ULMO', filesystem: 'HFS+', background,
    icon: join(desktopDir, 'resources/easyhub.icns'), icon_size: 96, text_size: 13,
    // 410pt of artwork plus the 28pt title bar; no toolbar, sidebar, path or status bar.
    window_rect: [[400, 260], [640, 438]],
    show_toolbar: false, show_status_bar: false, show_pathbar: false, show_sidebar: false,
    default_view: 'icon-view', include_icon_view_settings: true,
    files: [application], symlinks: { Applications: '/Applications' },
    icon_locations: { 'EasyHub.app': [170, 212], Applications: [470, 212] },
  }, null, 2));
  const built = spawnSync(python, ['-c',
    "import json, sys; from dmgbuild import build_dmg; build_dmg(sys.argv[2], sys.argv[3], settings=json.load(open(sys.argv[1])))",
    settings, output, `EasyHub ${version}`], { stdio: 'inherit', env: toolEnvironment });
  if (built.status !== 0) throw new Error('生成安装镜像失败。');
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
  const image = join(packageDirectory, 'EasyHub-macOS.dmg');
  const archive = join(packageDirectory, 'EasyHub-macOS.zip');
  await buildStyledImage({ application: signedApplication, scratch: packageDirectory, output: image, version: metadata.version });
  run('/usr/bin/hdiutil', ['verify', image]);
  const mountPoint = join(packageDirectory, 'mounted');
  await mkdir(mountPoint);
  run('/usr/bin/hdiutil', ['attach', image, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountPoint]);
  try { run('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(mountPoint, 'EasyHub.app')]); }
  finally { run('/usr/bin/hdiutil', ['detach', mountPoint]); }
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', signedApplication, archive]);
  await mkdir(releaseDirectory, { recursive: true });
  await rename(image, join(releaseDirectory, 'EasyHub-macOS.dmg'));
  await rename(archive, join(releaseDirectory, 'EasyHub-macOS.zip'));
  process.stdout.write(`EasyHub ${metadata.version} macOS arm64: ${releaseDirectory}/EasyHub-macOS.dmg and EasyHub-macOS.zip\n`);
} finally { await rm(packageDirectory, { recursive: true, force: true }); }
