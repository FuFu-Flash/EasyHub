import type { GitHubRepo } from '@easyhub/github';

export type DownloadRequest =
  | { kind: 'archive'; repo: GitHubRepo; ref: string; assetId?: number; fileName: string; offerAdd?: boolean }
  | { kind: 'pull-file'; repo: GitHubRepo; number: number; path: string; headSha: string; fileName: string }
  | { kind: 'project'; repo: GitHubRepo; fileName: string };

export interface DownloadItem {
  id: string;
  request: DownloadRequest;
  state: 'queued' | 'running' | 'paused' | 'complete' | 'failed' | 'cancelled';
  percent: number | null;
  loaded: number;
  total: number | null;
  bytesPerSecond: number | null;
  phase: string;
  path?: string;
  localLinkId?: string;
  error?: string;
  seen: boolean;
}

export type DownloadCommand = 'pause' | 'resume' | 'cancel' | 'remove' | 'seen';
