import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(desktopRoot, 'out', 'analysis-components');
const imageName = 'java-21.0.12.1-win-x64-v1';
const archiveName = 'easyhub-java-21.0.12.1-win-x64-v1.zip';
const sourceArchiveSha256 = 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e';
const correspondingSource = {
  url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz',
  bytes: 115126841,
  sha256: '573057d03584ae793fb7ec9a14c76d826d9187a53efeefd99da47403a5308234',
};
const packageRequire = createRequire(join(desktopRoot, 'package.json'));
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!['--source-root', '--verify-ghidra'].includes(key) || !value || options.has(key)) {
    throw new Error('Usage: node scripts/prepare-analysis-java.mjs --source-root <installed runtime root> [--verify-ghidra <Ghidra root>]');
  }
  options.set(key, value);
}
const sourceRoot = options.get('--source-root');
if (!sourceRoot || !isAbsolute(sourceRoot)) throw new Error('--source-root must be the absolute installed runtime root');
const installedJdk = join(sourceRoot, 'java');
let jdk;
const ghidra = options.get('--verify-ghidra') ?? join(sourceRoot, 'ghidra');
const extension = join(sourceRoot, 'extension');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This artifact is built and verified on Windows x64');

async function command(executable, args, options = {}) {
  return exec(executable, args, { shell: false, windowsHide: true, maxBuffer: 8 * 1024 ** 2, timeout: 240_000, ...options });
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symbolic link in build input: ${entry.name}`);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function javaArgument(value) { return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`; }

await mkdir(outputRoot, { recursive: true });
const image = join(outputRoot, imageName);
const archive = join(outputRoot, archiveName);
if (await exists(image) || await exists(archive)) throw new Error('The v1 Java artifact already exists; preserve it or choose a new artifact version');
const staging = await mkdtemp(join(outputRoot, '.java-stage-'));
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
let published = false;
try {
  const upstreamRelease = await readFile(join(installedJdk, 'release'), 'utf8');
  if (!/^JAVA_VERSION="21\.0\.12\.1"\s*$/m.test(upstreamRelease) || !/^OS_ARCH="x86_64"\s*$/m.test(upstreamRelease)) {
    throw new Error('Expected the installed Temurin 21.0.12.1+1 Windows x64 JDK');
  }
  const manifest = JSON.parse(await readFile(join(sourceRoot, 'installation.json'), 'utf8'));
  if (!manifest.artifacts?.some(item => item.id === 'java' && item.sha256 === sourceArchiveSha256)) {
    throw new Error('Installed runtime lacks the pinned upstream JDK provenance');
  }
  const cachedSourceArchive = join(resolve(sourceRoot, '../..'), 'validated-official-archives', 'OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip');
  if (!await exists(cachedSourceArchive) || await digest(cachedSourceArchive) !== sourceArchiveSha256) {
    throw new Error('The complete cached official JDK archive is required and must match its pinned checksum');
  }
  const sourceArchiveVerified = true;
  const sourceExtraction = join(staging, 'official-jdk');
  await mkdir(sourceExtraction);
  console.log('Using checksum-verified official JDK ZIP as the build input...');
  const extractionScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($env:EASYHUB_JAVA_BUILD_SOURCE).TrimEnd('\') + '\'
$zip = [IO.Compression.ZipFile]::OpenRead($env:EASYHUB_JAVA_SOURCE_ZIP)
try {
  [long]$total = 0
  foreach ($entry in $zip.Entries) {
    if ([IO.Path]::IsPathRooted($entry.FullName) -or $entry.FullName.Contains(':')) { throw 'Invalid JDK archive entry' }
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $entry.FullName.Replace('/', '\')))
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'JDK archive entry escapes stage' }
    if (($entry.ExternalAttributes -band 0xF0000000) -eq 0xA0000000) { throw 'JDK archive symbolic link rejected' }
    $total += $entry.Length
    if ($total -gt 536870912) { throw 'JDK archive exceeds expected extraction size' }
  }
} finally { $zip.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($env:EASYHUB_JAVA_SOURCE_ZIP, $env:EASYHUB_JAVA_BUILD_SOURCE)
`;
  await command(powershell, ['-NoProfile', '-NonInteractive', '-Command', extractionScript], { env: { ...process.env,
    EASYHUB_JAVA_BUILD_SOURCE: sourceExtraction, EASYHUB_JAVA_SOURCE_ZIP: cachedSourceArchive } });
  const sourceDirectories = await readdir(sourceExtraction, { withFileTypes: true });
  if (sourceDirectories.length !== 1 || !sourceDirectories[0].isDirectory()) throw new Error('Unexpected official JDK ZIP layout');
  jdk = join(sourceExtraction, sourceDirectories[0].name);
  if (await readFile(join(jdk, 'release'), 'utf8') !== upstreamRelease) throw new Error('Installed JDK release differs from the official build source');

  const classpath = [];
  for (const group of ['Framework', 'Features', 'Processors']) {
    classpath.push(...(await filesBelow(join(ghidra, 'Ghidra', group))).filter(path => path.endsWith('.jar') && path.includes(`${sep}lib${sep}`)));
  }
  const plugin = join(extension, 'lib', 'GhidraMCP-6.0.0.jar');
  const jdepsArguments = ['--ignore-missing-deps', '--multi-release', '21', '--recursive', '--print-module-deps',
    '--class-path', classpath.join(';'), plugin];
  const jdepsArgfile = join(staging, 'jdeps.args');
  await writeFile(jdepsArgfile, ['--module', 'jdk.jdeps/com.sun.tools.jdeps.Main', ...jdepsArguments].map(javaArgument).join('\n'));
  console.log('Inspecting Ghidra/MCP Java module dependencies...');
  const jdepsResult = await command(join(jdk, 'bin', 'java.exe'), [`@${jdepsArgfile}`]);
  await writeFile(join(staging, 'jdeps-output.txt'), jdepsResult.stdout + jdepsResult.stderr);
  const dependencyLine = jdepsResult.stdout.trim().split(/\r?\n/).findLast(line => /^[a-z][a-z0-9.,]+$/.test(line) && line.includes('java.base'));
  if (!dependencyLine) throw new Error(`jdeps did not return a module dependency list: ${jdepsResult.stdout.slice(-2000)}`);
  const staticModules = dependencyLine.split(',');
  const dynamicModuleReasons = {
    'jdk.compiler': 'Ghidra requires a JDK; retain the actual javac implementation and ToolProvider compiler.',
    'jdk.httpserver': 'The MCP backend embeds com.sun.net.httpserver.',
    'jdk.zipfs': 'Retain the ZIP/JAR filesystem service used by compiler and resource loading.',
    'jdk.unsupported': 'Third party libraries use reflection and Unsafe compatibility paths.',
    'jdk.crypto.ec': 'Retain elliptic-curve security providers loaded by service discovery.',
    'jdk.crypto.mscapi': 'Retain the Windows security provider.',
    'jdk.charsets': 'Retain Windows and Chinese code pages, including GBK and windows-1252.',
    'jdk.localedata': 'Retain English and Chinese locale data for the desktop application.',
  };
  const rootModules = [...new Set([...staticModules, ...Object.keys(dynamicModuleReasons)])].sort();
  const temporaryImage = join(staging, imageName);
  const jlinkArguments = ['--module-path', join(jdk, 'jmods'), '--add-modules', rootModules.join(','),
    '--strip-debug', '--no-header-files', '--no-man-pages', '--compress=zip-6', '--include-locales=en,zh', '--output', temporaryImage];
  console.log(`Linking ${rootModules.length} root modules: ${rootModules.join(',')}`);
  await command(join(jdk, 'bin', 'jlink.exe'), jlinkArguments);
  await copyFile(join(jdk, 'NOTICE'), join(temporaryImage, 'NOTICE'));
  await copyFile(join(jdk, 'release'), join(temporaryImage, 'upstream-release'));
  const generatedRelease = await readFile(join(temporaryImage, 'release'), 'utf8');
  if (!/^JAVA_VERSION="21\.0\.12\.1"\s*$/m.test(generatedRelease)) throw new Error('jlink lost the required JAVA_VERSION release metadata');
  const linkedModulesResult = await command(join(temporaryImage, 'bin', 'java.exe'), ['--list-modules']);
  const linkedModules = linkedModulesResult.stdout.trim().split(/\r?\n/).map(value => value.split('@')[0]).sort();
  if (!linkedModules.includes('jdk.compiler') || !linkedModules.includes('jdk.httpserver')) throw new Error('Required compiler or HTTP server module missing');
  // jlink's locale filter can omit jdk.localedata/legal; preserve every selected module's upstream notices explicitly.
  for (const module of linkedModules) {
    const upstreamLegal = join(jdk, 'legal', module);
    for (const file of await filesBelow(upstreamLegal)) {
      const target = join(temporaryImage, 'legal', module, relative(upstreamLegal, file));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(file, target);
    }
  }

  // Verify javac itself and its ToolProvider API; an ordinary JRE is insufficient.
  const compilerProbe = join(staging, 'CompilerProbe.java');
  await writeFile(compilerProbe, 'import javax.tools.ToolProvider; import java.nio.charset.Charset; public class CompilerProbe { public static void main(String[] args) { if (ToolProvider.getSystemJavaCompiler() == null) throw new IllegalStateException("Compiler missing"); System.out.println("compiler-ready:" + Charset.forName("GBK").name()); } }');
  await command(join(temporaryImage, 'bin', 'javac.exe'), ['-d', staging, compilerProbe]);
  const compilerResult = await command(join(temporaryImage, 'bin', 'java.exe'), ['-cp', staging, 'CompilerProbe']);
  if (!compilerResult.stdout.includes('compiler-ready:GBK')) throw new Error('Linked compiler/charset probe failed');

  const esbuild = packageRequire(packageRequire.resolve('esbuild', { paths: [packageRequire.resolve('vite')] }));
  const backendModule = join(staging, 'backend.cjs');
  await esbuild.build({ entryPoints: [join(desktopRoot, 'src', 'main', 'analysis', 'GhidraBackend.ts')], outfile: backendModule,
    bundle: true, platform: 'node', format: 'cjs' });
  const { GhidraBackend } = packageRequire(backendModule);
  const sessionRoot = join(staging, 'smoke-session');
  await mkdir(sessionRoot);
  const input = join(sessionRoot, 'whoami.bin');
  await copyFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), input);
  const backend = new GhidraBackend({ mode: 'managed', javaPath: temporaryImage, ghidraHome: ghidra,
    pluginJar: extension, workspaceRoot: sessionRoot }, { startupTimeoutMs: 90_000, analysisTimeoutMs: 120_000 });
  let ready;
  let evidence;
  let cancellation = false;
  let cancelledPid;
  try {
    console.log('Running real Ghidra import, analysis and decompilation...');
    ready = await backend.start();
    evidence = await backend.analyze(input, { maxFunctions: 6, maxStrings: 24 });
    if (!(evidence.functionCount > 0) || !evidence.functions.some(item => item.code.trim().length > 20)) {
      throw new Error('Linked Java runtime did not produce real function/decompiler evidence');
    }
    cancelledPid = ready.pid;
    const abort = new AbortController();
    try {
      await backend.analyze(input, { signal: abort.signal, maxFunctions: 6, onProgress(progress) {
        if (progress.stage === 'analyzing') abort.abort();
      } });
      throw new Error('Real analysis cancellation unexpectedly completed');
    } catch (error) {
      if (error.code !== 'cancelled' || !abort.signal.aborted) throw error;
      cancellation = true;
    }
  } finally { await backend.stop(); }
  if (cancelledPid) {
    try { process.kill(cancelledPid, 0); throw new Error('Cancelled Ghidra JVM is still running'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const sourceJmods = [];
  for (const module of linkedModules) sourceJmods.push({ module, sha256: await digest(join(jdk, 'jmods', `${module}.jmod`)) });
  const releaseProperty = key => upstreamRelease.match(new RegExp(`^${key}="([^"\\r\\n]+)"`, 'm'))?.[1];
  const upstreamSourceCommit = releaseProperty('SOURCE')?.split(':').at(-1);
  const upstreamBuildCommit = releaseProperty('BUILD_SOURCE')?.replace(/^git:/, '');
  const workspaceCommit = (await command('git.exe', ['rev-parse', 'HEAD'], { cwd: desktopRoot })).stdout.trim();
  const normalizeArgument = value => value.replaceAll(jdk, '$OFFICIAL_JDK').replaceAll(temporaryImage, '$OUTPUT_IMAGE')
    .replaceAll(ghidra, '$GHIDRA').replaceAll(extension, '$MCP_EXTENSION');
  const buildInfo = {
    artifact: archiveName, directory: imageName, sourceTag: 'jdk-21.0.12.1+1', sourceArchiveSha256, sourceArchiveVerified,
    sourceUrl: 'https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.12.1%2B1',
    correspondingSource,
    license: 'GPL-2.0 with Classpath Exception; NOTICE and selected module legal files preserved',
    staticModules, dynamicModuleReasons, rootModules, linkedModules, sourceJmods,
    upstreamSourceCommit, upstreamBuildCommit, workspaceCommit,
    backendSourceSha256: await digest(join(desktopRoot, 'src', 'main', 'analysis', 'GhidraBackend.ts')),
    preparationScriptSha256: await digest(fileURLToPath(import.meta.url)),
    sourceBuildInputs: 'Extracted directly from the SHA-256 verified complete official JDK ZIP',
    jlinkArguments: jlinkArguments.map(normalizeArgument), jdepsArguments: jdepsArguments.map(normalizeArgument), zipTimestampUtc: '2026-08-18T00:00:00Z',
    verification: { backendVersion: ready.version, functionCount: evidence.functionCount,
      decompiledFunctions: evidence.functions.filter(item => item.code.trim()).map(item => ({ name: item.name, address: item.address, codeBytes: Buffer.byteLength(item.code) })),
      cancellation, cancelledJvmStopped: true, compilerProbe: compilerResult.stdout.trim() },
  };
  const sourceNotice = `# Corresponding Java runtime source\n\nThis image was linked from Eclipse Temurin 21.0.12.1+1 for Windows x64.\nThe upstream module license files are included under legal/ and the upstream NOTICE is preserved.\nJava source revision: ${upstreamSourceCommit}\nhttps://github.com/adoptium/jdk21u/tree/${upstreamSourceCommit}\nBuild scripts revision: ${upstreamBuildCommit}\nhttps://github.com/adoptium/temurin-build/tree/${upstreamBuildCommit}\nUpstream complete binary release and source distribution:\nhttps://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.12.1%2B1\n\nCorresponding unmodified upstream source archive:\n${correspondingSource.url}\nSize: ${correspondingSource.bytes} bytes\nSHA-256: ${correspondingSource.sha256}\n\nNo Java source was changed. The included easyhub-runtime-build.json records the jlink modules and options.\nThe complete EasyHub preparation script is included in build-support/prepare-analysis-java.mjs. Copy it to apps/desktop/scripts/prepare-analysis-java.mjs in an EasyHub checkout before running the manifest's reproduce command.\nThe workspace base commit is ${workspaceCommit}; the included script and its recorded SHA-256 identify the exact preparation source.\nGPL and the Classpath Exception are included in legal/java.base/LICENSE and legal/java.base/ADDITIONAL_LICENSE_INFO.\n`;
  await writeFile(join(temporaryImage, 'SOURCE.md'), sourceNotice);
  await mkdir(join(temporaryImage, 'build-support'));
  await copyFile(fileURLToPath(import.meta.url), join(temporaryImage, 'build-support', 'prepare-analysis-java.mjs'));
  await writeFile(join(temporaryImage, 'easyhub-runtime-build.json'), JSON.stringify(buildInfo, null, 2) + '\n');
  const temporaryArchive = join(staging, archiveName);
  const archiveScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = [IO.Path]::GetFullPath($env:EASYHUB_JAVA_IMAGE)
$prefix = $source.TrimEnd('\') + '\'
$archive = [IO.Path]::GetFullPath($env:EASYHUB_JAVA_ZIP)
$stream = [IO.File]::Open($archive, [IO.FileMode]::CreateNew)
$zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
  foreach ($file in ([IO.Directory]::EnumerateFiles($source, '*', [IO.SearchOption]::AllDirectories) | Sort-Object)) {
    if (-not $file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Build file escapes Java image' }
    $name = $env:EASYHUB_JAVA_NAME + '/' + $file.Substring($prefix.Length).Replace('\', '/')
    $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = [DateTimeOffset]::Parse('2026-08-18T00:00:00+00:00')
    $inputStream = [IO.File]::OpenRead($file)
    $outputStream = $entry.Open()
    try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
  }
} finally { $zip.Dispose(); $stream.Dispose() }
`;
  await command(powershell, ['-NoProfile', '-NonInteractive', '-Command', archiveScript], { env: { ...process.env,
    EASYHUB_JAVA_IMAGE: temporaryImage, EASYHUB_JAVA_ZIP: temporaryArchive, EASYHUB_JAVA_NAME: imageName } });
  await rename(temporaryImage, image);
  await rename(temporaryArchive, archive);
  published = true;
  const imageFiles = await filesBelow(image);
  let unpackedBytes = 0;
  for (const path of imageFiles) unpackedBytes += (await stat(path)).size;
  const result = { ...buildInfo, path: archive, bytes: (await stat(archive)).size, sha256: await digest(archive), unpackedBytes,
    legalFiles: imageFiles.filter(path => path.includes(`${sep}legal${sep}`)).length,
    reproduce: ['node', 'scripts/prepare-analysis-java.mjs', '--source-root', sourceRoot, '--verify-ghidra', ghidra] };
  await writeFile(join(outputRoot, 'java-21.0.12.1-win-x64-v1.manifest.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(join(outputRoot, `${archiveName}.sha256`), `${result.sha256}  ${archiveName}\n`);
  console.log(JSON.stringify({ path: result.path, bytes: result.bytes, sha256: result.sha256, unpackedBytes,
    modules: linkedModules.length, compiler: true, functionCount: result.verification.functionCount, cancellation }, null, 2));
} finally {
  const safe = resolve(staging);
  if (safe.startsWith(resolve(outputRoot) + sep) && relative(outputRoot, safe).startsWith('.java-stage-')) {
    await rm(safe, { recursive: true, force: true });
  }
  if (!published) console.error('Java artifact not published; source runtime was preserved.');
}
