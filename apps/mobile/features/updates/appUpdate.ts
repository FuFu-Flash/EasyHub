export const APP_RELEASES_URL = 'https://api.github.com/repos/FuFu-Flash/EasyHub/releases?per_page=100';

export interface AppUpdateResult {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  releaseUrl: string;
}

export type AppUpdateErrorCode = 'version' | 'network' | 'rate-limit' | 'response' | 'no-android-release';

export class AppUpdateError extends Error {
  readonly code: AppUpdateErrorCode;
  constructor(code: AppUpdateErrorCode) {
    super(code);
    this.name = 'AppUpdateError';
    this.code = code;
  }
}

type StableVersion = readonly [number, number, number];

/** The desktop update channel accepts stable, three-part release versions only. */
function version(value: unknown): StableVersion | null {
  if (typeof value !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? [parts[0]!, parts[1]!, parts[2]!] : null;
}

function compare(a: StableVersion, b: StableVersion): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
}

function hasAndroidApp(assets: unknown[], releaseVersion: string): boolean {
  const names = new Set(['arm64', 'arm64-v8a', 'universal', 'armv7', 'armeabi-v7a', 'x86', 'x86_64']
    .map((abi) => `EasyHub-Android-${releaseVersion}-${abi}.apk`));
  return assets.some((asset) => asset !== null && typeof asset === 'object' && 'name' in asset && typeof asset.name === 'string' && names.has(asset.name));
}

export function selectAndroidUpdate(currentVersion: string, data: unknown): AppUpdateResult {
  const current = version(currentVersion);
  if (!current) throw new AppUpdateError('version');
  if (!Array.isArray(data)) throw new AppUpdateError('response');
  const releases = data.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    // Android has an independent release tag while desktop retains its existing vX.Y.Z tags.
    const tagVersion = typeof item.tag_name === 'string' && item.tag_name.startsWith('android-v')
      ? item.tag_name.slice('android-'.length) : item.tag_name;
    const parsed = version(tagVersion);
    if (!parsed || item.draft !== false || item.prerelease !== false || !Array.isArray(item.assets)) return [];
    const number = parsed.join('.');
    return hasAndroidApp(item.assets, number) ? [{ tag: String(item.tag_name), version: number, parsed }] : [];
  }).sort((a, b) => compare(b.parsed, a.parsed));
  const latest = releases[0];
  if (!latest) throw new AppUpdateError('no-android-release');
  return {
    currentVersion,
    latestVersion: latest.version,
    available: compare(latest.parsed, current) > 0,
    // Build the URL from the official repository, rather than trusting remote html_url.
    releaseUrl: `https://github.com/FuFu-Flash/EasyHub/releases/tag/${encodeURIComponent(latest.tag)}`,
  };
}

function checkCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Update check cancelled.');
  error.name = 'AbortError';
  throw error;
}

/** Anonymous, manual checks use the same endpoint and 15-second deadline as desktop. */
export async function checkAndroidAppUpdate(currentVersion: string, transport: typeof fetch = fetch, signal?: AbortSignal): Promise<AppUpdateResult> {
  if (!version(currentVersion)) throw new AppUpdateError('version');
  checkCancelled(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await transport(APP_RELEASES_URL, {
      // Expo's native fetch ignores RequestInit.cache; OkHttp honors this header.
      headers: { Accept: 'application/vnd.github+json', 'Cache-Control': 'no-store' },
      cache: 'no-store',
      signal: controller.signal,
    });
    checkCancelled(signal);
    if (controller.signal.aborted) throw new AppUpdateError('network');
    if (!response.ok) throw new AppUpdateError(response.status === 403 || response.status === 429 ? 'rate-limit' : 'network');
    let data: unknown;
    try { data = await response.json(); } catch { throw new AppUpdateError('response'); }
    checkCancelled(signal);
    if (controller.signal.aborted) throw new AppUpdateError('network');
    return selectAndroidUpdate(currentVersion, data);
  } catch (cause) {
    checkCancelled(signal);
    if (cause instanceof AppUpdateError) throw cause;
    throw new AppUpdateError('network');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
