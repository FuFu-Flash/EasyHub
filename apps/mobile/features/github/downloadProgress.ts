export interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number | null;
  bytesPerSecond: number;
  etaSeconds: number | null;
}

/** Estimates the current rate from progress samples, including downloads without a content length. */
export function createDownloadTracker(startedAt: number) {
  let previousTime = startedAt;
  let previousBytes = 0;
  let speed = 0;
  return (bytes: number, totalBytes: number, now: number): DownloadProgress => {
    const loaded = Number.isFinite(bytes) ? Math.max(0, bytes) : previousBytes;
    const total = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
    const elapsed = now - previousTime;
    if (loaded < previousBytes) { speed = 0; previousBytes = loaded; previousTime = now; }
    else if (elapsed >= 250) {
      const currentSpeed = (loaded - previousBytes) * 1000 / elapsed;
      speed = speed > 0 ? speed * 0.35 + currentSpeed * 0.65 : currentSpeed;
      previousTime = now;
      previousBytes = loaded;
    }
    return {
      loaded, total,
      percentage: total ? loaded >= total ? 100 : Math.min(99, Math.round(loaded / total * 100)) : null,
      bytesPerSecond: speed,
      etaSeconds: total && speed > 0 ? Math.max(0, (total - loaded) / speed) : null,
    };
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatRemainingTime(seconds: number): string {
  const rounded = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}:${String(rounded % 60).padStart(2, '0')}` : `0:${String(rounded).padStart(2, '0')}`;
}

export function releaseSourceDownload(owner: string, repo: string, tag: string, format: 'zip' | 'tar.gz') {
  return {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${format === 'zip' ? 'zipball' : 'tarball'}/${encodeURIComponent(tag)}`,
    fileName: `${repo}-${tag}.${format}`.replace(/[^-\w.]/g, '_'),
  };
}
