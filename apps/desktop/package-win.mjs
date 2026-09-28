import { spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
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
const core = join(desktopDir, 'release', `EasyHub-${version}-core.exe`);
const windows = process.env.WINDIR ?? 'C:\\Windows';
const framework = join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const gac = join(windows, 'Microsoft.NET', 'assembly');
const publicKey = 'v4.0_4.0.0.0__31bf3856ad364e35';
const references = [
  join(gac, 'GAC_MSIL', 'PresentationFramework', publicKey, 'PresentationFramework.dll'),
  join(gac, 'GAC_64', 'PresentationCore', publicKey, 'PresentationCore.dll'),
  join(gac, 'GAC_MSIL', 'WindowsBase', publicKey, 'WindowsBase.dll'),
  join(framework, 'System.Xaml.dll'),
  join(framework, 'System.Windows.Forms.dll'),
];
const assemblyInfo = join(desktopDir, 'out', 'installer-assembly-info.cs');
await writeFile(assemblyInfo,
  `[assembly: System.Reflection.AssemblyTitle("EasyHub 安装程序")]\n` +
  `[assembly: System.Reflection.AssemblyProduct("EasyHub")]\n` +
  `[assembly: System.Reflection.AssemblyVersion("${version}.0")]\n` +
  `[assembly: System.Reflection.AssemblyFileVersion("${version}.0")]\n`);
const setup = join(desktopDir, 'release', `EasyHub-${version}-setup.exe`);
const icon = join(desktopDir, 'resources', 'easyhub.ico');
const compile = spawnSync(join(framework, 'csc.exe'), [
  '/nologo', '/codepage:65001', '/target:winexe', '/platform:x64', '/optimize+', `/out:${setup}`,
  `/win32icon:${icon}`, `/resource:${core},EasyHub.CoreInstaller`,
  `/resource:${icon},EasyHub.Icon`, ...references.map((reference) => `/r:${reference}`),
  join(desktopDir, 'installer-native', 'Program.cs'), assemblyInfo,
], { cwd: desktopDir, stdio: 'inherit', windowsHide: true });
if (compile.status !== 0) process.exit(compile.status ?? 1);
await Promise.all([rm(core), rm(`${core}.blockmap`, { force: true })]);
