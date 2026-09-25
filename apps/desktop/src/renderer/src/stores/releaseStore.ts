import type { CreateReleaseInput, ProjectRelease, ReleaseAsset, ReleaseChannel } from '@easyhub/types';
import type { MockState } from './mockStore';

// GitHub's published release limits: fewer than 2 GiB per asset, at most 1000 assets.
export const MAX_RELEASE_ASSETS = 1000;
export const MAX_RELEASE_ASSET_SIZE = 2 * 1024 ** 3;

function compareParts(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function nextReleaseTag(releases: ProjectRelease[], channel: ReleaseChannel): string {
  const prefix = channel === 'stable' ? 'v' : channel;
  const candidates = releases.flatMap((release) => {
    const match = release.tagName.match(channel === 'stable' ? /^v(\d+)\.(\d+)(?:\.(\d+))?$/i : new RegExp(`^${prefix}(\\d+)\\.(\\d+)$`, 'i'));
    return match ? [{ parts: match.slice(1).filter((part): part is string => part !== undefined).map(Number), widths: match.slice(1).filter((part): part is string => part !== undefined).map((part) => part.length) }] : [];
  });
  if (!candidates.length) return channel === 'stable' ? 'v0.01' : `${prefix}0.1`;
  const latest = candidates.sort((left, right) => compareParts(right.parts, left.parts))[0]!;
  const next = [...latest.parts];
  next[next.length - 1] = next[next.length - 1]! + 1;
  return `${prefix}${next.map((part, index) => String(part).padStart(latest.widths[index] ?? 1, '0')).join('.')}`;
}

export function validateReleaseAssets(assets: ReleaseAsset[]): void {
  if (assets.length > MAX_RELEASE_ASSETS) throw new Error('每个新版本最多添加 1000 个文件');
  const names = new Set<string>();
  for (const asset of assets) {
    const name = asset.name.trim();
    if (!name || /[\\/\u0000-\u001f]/u.test(name)) throw new Error('文件名称无效，请重新选择');
    if (!Number.isFinite(asset.size) || asset.size < 0 || asset.size >= MAX_RELEASE_ASSET_SIZE) {
      throw new Error(`“${name}”必须小于 2 GiB`);
    }
    const key = name.toLocaleLowerCase('en-US');
    if (names.has(key)) throw new Error(`“${name}”与已选文件同名`);
    names.add(key);
  }
}

export function validateReleaseInput(existing: ProjectRelease[], input: CreateReleaseInput): void {
  const tagName = input.tagName.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(tagName) || tagName.endsWith('.') || tagName.includes('..') || tagName.endsWith('.lock')) {
    throw new Error('版本号只能包含字母、数字、点、短横线和下划线，并且不能以点结尾');
  }
  if (existing.some((release) => release.tagName.toLocaleLowerCase('en-US') === tagName.toLocaleLowerCase('en-US'))) {
    throw new Error('这个项目已经使用过该版本号');
  }
  const title = input.title.trim();
  if (!title) throw new Error('请填写版本名称');
  const body = input.body.trim();
  if (!body) throw new Error('请填写版本介绍');
  validateReleaseAssets(input.assets);
}

export function publishRelease(state: MockState, projectId: string, input: CreateReleaseInput): { state: MockState; release: ProjectRelease } {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new Error('找不到这个项目');
  if (project.archived) throw new Error('请先取消项目存档');
  validateReleaseInput(project.releases, input);
  const tagName = input.tagName.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  const release: ProjectRelease = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    tagName,
    title,
    body,
    channel: input.channel,
    publishedAt: new Date().toISOString(),
    assets: input.assets.map((asset) => ({ ...asset })),
  };
  return {
    release,
    state: { ...state, projects: state.projects.map((item) => item.id === projectId ? { ...item, releases: [release, ...item.releases] } : item) },
  };
}
