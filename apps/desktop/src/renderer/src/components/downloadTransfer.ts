const SAMPLE_INTERVAL_MS = 2_000;

export function createDownloadTransferSampler(startedAt: number): (loaded: number, at: number) => number | null {
  let previous = { loaded: 0, at: startedAt };
  let displayedSpeed: number | null = null;
  return (loaded, at) => {
    if (loaded < previous.loaded) previous = { loaded, at };
    const elapsed = at - previous.at;
    if (elapsed >= SAMPLE_INTERVAL_MS) {
      displayedSpeed = Math.max(0, Math.round((loaded - previous.loaded) * 1_000 / elapsed));
      previous = { loaded, at };
    }
    return displayedSpeed;
  };
}

export function downloadAmount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function downloadTransferText(loaded: number, total: number | null, bytesPerSecond: number | null): { speed: string; remaining: string } {
  const speed = bytesPerSecond === null ? '正在计算速度…' : `${downloadAmount(bytesPerSecond)}/秒`;
  if (total === null) return { speed, remaining: '剩余时间未知' };
  if (!bytesPerSecond) return { speed, remaining: '正在估算剩余时间…' };
  const seconds = Math.ceil(Math.max(0, total - loaded) / bytesPerSecond);
  if (seconds < 60) return { speed, remaining: `约 ${seconds} 秒` };
  if (seconds < 3600) return { speed, remaining: `约 ${Math.ceil(seconds / 60)} 分钟` };
  return { speed, remaining: `约 ${Math.ceil(seconds / 3600)} 小时` };
}
