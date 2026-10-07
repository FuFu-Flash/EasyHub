import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export interface RuntimeArtifact {
  id: 'ghidra' | 'java' | 'extension';
  repository: string;
  tag: string;
  name: string;
  sha256: string;
  size: number;
  directory: string;
  unpackedLimit: number;
}

// Fixed compatible upstream releases and verified slim redistributions.
// Neither IPC arguments nor release metadata choose executables.
export const LEGACY_RUNTIME_ARTIFACTS: readonly RuntimeArtifact[] = [
  {
    id: 'ghidra', repository: 'NationalSecurityAgency/ghidra', tag: 'Ghidra_12.1.2_build',
    name: 'ghidra_12.1.2_PUBLIC_20260605.zip', directory: 'ghidra_12.1.2_PUBLIC',
    sha256: 'b62e81a0390618466c019c60d8c2f796ced2509c4c1aea4a37644a77272cf99d',
    size: 572803866, unpackedLimit: 3 * 1024 ** 3,
  },
  {
    id: 'java', repository: 'adoptium/temurin21-binaries', tag: 'jdk-21.0.12.1+1',
    name: 'OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip', directory: 'jdk-21.0.12.1+1',
    sha256: 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e',
    size: 205073461, unpackedLimit: 1024 ** 3,
  },
  {
    id: 'extension', repository: 'bethington/ghidra-mcp', tag: 'v6.0.0',
    name: 'GhidraMCP-6.0.0.zip', directory: 'GhidraMCP',
    sha256: '867731de27d5143632a010943b907a6485dd54d0e19729e2f85ee9f692c99873',
    size: 728120, unpackedLimit: 20 * 1024 ** 2,
  },
];

const SLIM_REPOSITORY = 'FuFu-Flash/EasyHub';
const SLIM_TAG = 'analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1';
export const RUNTIME_ARTIFACTS: readonly RuntimeArtifact[] = [
  {
    id: 'ghidra', repository: SLIM_REPOSITORY, tag: SLIM_TAG,
    name: 'easyhub-ghidra-12.1.2-win-x64-v1.zip', directory: 'ghidra-12.1.2-win-x64-v1',
    sha256: 'd1ce26e78f72b7dd5657d46ca2e40c13f17a658b7d0883a873a3c968ca797206',
    size: 227541919, unpackedLimit: 768 * 1024 ** 2,
  },
  {
    id: 'java', repository: SLIM_REPOSITORY, tag: SLIM_TAG,
    name: 'easyhub-java-21.0.12.1-win-x64-v1.zip', directory: 'java-21.0.12.1-win-x64-v1',
    sha256: '7a19729d199a7a253b56206fcfcd5c770d88054fd0baedcf2024c6d34e3336b1',
    size: 49054730, unpackedLimit: 128 * 1024 ** 2,
  },
  LEGACY_RUNTIME_ARTIFACTS[2]!,
];

// Previous macOS installations use these exact upstream archives. Recognize
// their existing manifests without downloading them again or relabeling as slim.
export const MAC_LEGACY_RUNTIME_ARTIFACTS: readonly RuntimeArtifact[] = [
  LEGACY_RUNTIME_ARTIFACTS[0]!,
  {
    id: 'java', repository: 'adoptium/temurin21-binaries', tag: 'jdk-21.0.12.1+1',
    name: 'OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.12.1_1.tar.gz', directory: 'jdk-21.0.12.1+1',
    sha256: '3623232f33a9c3baadf304480b2535f9a3cba8a58d42ecbb438ba267315d9998',
    size: 200073404, unpackedLimit: 1024 ** 3,
  },
  LEGACY_RUNTIME_ARTIFACTS[2]!,
];
// Fixed macOS ARM64 slim redistributions preserve the same analysis engine,
// processors, native decompiler and Java compiler. Never select Windows images.
export const MAC_RUNTIME_ARTIFACTS: readonly RuntimeArtifact[] = [
  {
    id: 'ghidra', repository: SLIM_REPOSITORY, tag: SLIM_TAG,
    name: 'easyhub-ghidra-12.1.2-mac-arm64-v1.zip', directory: 'ghidra-12.1.2-mac-arm64-v1',
    sha256: 'c195aa703e8f9465f25eaaa5c396696967c56f4d12120f75d24e5b1501bb857e',
    size: 226376392, unpackedLimit: 768 * 1024 ** 2,
  },
  {
    id: 'java', repository: SLIM_REPOSITORY, tag: SLIM_TAG,
    name: 'easyhub-java-21.0.12.1-mac-arm64-v1.tar.gz', directory: 'java-21.0.12.1-mac-arm64-v1',
    sha256: 'd2d0e014593c25d2e22c40ad3a30115acfebf19cf6bb5d2af746a8c99f877dbe',
    size: 49510546, unpackedLimit: 128 * 1024 ** 2,
  },
  LEGACY_RUNTIME_ARTIFACTS[2]!,
];
export function runtimeArtifacts(platform: NodeJS.Platform, arch: string): readonly RuntimeArtifact[] {
  if (platform === 'darwin' && arch === 'arm64') return MAC_RUNTIME_ARTIFACTS;
  if (platform === 'win32' && arch === 'x64') return RUNTIME_ARTIFACTS;
  throw new Error('分析组件支持 Apple 芯片的 macOS 和 Windows x64');
}

export const RUNTIME_DOWNLOAD_BYTES = RUNTIME_ARTIFACTS.reduce((sum, artifact) => sum + artifact.size, 0);
export type RuntimeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const HEADERS = { 'User-Agent': 'EasyHub-analysis-runtime', Accept: 'application/vnd.github+json' };

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('分析组件安装已取消', 'AbortError');
}

export function artifactUrl(artifact: RuntimeArtifact): string {
  return `https://github.com/${artifact.repository}/releases/download/${encodeURIComponent(artifact.tag)}/${artifact.name}`;
}

function validateUrl(value: string, initial: string, redirect: boolean): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || !DOWNLOAD_HOSTS.has(url.hostname) || (!redirect && url.href !== new URL(initial).href)
    || (redirect && url.hostname === 'github.com' && url.href !== new URL(initial).href)) {
    throw new Error('分析组件下载地址不在固定来源范围内');
  }
  return url;
}

async function fetchAsset(url: string, fetcher: RuntimeFetch, signal?: AbortSignal): Promise<Response> {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]) : AbortSignal.timeout(30 * 60_000);
  let next = validateUrl(url, url, false);
  for (let count = 0; count < 6; count++) {
    throwIfAborted(signal);
    const response = await fetcher(next, { redirect: 'manual', headers: HEADERS, signal: requestSignal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('组件下载重定向缺少地址');
      next = validateUrl(new URL(location, next).href, url, true);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`组件下载失败 (HTTP ${response.status})`);
    }
    // A supplied Electron fetch adapter must also honor redirect:'manual'.
    if (response.redirected) {
      await response.body?.cancel();
      throw new Error('组件下载器发生了未经验证的重定向');
    }
    return response;
  }
  throw new Error('组件下载重定向次数过多');
}

async function readBounded(response: Response, maximum: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!response.body) throw new Error('组件响应为空');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > maximum) throw new Error('组件发布元数据超过允许大小');
      chunks.push(result.value);
    }
    return Buffer.concat(chunks, length);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function verifyReleaseMetadata(artifact: RuntimeArtifact, fetcher: RuntimeFetch, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const url = `https://api.github.com/repos/${artifact.repository}/releases/tags/${encodeURIComponent(artifact.tag)}`;
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const response = await fetcher(url, { redirect: 'error', headers: HEADERS, signal: requestSignal });
  if (!response.ok || response.redirected) {
    await response.body?.cancel();
    throw new Error(`无法核对组件发布信息 (HTTP ${response.status})`);
  }
  const data = JSON.parse(new TextDecoder().decode(await readBounded(response, 2 * 1024 ** 2, signal))) as {
    tag_name?: unknown; assets?: { name?: unknown; size?: unknown; digest?: unknown; browser_download_url?: unknown }[];
  };
  const asset = Array.isArray(data.assets) ? data.assets.find(item => item?.name === artifact.name) : undefined;
  if (data.tag_name !== artifact.tag || asset?.size !== artifact.size
    || asset?.digest !== `sha256:${artifact.sha256}` || asset?.browser_download_url !== artifactUrl(artifact)) {
    throw new Error(`组件发布校验信息与固定版本不一致：${artifact.id}`);
  }
}

export async function downloadVerifiedArchive(
  artifact: RuntimeArtifact, destination: string, fetcher: RuntimeFetch,
  signal?: AbortSignal, onBytes?: (bytes: number) => void,
): Promise<void> {
  const response = await fetchAsset(artifactUrl(artifact), fetcher, signal);
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && Number(declaredLength) !== artifact.size) {
    await response.body?.cancel();
    throw new Error(`组件下载大小与发布记录不一致：${artifact.id}`);
  }
  if (!response.body) throw new Error('组件下载内容为空');
  const reader = response.body.getReader();
  const output = await open(destination, 'wx');
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await reader.read();
      throwIfAborted(signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > artifact.size) throw new Error(`组件下载超过允许大小：${artifact.id}`);
      hash.update(chunk.value);
      let offset = 0;
      while (offset < chunk.value.byteLength) {
        const result = await output.write(chunk.value, offset, chunk.value.byteLength - offset);
        if (!result.bytesWritten) throw new Error('组件文件写入失败');
        offset += result.bytesWritten;
      }
      onBytes?.(bytes);
    }
    if (bytes !== artifact.size || hash.digest('hex') !== artifact.sha256) {
      throw new Error(`组件 SHA-256 校验失败：${artifact.id}`);
    }
    await output.sync();
  } finally {
    await output.close();
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
