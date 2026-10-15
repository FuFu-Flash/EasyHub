import { getTranslator } from '../localization';
import { readLanguage, type Language } from '../i18n';
const SAMPLE_INTERVAL_MS = 2_000;

export function createDownloadTransferSampler(startedAt: number): (loaded: number, at: number) => number | null {
  let previous = { loaded: 0, at: startedAt };
  let displayedSpeed: number | null = null;
  return (loaded, at) => {
    if (loaded < previous.loaded) previous = { loaded, at };
    const elapsed = at - previous.at;
    if (elapsed >= SAMPLE_INTERVAL_MS) {
      displayedSpeed = Math.max(0, Math.round(((loaded - previous.loaded) * 1_000) / elapsed));
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

export function downloadTransferText(
  loaded: number,
  total: number | null,
  bytesPerSecond: number | null,
  language: Language = readLanguage(),
): { speed: string; remaining: string } {
  const t = getTranslator(language);
  const speed =
    bytesPerSecond === null
      ? t('transfer.calculating')
      : t('transfer.speed', { amount: downloadAmount(bytesPerSecond) });
  if (total === null) return { speed, remaining: t('transfer.unknown') };
  if (!bytesPerSecond) return { speed, remaining: t('transfer.estimating') };
  const seconds = Math.ceil(Math.max(0, total - loaded) / bytesPerSecond);
  if (seconds < 60) return { speed, remaining: t('transfer.seconds', { count: seconds }) };
  if (seconds < 3600) return { speed, remaining: t('transfer.minutes', { count: Math.ceil(seconds / 60) }) };
  return { speed, remaining: t('transfer.hours', { count: Math.ceil(seconds / 3600) }) };
}
