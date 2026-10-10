import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalysisRuntime, INSTALLATION_NAME, LEGACY_INSTALLATION_NAME } from './AnalysisRuntime';
import { extractRuntimeArchive } from './analysisArchive';
import {
  artifactUrl, downloadVerifiedArchive, LEGACY_RUNTIME_ARTIFACTS, RUNTIME_ARTIFACTS, RUNTIME_DOWNLOAD_BYTES, verifyReleaseMetadata,
  type RuntimeArtifact, type RuntimeFetch,
} from './analysisDownloads';

const directories: string[] = [];
async function temporary(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'easyhub-analysis-runtime-test-')));
  directories.push(directory);
  return directory;
}
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

function officialMetadata(artifact: RuntimeArtifact) {
  return { tag_name: artifact.tag, assets: [{ name: artifact.name, size: artifact.size,
    digest: `sha256:${artifact.sha256}`, browser_download_url: artifactUrl(artifact) }] };
}
const metadataFetch: RuntimeFetch = async input => {
  const url = String(input);
  const artifacts = RUNTIME_ARTIFACTS.filter(item => url.endsWith(encodeURIComponent(item.tag)));
  if (!artifacts.length) throw new Error('unexpected request');
  return Response.json({ tag_name: artifacts[0]!.tag, assets: artifacts.flatMap(item => officialMetadata(item).assets) });
};
async function fakeExtract(archive: string, destination: string) {
  const artifact = RUNTIME_ARTIFACTS.find(item => archive.endsWith(item.name))!;
  const directory = join(destination, artifact.directory);
  const contents = artifact.id === 'ghidra' ? {
    'support/analyzeHeadless.bat': 'fixture', 'Ghidra/application.properties': 'application.version=12.1.2\n',
  } : artifact.id === 'java' ? {
    'bin/java.exe': 'fixture', release: 'JAVA_VERSION="21.0.12.1"\n',
  } : { 'lib/GhidraMCP-6.0.0.jar': 'fixture', 'extension.properties': 'name=GhidraMCP\nversion=12.1.2\n' };
  for (const [name, content] of Object.entries(contents)) {
    const file = join(directory, name);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, content);
  }
}
const fakeDownload: typeof downloadVerifiedArchive = async (_artifact, file) => { await writeFile(file, 'fixture'); };
async function fixture(overrides: Partial<ConstructorParameters<typeof AnalysisRuntime>[1]> = {}) {
  const root = await temporary();
  const runtime = new AnalysisRuntime(root, { platform: 'win32', arch: 'x64', fetch: metadataFetch,
    downloadArchive: fakeDownload, extractArchive: fakeExtract, ...overrides });
  return { root, runtime };
}

describe('optional analysis installation', () => {
  it('publishes a complete private runtime, restores it, and never downloads on status', async () => {
    const { root, runtime } = await fixture();
    expect(await runtime.status()).toEqual({ state: 'missing', downloadBytes: RUNTIME_DOWNLOAD_BYTES });
    const paths = await runtime.install();
    expect(paths.javaPath.startsWith(root)).toBe(true);
    expect(await readFile(join(paths.extensionPath, 'LICENSE'), 'utf8')).toContain('Ben Ethington and Ghidra MCP Server contributors');
    expect(await runtime.status()).toEqual({ state: 'ready', paths, downloadBytes: 0 });
    expect(await readdir(join(root, 'analysis-runtime'))).toHaveLength(1);
    const fetch = vi.fn(() => { throw new Error('should not fetch'); });
    const restored = new AnalysisRuntime(root, { platform: 'win32', arch: 'x64', fetch });
    expect(await restored.status()).toEqual({ state: 'ready', paths, downloadBytes: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates the extension compatibility version separately from the plugin JAR version', async () => {
    const { runtime } = await fixture({ extractArchive: async (archive, destination) => {
      await fakeExtract(archive, destination);
      if (archive.endsWith('GhidraMCP-6.0.0.zip')) {
        await writeFile(join(destination, 'GhidraMCP', 'extension.properties'), 'name=GhidraMCP\nversion=6.0.0\n');
      }
    } });
    await expect(runtime.install()).rejects.toThrow('扩展兼容版本');
    expect((await runtime.status()).state).toBe('error');
  });

  it('reuses a validated full installation without downloading or changing its files', async () => {
    const { root, runtime } = await fixture();
    await runtime.install();
    const legacy = join(root, 'analysis-runtime', LEGACY_INSTALLATION_NAME);
    await rename(join(root, 'analysis-runtime', INSTALLATION_NAME), legacy);
    const manifest = JSON.stringify({ schema: 1, installation: LEGACY_INSTALLATION_NAME,
      artifacts: LEGACY_RUNTIME_ARTIFACTS.map(({ id, sha256 }) => ({ id, sha256 })) });
    await writeFile(join(legacy, 'installation.json'), manifest);
    const fetch = vi.fn(() => { throw new Error('the existing installation needs no download'); });
    const restored = new AnalysisRuntime(root, { platform: 'win32', arch: 'x64', fetch });
    expect(await restored.status()).toMatchObject({ state: 'ready', downloadBytes: 0 });
    expect((await restored.install()).javaPath).toBe(join(legacy, 'java'));
    expect(fetch).not.toHaveBeenCalled();
    expect(await readFile(join(legacy, 'installation.json'), 'utf8')).toBe(manifest);
    expect(await readdir(join(root, 'analysis-runtime'))).toEqual([LEGACY_INSTALLATION_NAME]);
  });

  it('does not trust incomplete legacy files and installs separately without replacing them', async () => {
    const { root, runtime } = await fixture();
    const legacy = join(root, 'analysis-runtime', LEGACY_INSTALLATION_NAME);
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'keep'), 'user files');
    await writeFile(join(legacy, 'installation.json'), JSON.stringify({ schema: 1, installation: LEGACY_INSTALLATION_NAME,
      artifacts: LEGACY_RUNTIME_ARTIFACTS.map(({ id, sha256 }) => ({ id, sha256 })) }));
    expect((await runtime.status()).state).toBe('missing');
    expect((await runtime.install()).javaPath).toBe(join(root, 'analysis-runtime', INSTALLATION_NAME, 'java'));
    expect(await readFile(join(legacy, 'keep'), 'utf8')).toBe('user files');
    expect(await readdir(join(root, 'analysis-runtime'))).toHaveLength(2);
  });

  it('never activates on cancellation, removes only its staging directory, and supports retry', async () => {
    const controller = new AbortController();
    const { root, runtime } = await fixture({ downloadArchive: async (artifact, file) => {
      await fakeDownload(artifact, file, metadataFetch);
      controller.abort();
    } });
    await mkdir(join(root, 'analysis-runtime', 'other-user-data'), { recursive: true });
    await writeFile(join(root, 'analysis-runtime', 'other-user-data', 'keep'), 'keep');
    await expect(runtime.install({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readdir(join(root, 'analysis-runtime'))).toEqual(['other-user-data']);
    expect(await readFile(join(root, 'analysis-runtime', 'other-user-data', 'keep'), 'utf8')).toBe('keep');
    const retry = new AnalysisRuntime(root, { platform: 'win32', arch: 'x64', fetch: metadataFetch,
      downloadArchive: fakeDownload, extractArchive: fakeExtract });
    expect((await retry.install()).javaPath).toContain('analysis-runtime');
  });

  it('refuses a concurrent installation into the same userData directory', async () => {
    let releaseDownload!: () => void;
    let reachedDownload!: () => void;
    const started = new Promise<void>(resolve => { reachedDownload = resolve; });
    const wait = new Promise<void>(resolve => { releaseDownload = resolve; });
    const { root, runtime } = await fixture({ downloadArchive: async (artifact, file) => {
      reachedDownload(); await wait; await fakeDownload(artifact, file, metadataFetch);
    } });
    const installing = runtime.install();
    await started;
    expect((await runtime.status()).state).toBe('installing');
    await expect(new AnalysisRuntime(root, { platform: 'win32', arch: 'x64' }).install()).rejects.toThrow('正在进行');
    releaseDownload();
    await installing;
  });

  it('refuses an unexpected release before downloading and preserves an existing incomplete directory', async () => {
    const download = vi.fn(fakeDownload);
    const { root, runtime } = await fixture({ fetch: async () => Response.json({ tag_name: 'attacker' }), downloadArchive: download });
    await expect(runtime.install()).rejects.toThrow('固定版本不一致');
    expect(download).not.toHaveBeenCalled();
    expect(await readdir(join(root, 'analysis-runtime'))).toEqual([]);
    await mkdir(join(root, 'analysis-runtime', INSTALLATION_NAME));
    await expect(runtime.install()).rejects.toThrow('不完整内容');
    expect(await readdir(join(root, 'analysis-runtime'))).toHaveLength(1);
  });
});

describe('official archive integrity and redirects', () => {
  const bytes = Buffer.from('a small official fixture archive');
  const artifact: RuntimeArtifact = { ...RUNTIME_ARTIFACTS[2]!, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };

  it('streams a bounded file and verifies its digest', async () => {
    const output = join(await temporary(), 'archive.zip');
    const progress: number[] = [];
    await downloadVerifiedArchive(artifact, output, async () => new Response(bytes), undefined, count => progress.push(count));
    expect(await readFile(output)).toEqual(bytes);
    expect(progress.at(-1)).toBe(bytes.length);
  });

  it('rejects corrupted or oversized content before extraction', async () => {
    const root = await temporary();
    await expect(downloadVerifiedArchive(artifact, join(root, 'bad.zip'), async () => new Response(Buffer.alloc(bytes.length))))
      .rejects.toThrow('SHA-256');
    await expect(downloadVerifiedArchive(artifact, join(root, 'large.zip'), async () => new Response(Buffer.alloc(bytes.length + 1))))
      .rejects.toThrow('超过允许大小');
  });

  it.each(['http://github.com/asset', 'https://localhost/asset', 'https://github.com.evil.example/asset',
    'https://example.com/asset', 'https://github.com/other/repository'])('refuses a release redirect to %s', async url => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: url } }));
    await expect(downloadVerifiedArchive(artifact, join(await temporary(), 'archive.zip'), fetch)).rejects.toThrow('固定来源');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not trust matching URLs when API digest or size changed', async () => {
    const data = officialMetadata(artifact);
    data.assets[0]!.digest = `sha256:${'0'.repeat(64)}`;
    await expect(verifyReleaseMetadata(artifact, async () => Response.json(data))).rejects.toThrow('固定版本不一致');
  });
});

// Small, stored ZIP fixtures exercise the real PowerShell extractor and its central-directory checks.
function storedZip(name: string, contents: Buffer, externalAttributes = 0): Buffer {
  const filename = Buffer.from(name);
  let crc = 0xffffffff;
  for (const byte of contents) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(contents.length, 18); local.writeUInt32LE(contents.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(contents.length, 20); central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(externalAttributes >>> 0, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + contents.length, 16);
  return Buffer.concat([local, filename, contents, central, filename, end]);
}

describe.skipIf(process.platform !== 'win32')('real Windows ZIP extraction safety', () => {
  it('extracts a valid archive into a newly created owned directory', async () => {
    const root = await temporary();
    const archive = join(root, 'valid.zip');
    await writeFile(archive, storedZip('component/bin/file.txt', Buffer.from('safe')));
    await extractRuntimeArchive(archive, join(root, 'extract'), 4096);
    expect(await readFile(join(root, 'extract', 'component', 'bin', 'file.txt'), 'utf8')).toBe('safe');
  }, 15_000);

  it('accepts canonical Windows paths with different casing', async () => {
    const root = await temporary();
    const archive = join(root, 'valid.zip');
    await writeFile(archive, storedZip('file.txt', Buffer.from('safe')));
    await extractRuntimeArchive(archive, join(root.toUpperCase(), 'EXTRACT'), 4096);
    expect(await readFile(join(root, 'EXTRACT', 'file.txt'), 'utf8')).toBe('safe');
  }, 15_000);

  it.each(['../outside.txt', '/absolute.txt', 'C:/escape.txt', 'nested/../escape.txt',
    'nested/file.txt:stream', 'nested/CON.txt', 'nested/trailing.'])('rejects unsafe ZIP entry %s', async name => {
    const root = await temporary();
    const archive = join(root, 'invalid.zip');
    await writeFile(archive, storedZip(name, Buffer.from('unsafe')));
    await expect(extractRuntimeArchive(archive, join(root, 'extract'), 4096)).rejects.toThrow('ZIP');
    expect(await readdir(join(root, 'extract'))).toEqual([]);
  }, 15_000);

  it('rejects symbolic-link entries and unpacked-size excess', async () => {
    const root = await temporary();
    await writeFile(join(root, 'link.zip'), storedZip('link', Buffer.from('../outside'), 0xa1ff0000));
    await expect(extractRuntimeArchive(join(root, 'link.zip'), join(root, 'link-extract'), 4096)).rejects.toThrow('ZIP');
    await writeFile(join(root, 'large.zip'), storedZip('large', Buffer.alloc(128)));
    await expect(extractRuntimeArchive(join(root, 'large.zip'), join(root, 'large-extract'), 64)).rejects.toThrow('ZIP');
  }, 20_000);

  it('limits actually inflated bytes when ZIP headers understate a file length', async () => {
    const root = await temporary();
    const zip = storedZip('understated', Buffer.alloc(128));
    zip.writeUInt32LE(1, 22);
    const central = 30 + Buffer.byteLength('understated') + 128;
    zip.writeUInt32LE(1, central + 24);
    await writeFile(join(root, 'understated.zip'), zip);
    await expect(extractRuntimeArchive(join(root, 'understated.zip'), join(root, 'extract'), 4096)).rejects.toThrow('ZIP');
  }, 15_000);
});
