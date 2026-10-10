import type { GitHubPullFile, GitHubPullRequest, GitHubReleaseAsset } from '@easyhub/github';

export const MAX_ANALYSIS_BYTES = 128 * 1024 * 1024;
export type AnalysisSource =
  | { kind: 'local'; uri: string; name: string }
  | { kind: 'release'; owner: string; repo: string; assetId: number; name: string }
  | { kind: 'pull'; owner: string; repo: string; number: number; headSha: string; fileSha: string; path: string };
export interface VerifiedDownload { owner: string; repo: string; name: string; expectedSize?: number; expectedSha256?: string; expectedBlobSha?: string; assetId?: number; blobSha?: string }

export function analyzableFile(name: string): boolean {
  return /\.(apk|dex|jar|class|exe|dll|sys|elf|so|dylib|bin)$/iu.test(name);
}

function positive(value: string | undefined): number {
  if (!value || !/^[1-9]\d{0,14}$/u.test(value)) throw new Error('程序文件地址无效。 / Invalid program file address.');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('程序文件地址无效。 / Invalid program file address.');
  return result;
}
function identity(value: string | undefined): string {
  if (!value || !/^[-a-z0-9_.]{1,100}$/iu.test(value) || value === '.' || value === '..') throw new Error('项目地址无效。 / Invalid project address.');
  return value;
}
export function parseAnalysisSource(params: Record<string, string | string[] | undefined>): Exclude<AnalysisSource, { kind: 'local' }> | null {
  const get = (key: string) => typeof params[key] === 'string' ? params[key] as string : undefined;
  const source = get('source');
  if (!source) return null;
  const owner = identity(get('owner')); const repo = identity(get('repo'));
  if (source === 'release') {
    const name = get('name');
    if (!name || name.length > 240 || /[\x00-\x1f]/u.test(name) || !analyzableFile(name)) throw new Error('文件名称无效。 / Invalid file name.');
    return { kind: 'release', owner, repo, assetId: positive(get('assetId')), name };
  }
  if (source === 'pull') {
    const headSha = get('headSha'); const fileSha = get('fileSha'); const path = get('path');
    if (!headSha || !fileSha || !/^[a-f0-9]{40}$/iu.test(headSha) || !/^[a-f0-9]{40}$/iu.test(fileSha) ||
      !path || path.length > 2048 || /[\x00-\x1f]/u.test(path) || !analyzableFile(path)) throw new Error('修改文件地址无效。 / Invalid changed file address.');
    return { kind: 'pull', owner, repo, number: positive(get('number')), headSha, fileSha, path };
  }
  throw new Error('程序文件来源无效。 / Invalid program file source.');
}

export function verifiedReleaseDownload(source: Extract<AnalysisSource, { kind: 'release' }>, asset: GitHubReleaseAsset): VerifiedDownload {
  if (asset.id !== source.assetId || asset.name !== source.name || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ANALYSIS_BYTES) {
    throw new Error('发行附件已更新、为空或超过 128 MB，请刷新后重试。 / The release asset changed, is empty, or exceeds 128 MB. Refresh and try again.');
  }
  if (asset.digest && !/^sha256:[a-f0-9]{64}$/iu.test(asset.digest)) throw new Error('文件校验信息无效。 / Invalid file verification metadata.');
  return { owner: source.owner, repo: source.repo, name: asset.name, assetId: asset.id, expectedSize: asset.size,
    ...(asset.digest ? { expectedSha256: asset.digest.slice(7) } : {}) };
}

export function verifiedPullDownload(source: Extract<AnalysisSource, { kind: 'pull' }>, pull: GitHubPullRequest, file: GitHubPullFile): VerifiedDownload {
  if (pull.head.sha !== source.headSha || !pull.head.repo || file.filename !== source.path || file.sha !== source.fileSha || file.status === 'removed' ||
    !/^[a-f0-9]{40}$/iu.test(file.sha ?? '')) throw new Error('改进内容已更新，请刷新并重新检查这个文件。 / The changes have been updated. Refresh and inspect the file again.');
  return { owner: pull.head.repo.owner.login, repo: pull.head.repo.name, name: file.filename.split('/').at(-1) || 'program.bin',
    blobSha: file.sha, expectedBlobSha: file.sha };
}
