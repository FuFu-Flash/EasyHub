import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// This repack uses only an already cached, complete official archive. It downloads nothing.
const VERSION = '12.1.2';
const SOURCE_NAME = 'ghidra_12.1.2_PUBLIC_20260605.zip';
const SOURCE_BYTES = 572_803_866;
const SOURCE_SHA256 = 'b62e81a0390618466c019c60d8c2f796ced2509c4c1aea4a37644a77272cf99d';
const SOURCE_URL = `https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.2_build/${SOURCE_NAME}`;
const ARCHIVE_ROOT = 'ghidra_12.1.2_PUBLIC/';
const IMAGE_NAME = 'ghidra-12.1.2-win-x64-v1';
const ZIP_NAME = 'easyhub-ghidra-12.1.2-win-x64-v1.zip';
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRequire = createRequire(join(desktopRoot, 'package.json'));
const exec = promisify(execFile);
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!['--archive', '--output', '--runtime-root', '--verify-java'].includes(key) || !value || options.has(key)) {
    throw new Error('Usage: node scripts/prepare-slim-ghidra.mjs --archive <official ZIP> --runtime-root <installed Java/MCP runtime> [--output <directory>] [--verify-java <Java root>]');
  }
  if (!isAbsolute(value)) throw new Error(`${key} requires an absolute path`);
  options.set(key, resolve(value));
}
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build and live verification require Windows x64');
const archive = options.get('--archive');
const runtimeRoot = options.get('--runtime-root');
if (!archive || !runtimeRoot) throw new Error('--archive and --runtime-root are required');
const outputRoot = options.get('--output') ?? join(desktopRoot, 'out', 'analysis-components');
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function command(script, environment, timeout = 240_000) {
  const pending = exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    shell: false, windowsHide: true, maxBuffer: 8 * 1024 ** 2, timeout,
    env: { ...process.env, ...environment },
  });
  // Windows PowerShell may enumerate its automatic $input variable at script completion.
  // Closing the unused redirected input prevents it waiting indefinitely for EOF.
  pending.child.stdin.end();
  return pending;
}
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Output unexpectedly contains a symbolic link');
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

const supportFiles = new Set(['analyzeHeadless', 'analyzeHeadless.bat', 'launch.bat', 'launch.sh',
  'launch.properties', 'LaunchSupport.jar', 'debug.log4j.xml', 'sleigh', 'sleigh.bat']);
function retentionRule(path) {
  // Keep legal material even inside an otherwise omitted source or documentation directory.
  if (/(^|\/)(licenses?|legal)(\/|$)/i.test(path)
      || /(^|\/)(LICENSE|NOTICE|COPYING|COPYRIGHT)([^/]*)(\/|$)/i.test(path)) return 'legal';
  if (path === 'bom.json' || path === 'Ghidra/application.properties') return 'metadata';
  // Retain GPL source alongside the native tools; only binaries for other hosts are omitted.
  if (path.startsWith('GPL/')) {
    if (/\/os\/[^/]+\//.test(path) && !path.includes('/os/win_x86_64/')) return null;
    return 'GPL native tools and corresponding source';
  }
  if (path.startsWith('Ghidra/Configurations/')) return 'configuration';
  if (path.startsWith('support/') && supportFiles.has(path.slice('support/'.length))) return 'headless launcher';
  const module = /^Ghidra\/(Framework|Features|Processors)\/[^/]+\/(.+)$/.exec(path);
  if (!module) return null;
  const member = module[2];
  if (member === 'Module.manifest') return 'module metadata';
  if (/^lib\/[^/]+\.jar$/i.test(member)) return 'runtime JAR';
  // All language/type/format/FID resources stay intact. YAJSW is a server service installer.
  if (member.startsWith('data/')) {
    if (path.startsWith('Ghidra/Features/GhidraServer/data/yajsw')) return null;
    return 'analysis data';
  }
  if (member.startsWith('os/win_x86_64/')) return 'Windows native runtime';
  return null;
}

await mkdir(outputRoot, { recursive: true });
const image = join(outputRoot, IMAGE_NAME);
const zip = join(outputRoot, ZIP_NAME);
if (await exists(image) || await exists(zip)) throw new Error('The v1 artifact already exists; preserve it or choose a new artifact version');
const stage = await mkdtemp(join(outputRoot, '.ghidra-stage-'));
const temporaryImage = join(stage, IMAGE_NAME);
await mkdir(temporaryImage);
console.log('Checking complete official Ghidra archive...');
if ((await stat(archive)).size !== SOURCE_BYTES || await digest(archive) !== SOURCE_SHA256) {
  throw new Error('The input is not the checksum-pinned complete Ghidra 12.1.2 official ZIP');
}

const inventoryPath = join(stage, 'upstream-entries.json');
await command(String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($env:EASYHUB_GHIDRA_SOURCE)
try {
  $items = @($zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') } | ForEach-Object {
    [pscustomobject]@{ path=$_.FullName; bytes=$_.Length; attributes=$_.ExternalAttributes }
  })
  $items | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $env:EASYHUB_GHIDRA_INVENTORY -Encoding UTF8
} finally { $zip.Dispose() }
`, { EASYHUB_GHIDRA_SOURCE: archive, EASYHUB_GHIDRA_INVENTORY: inventoryPath });
const inventory = JSON.parse((await readFile(inventoryPath, 'utf8')).replace(/^\uFEFF/, ''));
const seen = new Set();
const selected = [];
for (const entry of inventory) {
  if (!entry.path.startsWith(ARCHIVE_ROOT)) throw new Error('Unexpected official ZIP root');
  const path = entry.path.slice(ARCHIVE_ROOT.length);
  if (!path || /(^|\/)\.\.?($|\/)/.test(path) || /[\\:\0]/.test(path) || path.startsWith('/')) throw new Error('Invalid archive member path');
  const key = path.toLowerCase();
  if (seen.has(key)) throw new Error('Duplicate archive member rejected');
  seen.add(key);
  if (((entry.attributes >>> 16) & 0xf000) === 0xa000) throw new Error('Archive symbolic link rejected');
  const rule = retentionRule(path);
  if (rule) selected.push({ path, upstreamPath: entry.path, bytes: entry.bytes, rule });
}
selected.sort((a, b) => a.path.localeCompare(b.path, 'en'));
// Assert full analysis datasets survived the selection, independent of the PE smoke sample.
const mustKeep = inventory.filter(entry => /^ghidra_12\.1\.2_PUBLIC\/Ghidra\/(Processors\/[^/]+\/data\/|Features\/(Base|FunctionID)\/data\/)/.test(entry.path));
const selectedPaths = new Set(selected.map(entry => entry.upstreamPath));
if (mustKeep.some(entry => !selectedPaths.has(entry.path))) throw new Error('A processor, typeinfo or FunctionID dataset was lost');
const fidFiles = selected.filter(entry => entry.path.endsWith('.fidbf'));
if (fidFiles.length !== 10) throw new Error('Expected all ten delivered FunctionID databases');
const selectionPath = join(stage, 'selected-entries.json');
const sourceHashesPath = join(stage, 'upstream-member-hashes.json');
await writeFile(selectionPath, JSON.stringify(selected));
console.log(`Extracting ${selected.length} unchanged official files (${selected.reduce((sum, entry) => sum + entry.bytes, 0)} bytes)...`);
await command(String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($env:EASYHUB_GHIDRA_IMAGE).TrimEnd('\') + '\'
$zip = [IO.Compression.ZipFile]::OpenRead($env:EASYHUB_GHIDRA_SOURCE)
try {
  $proof = foreach ($item in (Get-Content -LiteralPath $env:EASYHUB_GHIDRA_SELECTION -Raw | ConvertFrom-Json)) {
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $item.path.Replace('/', '\')))
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Member escapes image' }
    $entry = $zip.GetEntry($item.upstreamPath)
    if ($null -eq $entry -or $entry.Length -ne $item.bytes) { throw 'Missing selected member' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    $input = $entry.Open()
    $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
      $buffer = New-Object byte[] 1048576
      while (($count = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $output.Write($buffer, 0, $count)
        $hash.TransformBlock($buffer, 0, $count, $buffer, 0) | Out-Null
      }
      $hash.TransformFinalBlock([byte[]]@(), 0, 0) | Out-Null
      [pscustomobject]@{ path=$item.path; sha256=([BitConverter]::ToString($hash.Hash).Replace('-', '').ToLowerInvariant()) }
    } finally { $hash.Dispose(); $output.Dispose(); $input.Dispose() }
  }
  $proof | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $env:EASYHUB_GHIDRA_HASHES -Encoding UTF8
} finally { $zip.Dispose() }
`, { EASYHUB_GHIDRA_SOURCE: archive, EASYHUB_GHIDRA_IMAGE: temporaryImage,
  EASYHUB_GHIDRA_SELECTION: selectionPath, EASYHUB_GHIDRA_HASHES: sourceHashesPath });
const hashes = new Map(JSON.parse((await readFile(sourceHashesPath, 'utf8')).replace(/^\uFEFF/, '')).map(item => [item.path, item.sha256]));
console.log('Comparing every extracted member with its official ZIP stream SHA256...');
for (const entry of selected) {
  const target = join(temporaryImage, entry.path);
  entry.sha256 = hashes.get(entry.path);
  if ((await stat(target)).size !== entry.bytes || await digest(target) !== entry.sha256) throw new Error('Extracted member differs from official ZIP stream');
}

const componentManifest = {
  schemaVersion: 1, component: 'ghidra', componentVersion: '1', ghidraVersion: VERSION, platform: 'win32', architecture: 'x64',
  upstream: { archive: SOURCE_NAME, bytes: SOURCE_BYTES, sha256: SOURCE_SHA256, url: SOURCE_URL, release: 'Ghidra_12.1.2_build' },
  build: { method: 'Selective extraction from SHA256-pinned complete official ZIP; every retained member independently SHA256-verified.', deterministicZipTimestamp: '2026-06-05T00:00:00Z' },
  preserved: ['All processor runtime JARs and language data', 'All Features and Framework runtime JARs',
    'All format analysis and Base typeinfo including Go, Windows, macOS, generic and Rust',
    'All ten delivered FunctionID databases and common-symbol data', 'Windows native decompiler, sleigh and GNU demanglers',
    'Module metadata and headless launcher', 'Legal files, licenses, original BOM, GPL tools and corresponding source'],
  excluded: ['Standalone documentation and examples', 'Extension installation ZIPs', 'Ghidra Debug modules',
    'Java source ZIPs, developer source and ghidra_scripts', 'Non-Windows native tools',
    'BSim PostgreSQL distribution and GhidraServer YAJSW service installer', 'PyGhidra Python wheels and packaging',
    'Docker and standalone server launch/configuration materials'],
  scope: 'Static import, general analysis and decompilation through the fixed EasyHub MCP adapter. GUI, debugging, extension installation, user scripts and standalone database/server management are outside this component.',
  licenses: ['LICENSE', 'NOTICE from the matching upstream source tag', 'licenses/', 'GPL/licenses/', 'All upstream LICENSE/NOTICE/COPYING/COPYRIGHT files wherever found', 'Unchanged runtime JARs retain embedded third-party notices'],
  fidDatabaseBytes: fidFiles.reduce((sum, entry) => sum + entry.bytes, 0),
  retainedUpstreamBytes: selected.reduce((sum, entry) => sum + entry.bytes, 0),
  upstreamFileCount: inventory.length, retainedFileCount: selected.length,
  files: selected,
};
// The binary release ZIP omits the root NOTICE. Preserve the matching tag's notice,
// byte for byte, with its independently checked source hash. This requires no network at build time.
const upstreamNotice = `Ghidra

This product includes software developed at National Security Agency
(https://www.nsa.gov)

Portions of this product were created by the U.S. Government and not subject to
U.S. copyright protections under 17 U.S.C.

The remaining portions are copyright their respective authors and have been
contributed under the terms of one or more open source licenses, and made
available to you under the terms of those licenses. (See LICENSE)



Licensing Intent

The intent is that this software and documentation ("Project") should be treated
as if it is licensed under the license associated with the Project ("License")
in the LICENSE file. However, because we are part of the United States (U.S.)
Federal Government, it is not that simple.

The portions of this Project written by U.S. Federal Government employees within
the scope of their federal employment are ineligible for copyright protection in
the U.S.; this is generally understood to mean that these portions of the
Project are placed in the public domain.

In countries where copyright protection is available (which does not include the
U.S.), contributions made by U.S. Federal Government employees are released
under the License. Merged contributions from private contributors are released
under the License.

The Ghidra software is released under the Apache License, Version 2.0
("Apache 2.0").

In addition, each module may contain numerous 3rd party components (libraries,
icons, etc.) that each have their own license which is compatible with Apache
2.0. Each module has a LICENSE.txt file that lists each license used in that
module and the 3rd party files that fall under that license. The license files
for each license used by Ghidra can be found in the licenses directory at the
installation root.

Also, in the GPL directory, there are several stand-alone support programs that
are released using the GPL 3 license.  Ghidra executes these programs as needed
and parses the output to get the desired results. There is a licenses directory
under the GPL directory that has the GPL license files.

Consistent with the inbound=outbound model, contributions to any module must be
made available, by the contributor, under the applicable license(s). Please read
the Legal section of the CONTRIBUTING.md guide.
`;
const noticeSha256 = 'ad4b2bb6e75e908251226180081b5afa01c7161d7710e08b603d0c340a08a23f';
if (createHash('sha256').update(upstreamNotice).digest('hex') !== noticeSha256) throw new Error('Embedded upstream NOTICE changed');
componentManifest.supplementalUpstreamFiles = [{ path: 'NOTICE', bytes: Buffer.byteLength(upstreamNotice), sha256: noticeSha256,
  url: 'https://raw.githubusercontent.com/NationalSecurityAgency/ghidra/Ghidra_12.1.2_build/NOTICE' }];
await writeFile(join(temporaryImage, 'NOTICE'), upstreamNotice);
await writeFile(join(temporaryImage, 'easyhub-component.json'), JSON.stringify(componentManifest, null, 2) + '\n');
await writeFile(join(temporaryImage, 'EASYHUB_COMPONENT_NOTICE.txt'), `EasyHub optional static analysis component\nGhidra ${VERSION}, Windows x64, repack version 1\n\nThis is a reduced distribution of the official NSA Ghidra archive, not an upstream release.\nNo upstream file retained in this component has been modified.\nSource: ${SOURCE_URL}\nFull official ZIP SHA256: ${SOURCE_SHA256}\n\nSee easyhub-component.json for exact retained files, hashes and omitted distribution materials.\nAll original license and notice files found in the official ZIP are retained. The original\nBOM is retained for legal provenance; the component manifest describes actual packaged files.\nGPL native tools retain their corresponding source and notices in GPL/.\n\nAll processor, type and format analysis data and all FunctionID databases are retained.\nThis component is for general static analysis and decompilation. It does not distribute\nstandalone debugging, GUI launchers, user scripts, Python wheels or database/server installers.\n`);

// Use the production backend and an inert copy of an OS binary; never execute the sample.
console.log('Running real headless import, analysis, decompile and cancellation verification...');
const ts = packageRequire('typescript');
const source = await readFile(join(desktopRoot, 'src', 'main', 'analysis', 'GhidraBackend.ts'), 'utf8');
const backendModule = join(stage, 'GhidraBackend.mjs');
await writeFile(backendModule, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
const { GhidraBackend, ghidraProcessRunner } = await import(pathToFileURL(backendModule).href);
const verificationRoot = join(stage, 'verification');
await mkdir(verificationRoot);
const sample = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe');
const sampleSha256 = await digest(sample);
const staged = join(verificationRoot, 'input.bin');
await copyFile(sample, staged);
const config = { mode: 'managed', javaPath: options.get('--verify-java') ?? join(runtimeRoot, 'java'),
  ghidraHome: temporaryImage, pluginJar: join(runtimeRoot, 'extension'), workspaceRoot: verificationRoot };
const ownedPids = [];
const runner = { start: async spec => { const process = await ghidraProcessRunner.start(spec); ownedPids.push(process.pid); return process; } };
const backend = new GhidraBackend(config, { runner });
const start = Date.now();
let ready;
let evidence;
let startupMs;
let analysisMs;
try {
  ready = await backend.start();
  startupMs = Date.now() - start;
  const analysisStart = Date.now();
  evidence = await backend.analyze(staged, { language: 'en', maxFunctions: 2, maxStrings: 8 });
  analysisMs = Date.now() - analysisStart;
  if (evidence.functionCount !== 338 || evidence.functions.length !== 2
      || evidence.functions.some(item => item.code.length < 10 || !/\([^]*\)\s*\{[^]*\}/.test(item.code))) {
    throw new Error(`Baseline changed: ${evidence.functionCount} functions, ${evidence.functions.length} decompiled samples`);
  }
} finally { await backend.stop(); }
const cancelRoot = join(verificationRoot, 'cancel');
await mkdir(cancelRoot);
const cancelledSample = join(cancelRoot, 'input.bin');
await copyFile(sample, cancelledSample);
const controller = new AbortController();
const cancelBackend = new GhidraBackend({ ...config, workspaceRoot: cancelRoot }, { runner });
let cancellationCode;
let cancelTimer;
const cancelStart = Date.now();
try {
  await cancelBackend.analyze(cancelledSample, { language: 'en', signal: controller.signal, onProgress: progress => {
    if (progress.stage === 'analyzing' && !cancelTimer) cancelTimer = setTimeout(() => controller.abort(), 500);
  } });
  throw new Error('Cancellation verification completed unexpectedly');
} catch (error) {
  cancellationCode = error.code;
  if (cancellationCode !== 'cancelled') throw error;
} finally { clearTimeout(cancelTimer); await cancelBackend.stop(); }
for (const pid of ownedPids) {
  if (!pid) throw new Error('Runner did not provide an owned PID');
  try { process.kill(pid, 0); throw new Error('Owned Java process survived stop'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
if (await digest(sample) !== sampleSha256 || await digest(staged) !== sampleSha256 || await digest(cancelledSample) !== sampleSha256) throw new Error('Static sample content changed');
const verification = { productionBackendSha256: await digest(join(desktopRoot, 'src', 'main', 'analysis', 'GhidraBackend.ts')),
  sample: 'Windows System32/whoami.exe copied as input.bin (never executed)', sampleSha256,
  format: evidence.format, architecture: evidence.architecture, functionCount: evidence.functionCount,
  decompiledFunctions: evidence.functions.map(item => ({ name: item.name, address: item.address, codeChars: item.code.length,
    codeSha256: createHash('sha256').update(item.code).digest('hex'), codePrefix: item.code.slice(0, 160) })),
  importCount: evidence.imports.length, stringCount: evidence.strings.length,
  startupMs, analysisMs, readiness: { status: ready.status, version: ready.version, capabilities: ready.capabilities },
  cancellation: { code: cancellationCode, elapsedMs: Date.now() - cancelStart, ownedProcessCount: ownedPids.length, allOwnedProcessesStopped: true },
  sampleUnchanged: true, allRetainedFilesMatchOfficialArchive: true };
await writeFile(join(stage, 'verification.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify(verification));

// Verify engine discovery did not change any packaged member before compression.
for (const entry of selected) if (await digest(join(temporaryImage, entry.path)) !== entry.sha256) throw new Error('Analysis changed a retained file');
const imageFiles = await filesBelow(temporaryImage);
if (imageFiles.length !== selected.length + 3) throw new Error('Analysis left an unexpected file in the component');
const fileListPath = join(stage, 'zip-files.json');
const zipFiles = imageFiles.map(path => ({ path, entry: `${IMAGE_NAME}/${path.slice(temporaryImage.length + 1).replaceAll('\\', '/')}` }));
await writeFile(fileListPath, JSON.stringify(zipFiles));
const temporaryZip = join(stage, ZIP_NAME);
console.log('Compressing deterministic ZIP after live verification...');
await command(String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$file = [IO.File]::Open($env:EASYHUB_GHIDRA_ZIP, [IO.FileMode]::CreateNew)
$zip = New-Object IO.Compression.ZipArchive($file, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
  foreach ($item in (Get-Content -LiteralPath $env:EASYHUB_GHIDRA_ZIP_FILES -Raw | ConvertFrom-Json)) {
    $entry = $zip.CreateEntry($item.entry, [IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = [DateTimeOffset]::Parse('2026-06-05T00:00:00+00:00')
    $input = [IO.File]::OpenRead($item.path)
    $output = $entry.Open()
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
  }
} finally { $zip.Dispose(); $file.Dispose() }
`, { EASYHUB_GHIDRA_ZIP: temporaryZip, EASYHUB_GHIDRA_ZIP_FILES: fileListPath });
const report = { artifact: ZIP_NAME, image: IMAGE_NAME, ghidraVersion: VERSION, componentVersion: '1',
  archiveBytes: (await stat(temporaryZip)).size, archiveSha256: await digest(temporaryZip),
  unpackedBytes: (await Promise.all(imageFiles.map(path => stat(path)))).reduce((sum, item) => sum + item.size, 0),
  packagedFileCount: imageFiles.length, upstreamArchiveBytes: SOURCE_BYTES, upstreamArchiveSha256: SOURCE_SHA256,
  retainedUpstreamBytes: componentManifest.retainedUpstreamBytes, fidDatabaseBytes: componentManifest.fidDatabaseBytes,
  verification, manifestSha256: await digest(join(temporaryImage, 'easyhub-component.json')) };
await rename(temporaryImage, image);
await rename(temporaryZip, zip);
await writeFile(join(outputRoot, 'easyhub-ghidra-12.1.2-win-x64-v1.build.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ image, zip, ...report }, null, 2));
// Keep the small stage with upstream inventory and verification evidence. No existing install is removed.
