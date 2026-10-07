import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { constants } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const command = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
// Install this file in apps/desktop/scripts alongside the Windows recipes.
const desktopRoot = resolve(dirname(scriptPath), '..');
const archiveName = 'easyhub-java-21.0.12.1-mac-arm64-v1.tar.gz';
const imageName = 'java-21.0.12.1-mac-arm64-v1';
const officialArchiveName = 'OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.12.1_1.tar.gz';
const officialDigest = '3623232f33a9c3baadf304480b2535f9a3cba8a58d42ecbb438ba267315d9998';
const officialBytes = 200073404;
const releaseTag = 'jdk-21.0.12.1+1';
const sourceArchive = {
  name: 'OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz', bytes: 115126841,
  sha256: '573057d03584ae793fb7ec9a14c76d826d9187a53efeefd99da47403a5308234',
  url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz',
};
const usage = 'Usage: node scripts/prepare-mac-java.mjs --runtime-root <absolute Ghidra/MCP runtime root> --archive <absolute official JDK TAR.GZ> [--output <absolute directory>]';
if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log(usage + '\nDefault output: apps/desktop/out/analysis-components. Requires Node 20+, Python 3, and an Apple Silicon Mac.');
  process.exit(0);
}
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]; const value = process.argv[index + 1];
  const normalized = key === '--output-root' ? '--output' : key;
  if (!['--runtime-root', '--archive', '--output'].includes(normalized) || !value || !isAbsolute(value) || options.has(normalized)) {
    throw new Error(usage + '; inputs/output must be absolute paths and each option may appear only once.');
  }
  options.set(normalized, resolve(value));
}
const runtimeRoot = options.get('--runtime-root');
const officialArchive = options.get('--archive');
if (!runtimeRoot || !officialArchive) throw new Error('--runtime-root and --archive are required. ' + usage);
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build and verification require an Apple Silicon Mac.');
const outputRoot = options.get('--output') ?? join(desktopRoot, 'out', 'analysis-components');
const ghidra = join(runtimeRoot, 'ghidra');
const extension = join(runtimeRoot, 'extension');
const image = join(outputRoot, imageName);
const archive = join(outputRoot, archiveName);
const manifestFile = join(outputRoot, 'java-21.0.12.1-mac-arm64-v1.manifest.json');
const fixedTimestamp = Date.UTC(2026, 7, 18, 0, 0, 0) / 1000;

async function run(executable, args, overrides = {}) {
  const environment = { ...process.env, LANG: 'C', LC_ALL: 'C' };
  for (const key of Object.keys(environment)) if (/^(JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|CLASSPATH)$/iu.test(key)) delete environment[key];
  return command(executable, args, { shell: false, maxBuffer: 16 * 1024 ** 2, timeout: 240000, env: environment, ...overrides });
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function filesBelow(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${relative(directory, path)}`);
    if (entry.isDirectory()) paths.push(...await filesBelow(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function javaArgument(value) { return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`; }
function portable(path, jdk, temporaryImage) {
  return path.replaceAll(jdk, '$OFFICIAL_JDK').replaceAll(temporaryImage, '$OUTPUT_IMAGE')
    .replaceAll(ghidra, '$GHIDRA').replaceAll(extension, '$MCP_EXTENSION');
}
async function isMachO(path) {
  const handle = await open(path, 'r');
  try { const bytes = Buffer.alloc(4); const { bytesRead } = await handle.read(bytes, 0, 4, 0);
    return bytesRead === 4 && ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(bytes.toString('hex')); }
  finally { await handle.close(); }
}
function octal(buffer, offset, length, number) {
  const value = Math.floor(number).toString(8).padStart(length - 1, '0') + '\0';
  if (value.length > length) throw new Error('Archive numeric field overflow');
  buffer.write(value, offset, length, 'ascii');
}
function tarHeader(name, bytes, mode, type = '0') {
  const header = Buffer.alloc(512);
  let basename = name; let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const slash = name.lastIndexOf('/'); prefix = name.slice(0, slash); basename = name.slice(slash + 1);
    if (slash < 0 || Buffer.byteLength(prefix) > 155 || Buffer.byteLength(basename) > 100) throw new Error(`USTAR path too long: ${name}`);
  }
  header.write(basename, 0, 100); octal(header, 100, 8, mode); octal(header, 108, 8, 0); octal(header, 116, 8, 0);
  octal(header, 124, 12, bytes); octal(header, 136, 12, fixedTimestamp); header.fill(0x20, 148, 156);
  header.write(type, 156, 1); header.write('ustar\0', 257, 6); header.write('00', 263, 2); header.write(prefix, 345, 155);
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0');
  header.write(checksum + '\0 ', 148, 8, 'ascii'); return header;
}
async function deterministicArchive(directory, destination) {
  const files = await filesBelow(directory);
  const members = [];
  const directories = new Set([imageName]);
  for (const file of files) {
    const name = `${imageName}/${relative(directory, file).split(sep).join('/')}`;
    let parent = dirname(name);
    while (parent !== '.') { directories.add(parent); parent = dirname(parent); }
    members.push({ name, file });
  }
  const entries = [...directories].map(name => ({ name: name + '/', directory: true }))
    .concat(members).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  async function* tarBytes() {
    for (const entry of entries) {
      if (entry.directory) { yield tarHeader(entry.name, 0, 0o755, '5'); continue; }
      const info = await stat(entry.file); yield tarHeader(entry.name, info.size, info.mode & 0o111 ? 0o755 : 0o644);
      for await (const bytes of createReadStream(entry.file)) yield bytes;
      if (info.size % 512) yield Buffer.alloc(512 - info.size % 512);
    }
    yield Buffer.alloc(1024);
  }
  await pipeline(Readable.from(tarBytes()), createGzip({ level: 9 }), createWriteStream(destination, { flags: 'wx', mode: 0o644 }));
}

await mkdir(outputRoot, { recursive: true });
if ([image, archive, manifestFile].some(path => path === outputRoot)) throw new Error('Invalid output path');
for (const path of [image, archive, manifestFile, `${archive}.sha256`]) if (await exists(path)) throw new Error(`Refusing to replace existing v1 artifact: ${path}`);
if ((await stat(officialArchive)).size !== officialBytes || await digest(officialArchive) !== officialDigest) throw new Error('Official ARM64 JDK archive differs from its pinned size/SHA-256.');
const staging = await mkdtemp(join(outputRoot, '.java-mac-stage-'));
const original = join(staging, 'official-jdk'); await mkdir(original);
// The input archive is checksum-pinned to the fixed official release. Never download,
// install into /Library/Java, modify the cached archive, or use an ambient Java runtime.
await run('/usr/bin/tar', ['-xzf', officialArchive, '-C', original]);
const jdk = join(original, 'jdk-21.0.12.1+1', 'Contents', 'Home');
const upstreamRelease = await readFile(join(jdk, 'release'), 'utf8');
if (!/^JAVA_VERSION="21\.0\.12\.1"\s*$/mu.test(upstreamRelease) || !/^OS_ARCH="aarch64"\s*$/mu.test(upstreamRelease)
  || !/^OS_NAME="Darwin"\s*$/mu.test(upstreamRelease)) throw new Error('Expected Temurin 21.0.12.1+1 for Darwin ARM64.');
const property = key => upstreamRelease.match(new RegExp(`^${key}="([^"\\r\\n]+)"`, 'm'))?.[1];
const upstreamSourceCommit = property('SOURCE')?.split(':').at(-1);
const upstreamBuildCommit = property('BUILD_SOURCE')?.replace(/^git:/u, '');
if (upstreamSourceCommit !== '1c417fbfc2f7' || upstreamBuildCommit !== 'e6ba7dec3d07654074559310376a3ae89da5f4ac') throw new Error('Source provenance differs from the fixed release.');
const classpath = [];
for (const group of ['Framework', 'Features', 'Processors']) {
  const groupRoot = join(ghidra, 'Ghidra', group);
  for (const module of await readdir(groupRoot, { withFileTypes: true })) {
    if (!module.isDirectory()) continue;
    const library = join(groupRoot, module.name, 'lib');
    if (!await exists(library)) continue;
    classpath.push(...(await readdir(library, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.jar'))
      .map(entry => join(library, entry.name)));
  }
}
const plugin = join(extension, 'lib', 'GhidraMCP-6.0.0.jar'); await access(plugin, constants.R_OK);
if ((await stat(plugin)).size !== 739004 || await digest(plugin) !== 'b652a23b433786ac2e51e650fb6020cfdbb8743db6f58f16531fcac010d13522') throw new Error('Expected the fixed GhidraMCP 6.0.0 extension JAR.');
if (!/^application.version=12\.1\.2\s*$/mu.test(await readFile(join(ghidra, 'Ghidra', 'application.properties'), 'utf8'))) throw new Error('Expected Ghidra 12.1.2 runtime data.');
const inputs = [...classpath, plugin].sort();
// Ghidra loads these libraries on a flat classpath. Some third-party JARs have
// module-info requiring optional named modules not delivered by Ghidra; jdeps
// otherwise resolves those descriptors as module-path requirements before its
// --ignore-missing-deps class handling. Inspect copies without those descriptors,
// preserving every class byte. These scan-only copies are never distributed.
const scanRoot = join(staging, 'jdeps-classpath'); await mkdir(scanRoot);
const scanMap = inputs.map((path, index) => ({ source: path, destination: join(scanRoot, `${String(index).padStart(4, '0')}.jar`) }));
const scanMapFile = join(staging, 'jdeps-classpath.json'); await writeFile(scanMapFile, JSON.stringify(scanMap));
const scanScript = String.raw`
import json, sys, zipfile
items = json.load(open(sys.argv[1], encoding='utf-8'))
removed = 0
classes = 0
for item in items:
    with zipfile.ZipFile(item['source']) as source, zipfile.ZipFile(item['destination'], 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as output:
        for member in source.infolist():
            if member.filename == 'module-info.class' or member.filename.endswith('/module-info.class'):
                removed += 1
                continue
            data = source.read(member.filename)
            output.writestr(member, data)
            if member.filename.endswith('.class'):
                classes += 1
print(json.dumps({'jars':len(items),'moduleDescriptorsRemoved':removed,'unmodifiedClassEntries':classes}))
`;
const scanResult = await run('/usr/bin/python3', ['-c', scanScript, scanMapFile]);
const scanSummary = JSON.parse(scanResult.stdout.trim());
const scanInputs = scanMap.map(item => item.destination);
const jdepsArguments = ['--ignore-missing-deps', '--multi-release', '21', '--recursive', '--print-module-deps', '--class-path', scanInputs.join(delimiter), ...scanInputs];
const jdepsArgfile = join(staging, 'jdeps.args');
await writeFile(jdepsArgfile, ['--module', 'jdk.jdeps/com.sun.tools.jdeps.Main', ...jdepsArguments].map(javaArgument).join('\n'));
console.log(`Inspecting all ${inputs.length} Ghidra/MCP runtime JARs with jdeps...`);
const jdepsResult = await run(join(jdk, 'bin', 'java'), [`@${jdepsArgfile}`]);
await writeFile(join(staging, 'jdeps-output.txt'), jdepsResult.stdout + jdepsResult.stderr);
const dependencyLine = jdepsResult.stdout.trim().split(/\r?\n/u).findLast(line => /^[a-z][a-z0-9.,]+$/u.test(line) && line.includes('java.base'));
if (!dependencyLine) throw new Error(`jdeps did not return module dependencies: ${jdepsResult.stdout.slice(-2000)}`);
const staticModules = dependencyLine.split(',');
const dynamicModuleReasons = {
  'jdk.compiler': 'Ghidra requires a JDK; retain javac and the ToolProvider compiler implementation.',
  'jdk.httpserver': 'The fixed Ghidra MCP headless engine embeds com.sun.net.httpserver.',
  'jdk.zipfs': 'Retain ZIP/JAR filesystem service discovery used by compiler and resource loading.',
  'jdk.unsupported': 'Runtime libraries use Unsafe and reflection compatibility paths.',
  'jdk.crypto.ec': 'Retain elliptic-curve TLS/signature providers loaded by service discovery.',
  'jdk.charsets': 'Retain GBK, windows-1252 and other extended input encodings.',
  'jdk.localedata': 'Retain English and Chinese locale providers.',
};
const rootModules = [...new Set([...staticModules, ...Object.keys(dynamicModuleReasons)])].sort();
if (rootModules.includes('jdk.crypto.mscapi')) throw new Error('Windows-only MSCAPI must not enter the macOS image.');
const temporaryImage = join(staging, imageName);
const temporaryHome = join(temporaryImage, 'Contents', 'Home');
await mkdir(dirname(temporaryHome), { recursive: true });
const jlinkArguments = ['--module-path', join(jdk, 'jmods'), '--add-modules', rootModules.join(','), '--strip-debug',
  '--no-header-files', '--no-man-pages', '--compress=zip-6', '--include-locales=en,zh', '--output', temporaryHome];
console.log(`Linking ${rootModules.length} root modules: ${rootModules.join(',')}`);
await run(join(jdk, 'bin', 'jlink'), jlinkArguments);
await copyFile(join(jdk, 'NOTICE'), join(temporaryHome, 'NOTICE'));
await copyFile(join(jdk, 'release'), join(temporaryHome, 'upstream-release'));
const linkedModules = (await run(join(temporaryHome, 'bin', 'java'), ['--list-modules'])).stdout.trim().split(/\r?\n/u).map(line => line.split('@')[0]).sort();
for (const module of Object.keys(dynamicModuleReasons)) if (!linkedModules.includes(module)) throw new Error(`Required module omitted: ${module}`);
// Locale stripping may omit legal/jdk.localedata. Retain every selected module's
// unmodified full license material explicitly, including GPL/ClassPath notices.
let legalFiles = 0;
for (const module of linkedModules) {
  const upstreamLegal = join(jdk, 'legal', module);
  for (const file of await filesBelow(upstreamLegal)) {
    const target = join(temporaryHome, 'legal', module, relative(upstreamLegal, file));
    await mkdir(dirname(target), { recursive: true });
    // jlink creates existing license entries read-only. Only mutate permissions
    // inside this isolated output so the full upstream notices can be restored.
    if (await exists(target)) {
      // jlink deduplicates common licenses with relative symlinks. Replace only
      // those output links, without following them, for the app's safe extractor.
      if ((await lstat(target)).isSymbolicLink()) await unlink(target);
      else await chmod(target, 0o644);
    }
    await copyFile(file, target); await chmod(target, 0o644); legalFiles++;
  }
}
const probeSource = `import javax.tools.ToolProvider;
import java.nio.charset.Charset;
import java.text.DateFormat;
import java.util.Locale;
import java.util.TimeZone;
import java.util.Date;
public class CompilerProbe {
  public static void main(String[] args) {
    if (ToolProvider.getSystemJavaCompiler() == null) throw new IllegalStateException("Compiler missing");
    try {
      java.nio.file.Path source = java.nio.file.Files.createTempDirectory("tool-provider-probe").resolve("ProviderProbe.java");
      java.nio.file.Files.writeString(source, "public class ProviderProbe { public static int add(int a,int b) { return a+b; } }");
      if (ToolProvider.getSystemJavaCompiler().run(null, null, null, "-encoding", "UTF-8", source.toString()) != 0) throw new IllegalStateException("ToolProvider compiler failed");
      if (!java.nio.file.Files.exists(source.resolveSibling("ProviderProbe.class"))) throw new IllegalStateException("ToolProvider class missing");
    } catch (java.io.IOException e) { throw new IllegalStateException(e); }
    String phrase = "程序审查";
    if (!phrase.equals(new String(phrase.getBytes(Charset.forName("GBK")), Charset.forName("GBK")))) throw new IllegalStateException("GBK roundtrip failed");
    System.out.println("compiler-ready:" + Charset.forName("GBK").name());
    for (String language : new String[]{"en-US", "zh-CN"}) {
      DateFormat format = DateFormat.getDateInstance(DateFormat.LONG, Locale.forLanguageTag(language));
      format.setTimeZone(TimeZone.getTimeZone("UTC"));
      System.out.println(language + ":" + format.format(new Date(0)));
    }
  }
}`;
const compilerProbe = join(staging, 'CompilerProbe.java'); await writeFile(compilerProbe, probeSource);
await run(join(temporaryHome, 'bin', 'javac'), ['-encoding', 'UTF-8', '-d', staging, compilerProbe]);
const compilerResult = await run(join(temporaryHome, 'bin', 'java'), [`-Djava.io.tmpdir=${staging}`, '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-cp', staging, 'CompilerProbe']);
if (!compilerResult.stdout.includes('compiler-ready:GBK') || !compilerResult.stdout.includes('en-US:January 1, 1970') || !compilerResult.stdout.includes('zh-CN:1970年1月1日')) throw new Error('Compiler/GBK/locale verification failed.');
const nativeChecks = [];
for (const file of await filesBelow(temporaryImage)) {
  if (!await isMachO(file)) continue;
  const architecture = (await run('/usr/bin/lipo', ['-archs', file])).stdout.trim();
  if (architecture !== 'arm64') throw new Error(`Unexpected runtime architecture: ${relative(temporaryImage, file)}: ${architecture}`);
  // jlink copies signed upstream Mach-O launchers/libraries unchanged. Verify
  // rather than silently replacing the official upstream signatures.
  await run('/usr/bin/codesign', ['--verify', '--strict', file]);
  nativeChecks.push({ path: relative(temporaryImage, file).split(sep).join('/'), architecture, signature: 'strict verification passed', sha256: await digest(file) });
}
const jmods = [];
for (const module of linkedModules) jmods.push({ module, sha256: await digest(join(jdk, 'jmods', `${module}.jmod`)) });
const jarInputs = [];
for (const path of inputs) jarInputs.push({ path: portable(path, jdk, temporaryImage), sha256: await digest(path), bytes: (await stat(path)).size });
const buildInfo = {
  schema: 1, artifact: archiveName, directory: imageName, javaHome: 'Contents/Home', platform: 'darwin', architecture: 'arm64', version: '21.0.12.1+1',
  upstream: { archive: officialArchiveName, bytes: officialBytes, sha256: officialDigest, sourceTag: releaseTag,
    url: `https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/${officialArchiveName}` },
  correspondingSource: sourceArchive, upstreamSourceCommit, upstreamBuildCommit,
  license: 'GPL-2.0 with Classpath Exception; full selected-module legal files and NOTICE preserved',
  staticModules, dynamicModuleReasons, rootModules, linkedModules, sourceJmods: jmods, jarInputs,
  classpathInspection: { ...scanSummary, descriptorRemovalScope: 'Scratch JAR copies for jdeps only; every class byte unchanged. Original Ghidra/MCP JARs are read-only and used for real execution.' },
  jlinkArguments: jlinkArguments.map(value => portable(value, jdk, temporaryImage)),
  jdepsArguments: jdepsArguments.map(value => portable(value, jdk, temporaryImage).replaceAll(scanRoot, '$JDEPS_CLASSPATH')),
  preparationScriptSha256: await digest(scriptPath), tarTimestampUtc: '2026-08-18T00:00:00Z', legalFiles,
  verification: { compiler: true, toolProvider: true, gbkRoundtrip: true, englishLocale: true, chineseLocale: true,
    compilerProbe: compilerResult.stdout.trim(), nativeMachO: nativeChecks,
    headlessGhidra: 'Not claimed here. Root verification combines this image with the separately slimmed Mac Ghidra.' },
};
const sourceNotice = `# Corresponding Java source\n\nThis image was linked from the unmodified, SHA-256 verified official Eclipse Temurin 21.0.12.1+1 JDK for macOS ARM64. No Java source was changed. Original selected-module licenses and NOTICE accompany this image.\n\nOriginal complete binary distribution:\n${buildInfo.upstream.url}\nSHA-256: ${officialDigest}\n\nCorresponding unmodified upstream Java source archive:\n${sourceArchive.url}\nBytes: ${sourceArchive.bytes}\nSHA-256: ${sourceArchive.sha256}\n\nExact upstream Java source revision:\nhttps://github.com/adoptium/jdk21u/tree/${upstreamSourceCommit}\nExact Temurin build-script revision:\nhttps://github.com/adoptium/temurin-build/tree/${upstreamBuildCommit}\n\nGPL-2.0 and Classpath Exception are included in legal/java.base/LICENSE and legal/java.base/ADDITIONAL_LICENSE_INFO. The upstream legal material of every selected module is retained. easyhub-runtime-build.json records every input JMOD hash, input Ghidra/MCP JAR hash, selected modules and jlink flags. build-support/prepare-mac-java.mjs is the complete preparation script.\n\nBuild locally from the complete pinned official JDK archive and fixed Ghidra/MCP installation:\nnode scripts/prepare-mac-java.mjs --runtime-root /absolute/path/to/runtime --archive /absolute/path/to/${officialArchiveName}\n\nThe listed corresponding-source archive must be offered alongside the runtime when publishing this locally generated artifact. This preparation script does not publish any artifacts. Same-image deterministic compression is verified; independent jlink invocations are not claimed to be byte-identical.\n`;
await writeFile(join(temporaryImage, 'SOURCE.md'), sourceNotice.replaceAll('legal/java.base/', 'Contents/Home/legal/java.base/'));
await mkdir(join(temporaryImage, 'build-support')); await copyFile(scriptPath, join(temporaryImage, 'build-support', 'prepare-mac-java.mjs'));
await writeFile(join(temporaryImage, 'easyhub-runtime-build.json'), JSON.stringify(buildInfo, null, 2) + '\n');
const temporaryArchive = join(staging, archiveName); await deterministicArchive(temporaryImage, temporaryArchive);
const temporaryRepro = join(staging, 'reproducibility-check.tar.gz'); await deterministicArchive(temporaryImage, temporaryRepro);
const archiveDigest = await digest(temporaryArchive);
if (archiveDigest !== await digest(temporaryRepro)) throw new Error('Fixed-image deterministic archive verification failed.');
const files = await filesBelow(temporaryImage); let unpackedBytes = 0;
for (const path of files) unpackedBytes += (await stat(path)).size;
const result = { ...buildInfo, path: archive, image, bytes: (await stat(temporaryArchive)).size, sha256: archiveDigest, unpackedBytes,
  compressionRatioComparedToOfficial: (await stat(temporaryArchive)).size / officialBytes,
  deterministicArchive: true, validationScope: 'Same-image archive bytes reproduced twice; not a claim that independent jlink invocations are byte-identical.',
  stagingKeptForDiagnostics: staging };
await rename(temporaryImage, image); await rename(temporaryArchive, archive);
await writeFile(manifestFile, JSON.stringify(result, null, 2) + '\n');
await writeFile(`${archive}.sha256`, `${archiveDigest}  ${archiveName}\n`);
// The build manifest above is the report. No repository docs or application state is mutated.
console.log(JSON.stringify({ image, archive, bytes: result.bytes, sha256: archiveDigest, unpackedBytes, linkedModules: linkedModules.length,
  compilerProbe: compilerResult.stdout.trim(), legalFiles, nativeMachOFiles: nativeChecks.length, deterministicArchive: true }, null, 2));
