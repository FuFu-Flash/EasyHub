import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import type { GitHubClient, GitHubPullFile } from '@easyhub/github';
import type { BinaryAnalysisResult } from '@easyhub/types';
import { analyzeFile, type AnalysisProgress } from './native';
import { MAX_ANALYSIS_BYTES, verifiedPullDownload, verifiedReleaseDownload, type AnalysisSource, type VerifiedDownload } from './source';
import { throwIfCancelled } from '../network/cancellation.js';

export async function analyzeGithubFile(input: {
  source: Exclude<AnalysisSource, { kind: 'local' }>; client: GitHubClient; requestId: string; language: 'zh' | 'en'; signal: AbortSignal;
  onProgress: (progress: AnalysisProgress) => void;
}): Promise<BinaryAnalysisResult> {
  const { source, client, signal } = input;
  throwIfCancelled(signal);
  let verified: VerifiedDownload;
  if (source.kind === 'release') {
    verified = verifiedReleaseDownload(source, await client.releaseAsset(source.owner, source.repo, source.assetId, signal));
  } else {
    const pull = await client.pullRequest(source.owner, source.repo, source.number, signal);
    let file: GitHubPullFile | undefined;
    for (let page = 1; page <= 30; page++) {
      throwIfCancelled(signal);
      const files = await client.pullFilesPage(source.owner, source.repo, source.number, page, signal);
      file = files.find((item) => item.filename === source.path);
      if (file || files.length < 100) break;
    }
    if (!file) throw new Error(input.language === 'en' ? 'The file is no longer part of these changes. Refresh and try again.' : '这个文件已不在当前修改中，请刷新后重试。');
    verified = verifiedPullDownload(source, pull, file);
  }
  throwIfCancelled(signal);
  const response = verified.assetId
    ? await client.downloadReleaseAsset(verified.owner, verified.repo, verified.assetId, signal)
    : await client.downloadBlob(verified.owner, verified.repo, verified.blobSha!, signal);
  let destination: File | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let handle: FileHandle | null = null;
  let loaded = 0;
  try {
    throwIfCancelled(signal);
    const advertised = Number(response.headers.get('content-length'));
    if (Number.isFinite(advertised) && advertised > MAX_ANALYSIS_BYTES) throw new Error(input.language === 'en' ? 'The file exceeds 128 MB.' : '文件超过 128 MB。');
    const body = response.body;
    if (!body) throw new Error(input.language === 'en' ? 'This download did not return a readable file.' : '下载没有返回可读取的文件。');
    reader = body.getReader();
    const folder = new Directory(Paths.cache, 'easyhub-analysis-downloads');
    folder.create({ intermediates: true, idempotent: true });
    const extension = verified.name.split('.').at(-1)?.toLowerCase().replace(/[^a-z0-9]/gu, '').slice(0, 8) || 'bin';
    destination = new File(folder, `${input.requestId}.${extension}`);
    destination.create();
    handle = destination.open();
      while (true) {
        throwIfCancelled(signal);
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        if (loaded > MAX_ANALYSIS_BYTES || (verified.expectedSize && loaded > verified.expectedSize)) throw new Error(input.language === 'en' ? 'The downloaded file exceeds the expected size.' : '下载文件超过预期大小。');
        handle.writeBytes(value);
        input.onProgress({ requestId: input.requestId, phase: 'preparing', completed: loaded, total: verified.expectedSize ?? (advertised > 0 ? advertised : 0), unit: 'bytes', message: input.language === 'en' ? 'Downloading program file' : '下载程序文件' });
      }
    handle.close(); handle = null;
    throwIfCancelled(signal);
    if (!loaded || (verified.expectedSize && loaded !== verified.expectedSize)) throw new Error(input.language === 'en' ? 'The file download is incomplete.' : '文件下载不完整。');
    return await analyzeFile({ requestId: input.requestId, uri: destination.uri, name: verified.name, language: input.language,
      expectedSize: loaded, ...(verified.expectedSha256 ? { expectedSha256: verified.expectedSha256 } : {}),
      ...(verified.expectedBlobSha ? { expectedBlobSha: verified.expectedBlobSha } : {}) }, signal, input.onProgress);
  } finally {
    try { handle?.close(); } catch { /* Preserve the download error. */ }
    if (reader) {
      await reader.cancel().catch(() => undefined);
      try { reader.releaseLock(); } catch { /* A cancelled reader may already be released. */ }
    } else await response.body?.cancel().catch(() => undefined);
    try { if (destination?.exists) destination.delete(); } catch { /* Native analysis also clears its own snapshot. */ }
  }
}
