import type { AppUpdateResult } from '../../shared/appUpdate';

const RELEASES_URL = 'https://api.github.com/repos/FuFu-Flash/EasyHub/releases?per_page=100';
type Version = readonly [number, number, number];
function version(value: unknown): Version | null {
  if (typeof value !== 'string') return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? [parts[0]!, parts[1]!, parts[2]!] : null;
}
function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

export async function checkAppUpdate(currentVersion: string, transport: typeof fetch, platform: NodeJS.Platform = process.platform): Promise<AppUpdateResult> {
  const current = version(currentVersion);
  if (!current) throw new Error('无法识别当前应用版本。');
  let response: Response;
  try {
    response = await transport(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000), cache: 'no-store' });
  } catch { throw new Error('暂时无法检查更新，请检查网络后重试。'); }
  if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? '检查更新过于频繁，请稍后重试。' : '暂时无法检查更新，请稍后重试。');
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('暂时无法获取版本信息，请稍后重试。');
  const releases = data.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const tag = typeof item.tag_name === 'string' ? item.tag_name : '';
    const parsed = version(platform === 'darwin' ? tag.replace(/^macos-/i, '') : tag);
    if (!parsed || item.draft !== false || item.prerelease !== false || !Array.isArray(item.assets)) return [];
    const number = parsed.join('.');
    const compatible = item.assets.some((asset: unknown) => typeof asset === 'object' && asset !== null && 'name' in asset &&
      (platform === 'darwin'
        ? [`EasyHub-macOS.dmg`, `EasyHub-macOS.zip`, `EasyHub-${number}-macOS.dmg`, `EasyHub-${number}-macOS.zip`,
          `EasyHub-${number}-arm64.dmg`, `EasyHub-${number}-arm64-mac.zip`].includes(String(asset.name))
        : platform === 'win32' && (asset.name === `EasyHub-${number}-setup.exe` || asset.name === `EasyHub-${number}-portable.exe`)));
    return compatible ? [{ tag: String(item.tag_name), version: number, parsed }] : [];
  }).sort((a, b) => compare(b.parsed, a.parsed));
  const latest = releases[0];
  if (!latest) throw new Error(platform === 'darwin' ? '暂时没有发布可用的 macOS 安装包。请使用项目提供的 Mac 下载路径。' : '暂时没有可用的 Windows 版本，请稍后重试。');
  return { currentVersion, latestVersion: latest.version, available: compare(latest.parsed, current) > 0,
    releaseUrl: `https://github.com/FuFu-Flash/EasyHub/releases/tag/${encodeURIComponent(latest.tag)}` };
}
