import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stage verified immutable release files locally. No GitHub requests or uploads.
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, '..');
const usage = 'Usage: node scripts/prepare-mac-analysis-release.mjs [--component-root <absolute directory>] [--output <absolute new staging directory>] [--java-source <absolute complete source TAR.GZ>]';
if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log(usage + '\nDefaults: desktop/out/analysis-components and its release-mac-arm64-v1 subdirectory. Source validation is optional because the matching complete source asset is already present on the same release.');
  process.exit(0);
}
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!['--component-root', '--output', '--java-source'].includes(key) || !value || !isAbsolute(value) || options.has(key)) throw new Error(usage);
  options.set(key, resolve(value));
}
const componentRoot = options.get('--component-root') ?? join(desktopRoot, 'out', 'analysis-components');
const output = options.get('--output') ?? join(componentRoot, 'release-mac-arm64-v1');
const manifest = JSON.parse(await readFile(join(scriptRoot, 'analysis-component-manifest-mac-arm64.json'), 'utf8'));
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function verified(path, expected) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== (expected.size ?? expected.bytes) || await digest(path) !== expected.sha256) throw new Error(`Pinned release asset differs: ${path}`);
}
if (await exists(output)) throw new Error(`Refusing to replace existing release staging: ${output}`);
const inputs = [];
for (const asset of manifest.assets) {
  let source = join(componentRoot, asset.name);
  if (!await exists(source)) source = join(componentRoot, asset.localSourceName);
  await verified(source, asset);
  inputs.push({ asset, source });
}
if (options.has('--java-source')) await verified(options.get('--java-source'), manifest.correspondingJavaSource);
await mkdir(dirname(output), { recursive: true });
const stage = await mkdtemp(join(dirname(output), '.mac-release-stage-'));
let published = false;
try {
  for (const { asset, source } of inputs) {
    const target = join(stage, asset.name);
    await copyFile(source, target);
    await verified(target, asset);
    await writeFile(target + '.sha256', `${asset.sha256}  ${asset.name}\n`, { flag: 'wx' });
  }
  const stagedManifest = { ...manifest, localPreparation: { binaryAssetsVerified: true, correspondingJavaSourceVerifiedLocally: options.has('--java-source'), correspondingJavaSourceCopiedOrUploaded: false } };
  await writeFile(join(stage, 'analysis-component-manifest-mac-arm64.json'), JSON.stringify(stagedManifest, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(stage, 'SHA256SUMS-mac-arm64.txt'), manifest.assets.map(asset => `${asset.sha256}  ${asset.name}`).join('\n') + '\n', { flag: 'wx' });
  for (const file of ['prepare-mac-ghidra.py', 'prepare-mac-java.mjs', 'prepare-mac-analysis-release.mjs', 'README-MAC-ANALYSIS-COMPONENTS.md']) await copyFile(join(scriptRoot, file), join(stage, file));
  await writeFile(join(stage, 'MAC_ARM64_RELEASE_NOTES.md'), [
    '## macOS Apple Silicon 精简组件',
    '新增 Mac ARM64 的 Ghidra 12.1.2 和 Java 21.0.12.1+1。应用首次安装下载约 264 MiB，包含仍使用上游固定版本的 Ghidra MCP 6.0.0。',
    '保留所有 39 个处理器的数据、10 个函数识别数据库、136 个 Ghidra 运行时 JAR 和反编译工具；Java 保留 34 个模块、编译器、扩展字符集、中文区域和动态服务提供器。',
    'Mach-O ARM64、ELF x86_64、PE x86_64 样本的函数、字符串、导入和反编译结果与完整组件一致，已验证取消和生产归档解压。完整数据保留不等同于每种格式均已执行测试。',
    '原始许可证、NOTICE、BOM、GPL 工具对应源码和 Java 准备记录随包提供。完整 Java 源码沿用本发布已有的 OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz 附件，不参与应用运行时下载。',
    '新增仓库脚本使用绝对输入路径，无本机用户目录依赖。已发布 Java 包内 embedded 脚本是原构建版本；同一 image 的压缩已验证可复现，未声称独立 jlink 构建字节相同。',
    '此次仅新增 Mac 附件，原有 Windows 附件保持不变。',
  ].join('\n\n') + '\n', { flag: 'wx' });
  if (await exists(output)) throw new Error('Release output appeared while staging; refusing to replace it.');
  await rename(stage, output);
  published = true;
  console.log(JSON.stringify({ output, tag: manifest.tag, uploadPerformed: false, binaries: manifest.assets.map(({ name, size, sha256 }) => ({ name, size, sha256 })), reusedCorrespondingSource: manifest.correspondingJavaSource.existingReleaseUrl }, null, 2));
} finally {
  if (!published) await rm(stage, { recursive: true, force: true });
}
