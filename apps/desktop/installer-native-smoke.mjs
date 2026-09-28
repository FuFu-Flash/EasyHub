import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const desktop = process.cwd();
const { version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const setup = join(desktop, 'release', `EasyHub-${version}-setup.exe`);
const portable = join(desktop, 'release', `EasyHub-${version}-portable.exe`);
const screenshot = join(desktop, 'out', 'installer-native.png');
const setupSize = statSync(setup).size;
const portableSize = statSync(portable).size;

assert.ok(setupSize > 80 * 1024 * 1024, 'installer payload is missing');
assert.ok(setupSize - portableSize < 35 * 1024 * 1024,
  `installer adds ${((setupSize - portableSize) / 1048576).toFixed(1)} MiB above the portable app`);

execFileSync(setup, ['--screenshot', screenshot], { timeout: 20_000, windowsHide: true });
const image = readFileSync(screenshot);
assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.equal(image.readUInt32BE(16), 898);
assert.equal(image.readUInt32BE(20), 618);
assert.ok(image.length > 20_000, 'installer interface was not rendered');

const temporary = await mkdtemp(join(desktop, 'out', 'installer-test-'));
try {
  const framework = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const gac = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'assembly');
  const publicKey = 'v4.0_4.0.0.0__31bf3856ad364e35';
  const compiler = join(framework, 'csc.exe');
  const mock = join(temporary, 'mock-core.exe');
  const shell = join(temporary, 'installer-test.exe');
  const harness = join(temporary, 'harness.exe');
  const references = [
    join(gac, 'GAC_MSIL', 'PresentationFramework', publicKey, 'PresentationFramework.dll'),
    join(gac, 'GAC_64', 'PresentationCore', publicKey, 'PresentationCore.dll'),
    join(gac, 'GAC_MSIL', 'WindowsBase', publicKey, 'WindowsBase.dll'),
    join(framework, 'System.Xaml.dll'), join(framework, 'System.Windows.Forms.dll'),
  ];
  const source = join(desktop, 'installer-native');
  const icon = join(desktop, 'resources', 'easyhub.ico');
  const compile = (args) => execFileSync(compiler, ['/nologo', '/codepage:65001', ...args], { timeout: 20_000 });
  compile(['/target:winexe', `/out:${mock}`, join(source, 'MockCore.cs')]);
  compile(['/target:winexe', '/platform:x64', `/out:${shell}`, `/resource:${mock},EasyHub.CoreInstaller`,
    `/resource:${icon},EasyHub.Icon`, ...references.map((reference) => `/r:${reference}`), join(source, 'Program.cs')]);
  compile(['/target:exe', `/out:${harness}`, join(source, 'SmokeHarness.cs')]);
  execFileSync(harness, [shell, join(temporary, 'Install With Spaces')], { timeout: 20_000 });
} finally {
  assert.ok(temporary.startsWith(join(desktop, 'out', 'installer-test-')));
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Custom installer and embedded installation flow passed. Setup ${(setupSize / 1048576).toFixed(1)} MiB; portable ${(portableSize / 1048576).toFixed(1)} MiB.`);
