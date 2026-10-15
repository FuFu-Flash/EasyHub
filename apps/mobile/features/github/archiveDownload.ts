import type { Translator } from '../localization/index.ts';
import { InterfaceError } from '../localization/error.ts';
import type { GitHubRepo } from '@easyhub/github';
import type { DownloadProgress } from './downloadProgress';

export interface ArchiveDownloadTarget { path: string; fileName: string }
export type ArchiveTransport = (path: string, name: string, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal) => Promise<void>;

function archiveTarget(owner: string, repo: string, ref: string, fileName: string): ArchiveDownloadTarget {
  if (!/^[-\w.]+$/u.test(owner) || !/^[-\w.]+$/u.test(repo) || ['.', '..'].includes(owner) || ['.', '..'].includes(repo) || !ref.trim()) throw new InterfaceError("archiveDownload.invalidSourceDownloadAddress").withDiagnostic("源码下载地址无效。 / Invalid source download address.");
  return { path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(ref)}`, fileName: fileName.replace(/[^-\w.]/gu, '_') };
}

export function currentProjectArchive(repo: Pick<GitHubRepo, 'owner' | 'name' | 'default_branch'>): ArchiveDownloadTarget {
  return archiveTarget(repo.owner.login, repo.name, repo.default_branch, `${repo.name}-${repo.default_branch}.zip`);
}

export function commitArchive(owner: string, repo: string, sha: string): ArchiveDownloadTarget {
  if (!/^[a-f0-9]{40}$/iu.test(sha)) throw new InterfaceError("archiveDownload.invalidVersionAddress").withDiagnostic("历史版本地址无效。 / Invalid version address.");
  return archiveTarget(owner, repo, sha, `${repo}-${sha.slice(0, 7)}.zip`);
}

/** Native transfers may finish after cancellation; neither progress nor completion should revive them. */
export async function transferArchive(transport: ArchiveTransport, target: ArchiveDownloadTarget, onProgress: (loaded: number, total: number) => void, signal: AbortSignal): Promise<'complete' | 'cancelled'> {
  if (signal.aborted) return 'cancelled';
  try {
    await transport(target.path, target.fileName, (loaded, total) => { if (!signal.aborted) onProgress(loaded, total); }, signal);
    return signal.aborted ? 'cancelled' : 'complete';
  } catch (cause) {
    if (signal.aborted) return 'cancelled';
    throw cause;
  }
}

export function archiveTransferTitle(progress: DownloadProgress | null, t: Translator): string {
  return progress?.percentage === 100 ? t("archiveDownload.downloadCompletePreparingToSaveOrShare")
    : progress ? `${t("archiveDownload.downloading")}${progress.percentage === null ? '…' : ` ${progress.percentage}%`}` : t("archiveDownload.preparingDownload");
}
