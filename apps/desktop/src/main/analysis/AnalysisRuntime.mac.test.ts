import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AnalysisRuntime, MAC_INSTALLATION_NAME, MAC_LEGACY_INSTALLATION_NAME, type RuntimeProgress } from './AnalysisRuntime';
import {
  artifactUrl, LEGACY_RUNTIME_ARTIFACTS, MAC_LEGACY_RUNTIME_ARTIFACTS, MAC_RUNTIME_ARTIFACTS,
  RUNTIME_ARTIFACTS, RUNTIME_DOWNLOAD_BYTES, runtimeArtifacts, throwIfAborted,
  type RuntimeArtifact, type RuntimeFetch,
} from './analysisDownloads';

const directories: string[] = [];
const MAC_DOWNLOAD_BYTES = 276615058;
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const metadata: RuntimeFetch = async input => {
  const artifacts = [...MAC_RUNTIME_ARTIFACTS, ...MAC_LEGACY_RUNTIME_ARTIFACTS]
    .filter(artifact => String(input).endsWith(encodeURIComponent(artifact.tag)));
  return Response.json({ tag_name: artifacts[0]?.tag, assets: artifacts.map(artifact => ({ name: artifact.name, size: artifact.size,
    digest: `sha256:${artifact.sha256}`, browser_download_url: artifactUrl(artifact) })) });
};
async function materialize(directory: string, id: RuntimeArtifact['id']) {
  const contents = id === 'ghidra' ? {
    'support/analyzeHeadless': 'fixture', 'Ghidra/application.properties': 'application.version=12.1.2\n',
    'Ghidra/Features/Decompiler/os/mac_arm_64/decompile': 'fixture',
  } : id === 'java' ? {
    // jlink's release only includes JAVA_VERSION and MODULES; the executable
    // architecture was independently verified when the pinned asset was built.
    'Contents/Home/bin/java': 'fixture', 'Contents/Home/release': 'JAVA_VERSION="21.0.12.1"\n',
  } : { 'lib/GhidraMCP-6.0.0.jar': 'fixture', 'extension.properties': 'name=GhidraMCP\nversion=12.1.2\n' };
  for (const [name, content] of Object.entries(contents)) {
    const path = join(directory, name); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content);
  }
}
function manifest(installation: string, artifacts: readonly RuntimeArtifact[]) {
  return { schema: 1, installation, artifacts: artifacts.map(({ id, sha256 }) => ({ id, sha256 })) };
}
async function seed(root: string, installation: string, artifacts: readonly RuntimeArtifact[]) {
  const target = join(root, 'analysis-runtime', installation);
  for (const artifact of artifacts) await materialize(join(target, artifact.id), artifact.id);
  await writeFile(join(target, 'installation.json'), JSON.stringify(manifest(installation, artifacts)));
  return target;
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'easyhub-mac-runtime-test-'))); directories.push(root);
  const download = vi.fn(async (_artifact: RuntimeArtifact, path: string, _fetch: RuntimeFetch, signal?: AbortSignal) => {
    throwIfAborted(signal); await writeFile(path, 'fixture');
  });
  const extract = vi.fn(async (archive: string, destination: string, _limit: number, signal?: AbortSignal) => {
    throwIfAborted(signal);
    const artifact = MAC_RUNTIME_ARTIFACTS.find(artifact => archive.endsWith(artifact.name))!;
    await materialize(join(destination, artifact.directory), artifact.id);
  });
  const runtime = new AnalysisRuntime(root, { platform: 'darwin', arch: 'arm64', fetch: metadata, downloadArchive: download, extractArchive: extract });
  return { root, runtime, download, extract };
}
function offline(root: string) {
  const network = vi.fn(async () => { throw new Error('must not download'); });
  return { runtime: new AnalysisRuntime(root, { platform: 'darwin', arch: 'arm64', fetch: network }), network };
}

describe('macOS ARM slim analysis installation', () => {
  it('pins distinct macOS slim artifacts and preserves Windows artifact selection', () => {
    expect(runtimeArtifacts('darwin', 'arm64')).toBe(MAC_RUNTIME_ARTIFACTS);
    expect(MAC_RUNTIME_ARTIFACTS.map(artifact => artifact.name)).toEqual([
      'easyhub-ghidra-12.1.2-mac-arm64-v1.zip', 'easyhub-java-21.0.12.1-mac-arm64-v1.tar.gz', 'GhidraMCP-6.0.0.zip',
    ]);
    expect(MAC_RUNTIME_ARTIFACTS.slice(0, 2).map(artifact => [artifact.repository, artifact.tag])).toEqual([
      ['FuFu-Flash/EasyHub', 'analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1'],
      ['FuFu-Flash/EasyHub', 'analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1'],
    ]);
    expect(MAC_RUNTIME_ARTIFACTS.map(artifact => artifact.sha256)).toEqual([
      'c195aa703e8f9465f25eaaa5c396696967c56f4d12120f75d24e5b1501bb857e',
      'd2d0e014593c25d2e22c40ad3a30115acfebf19cf6bb5d2af746a8c99f877dbe',
      '867731de27d5143632a010943b907a6485dd54d0e19729e2f85ee9f692c99873',
    ]);
    expect(MAC_RUNTIME_ARTIFACTS.reduce((sum, artifact) => sum + artifact.size, 0)).toBe(MAC_DOWNLOAD_BYTES);
    expect(MAC_RUNTIME_ARTIFACTS.map(artifact => artifact.unpackedLimit)).toEqual([768 * 1024 ** 2, 128 * 1024 ** 2, 20 * 1024 ** 2]);
    expect(runtimeArtifacts('win32', 'x64')).toBe(RUNTIME_ARTIFACTS);
    expect(RUNTIME_DOWNLOAD_BYTES).toBe(277324769);
    expect(MAC_LEGACY_RUNTIME_ARTIFACTS[0]).toBe(LEGACY_RUNTIME_ARTIFACTS[0]);
    expect(MAC_LEGACY_RUNTIME_ARTIFACTS[1]!.name).toBe('OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.12.1_1.tar.gz');
    expect(() => runtimeArtifacts('linux', 'arm64')).toThrow('支持');
    expect(() => runtimeArtifacts('darwin', 'x64')).toThrow('支持');
  });

  it('downloads only slim assets, preserves the native Java Home and writes its distinct manifest', async () => {
    const { root, runtime, download, extract } = await fixture();
    expect(await runtime.status()).toMatchObject({ state: 'missing', downloadBytes: MAC_DOWNLOAD_BYTES });
    const progress: RuntimeProgress[] = [];
    const paths = await runtime.install({ onProgress: update => progress.push(update) });
    expect(paths.javaPath).toBe(join(root, 'analysis-runtime', MAC_INSTALLATION_NAME, 'java/Contents/Home'));
    expect(paths.ghidraPath).toBe(join(root, 'analysis-runtime', MAC_INSTALLATION_NAME, 'ghidra'));
    expect(await readFile(join(paths.extensionPath, 'LICENSE'), 'utf8')).toContain('Apache License');
    expect(download.mock.calls.map(([artifact]) => artifact)).toEqual(MAC_RUNTIME_ARTIFACTS);
    expect(extract.mock.calls.map(([, , limit]) => limit)).toEqual(MAC_RUNTIME_ARTIFACTS.map(artifact => artifact.unpackedLimit));
    expect(progress.every(update => update.totalBytes === MAC_DOWNLOAD_BYTES)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ stage: 'activating', downloadedBytes: MAC_DOWNLOAD_BYTES });
    const installed = JSON.parse(await readFile(join(root, 'analysis-runtime', MAC_INSTALLATION_NAME, 'installation.json'), 'utf8'));
    expect(installed).toEqual(manifest(MAC_INSTALLATION_NAME, MAC_RUNTIME_ARTIFACTS));
    expect(installed).not.toEqual(manifest(MAC_LEGACY_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS));
    const restored = offline(root);
    expect(await restored.runtime.status()).toEqual({ state: 'ready', paths, downloadBytes: 0 });
    expect(await restored.runtime.install()).toEqual(paths);
    expect(restored.network).not.toHaveBeenCalled();
    const windows = new AnalysisRuntime(root, { platform: 'win32', arch: 'x64', fetch: restored.network });
    expect((await windows.status()).state).toBe('missing');
  });

  it('reuses a valid old full macOS installation with no network and leaves its original manifest intact', async () => {
    const { root } = await fixture();
    const target = await seed(root, MAC_LEGACY_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS);
    const before = await readFile(join(target, 'installation.json'), 'utf8');
    const { runtime, network } = offline(root);
    const paths = { javaPath: join(target, 'java/Contents/Home'), ghidraPath: join(target, 'ghidra'), extensionPath: join(target, 'extension') };
    expect(await runtime.status()).toEqual({ state: 'ready', paths, downloadBytes: 0 });
    expect(await runtime.install()).toEqual(paths);
    expect(network).not.toHaveBeenCalled();
    expect(await readFile(join(target, 'installation.json'), 'utf8')).toBe(before);
    expect(await readdir(join(root, 'analysis-runtime'))).toEqual([MAC_LEGACY_INSTALLATION_NAME]);
  });

  it('prefers the verified slim installation when a valid full installation also exists', async () => {
    const { root, runtime } = await fixture();
    const slim = await runtime.install();
    await seed(root, MAC_LEGACY_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS);
    const restored = offline(root);
    expect(await restored.runtime.status()).toEqual({ state: 'ready', paths: slim, downloadBytes: 0 });
    expect(await restored.runtime.install()).toEqual(slim);
    expect(restored.network).not.toHaveBeenCalled();
  });

  it('falls back to the valid full installation if an incomplete slim directory exists', async () => {
    const { root } = await fixture();
    const legacy = await seed(root, MAC_LEGACY_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS);
    const incomplete = join(root, 'analysis-runtime', MAC_INSTALLATION_NAME);
    await mkdir(incomplete); await writeFile(join(incomplete, 'user-note'), 'preserve');
    const restored = offline(root);
    expect((await restored.runtime.status()).paths?.javaPath).toBe(join(legacy, 'java/Contents/Home'));
    expect((await restored.runtime.install()).javaPath).toBe(join(legacy, 'java/Contents/Home'));
    expect(restored.network).not.toHaveBeenCalled();
    expect(await readFile(join(incomplete, 'user-note'), 'utf8')).toBe('preserve');
  });

  it.each(['wrong-sha', 'slim-manifest', 'wrong-java-version', 'wrong-ghidra-version', 'wrong-extension-version', 'missing-native', 'native-directory'])(
    'rejects invalid old full content (%s), preserves it and installs the new slim directory', async problem => {
      const { root, runtime, download } = await fixture();
      const legacy = await seed(root, MAC_LEGACY_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS);
      const manifestFile = join(legacy, 'installation.json');
      if (problem === 'wrong-sha') {
        const changed = manifest(MAC_LEGACY_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS);
        changed.artifacts[0]!.sha256 = '0'.repeat(64); await writeFile(manifestFile, JSON.stringify(changed));
      } else if (problem === 'slim-manifest') await writeFile(manifestFile, JSON.stringify(manifest(MAC_INSTALLATION_NAME, MAC_RUNTIME_ARTIFACTS)));
      else if (problem === 'wrong-java-version') await writeFile(join(legacy, 'java/Contents/Home/release'), 'JAVA_VERSION="17.0.1"\n');
      else if (problem === 'wrong-ghidra-version') await writeFile(join(legacy, 'ghidra/Ghidra/application.properties'), 'application.version=11.0\n');
      else if (problem === 'wrong-extension-version') await writeFile(join(legacy, 'extension/extension.properties'), 'name=GhidraMCP\nversion=11.0\n');
      else {
        const native = join(legacy, 'ghidra/Ghidra/Features/Decompiler/os/mac_arm_64/decompile');
        await rm(native); if (problem === 'native-directory') await mkdir(native);
      }
      const preserved = await readFile(manifestFile, 'utf8');
      expect(await runtime.status()).toEqual({ state: 'missing', downloadBytes: MAC_DOWNLOAD_BYTES });
      expect((await runtime.install()).javaPath).toBe(join(root, 'analysis-runtime', MAC_INSTALLATION_NAME, 'java/Contents/Home'));
      expect(download.mock.calls.map(([artifact]) => artifact)).toEqual(MAC_RUNTIME_ARTIFACTS);
      expect(await readFile(manifestFile, 'utf8')).toBe(preserved);
    },
  );

  it('never accepts a full manifest written into the slim directory', async () => {
    const { root, runtime, download } = await fixture();
    const target = await seed(root, MAC_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS);
    await writeFile(join(target, 'installation.json'), JSON.stringify(manifest(MAC_LEGACY_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS)));
    expect(await runtime.status()).toEqual({ state: 'missing', downloadBytes: MAC_DOWNLOAD_BYTES });
    await expect(runtime.install()).rejects.toThrow('已有不完整内容');
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects a symlinked legacy executable rather than accepting substituted local content', async () => {
    const { root, runtime } = await fixture();
    const legacy = await seed(root, MAC_LEGACY_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS);
    const java = join(legacy, 'java/Contents/Home/bin/java');
    const external = join(root, 'outside-java'); await writeFile(external, 'fixture'); await rm(java); await symlink(external, java);
    expect((await runtime.status()).state).toBe('missing');
  });

  it('cancels after a slim download, cleans only its new scratch directory and permits a retry', async () => {
    const { root, runtime, download } = await fixture();
    await mkdir(join(root, 'analysis-runtime'), { recursive: true });
    await writeFile(join(root, 'analysis-runtime', 'unrelated-file'), 'preserve');
    const controller = new AbortController();
    download.mockImplementationOnce(async (_artifact, archive) => { await writeFile(archive, 'fixture'); controller.abort(); });
    await expect(runtime.install({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readdir(join(root, 'analysis-runtime'))).toEqual(['unrelated-file']);
    expect(await runtime.status()).toMatchObject({ state: 'error', downloadBytes: MAC_DOWNLOAD_BYTES });
    const paths = await runtime.install();
    expect(paths.javaPath).toContain(MAC_INSTALLATION_NAME);
    expect(await readFile(join(root, 'analysis-runtime', 'unrelated-file'), 'utf8')).toBe('preserve');
  });

  it('honors an already aborted request even when a valid full installation is available', async () => {
    const { root, runtime, download } = await fixture();
    await seed(root, MAC_LEGACY_INSTALLATION_NAME, MAC_LEGACY_RUNTIME_ARTIFACTS);
    const controller = new AbortController(); controller.abort();
    await expect(runtime.install({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(download).not.toHaveBeenCalled();
  });
});
