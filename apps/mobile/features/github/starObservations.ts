import type { GitHubRepo, TrendingPeriod } from '@easyhub/github';

interface Snapshot { at: number; stars: number }
export type StarObservations = Record<string, Snapshot[]>;

export function parseObservations(raw: string): StarObservations {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const result: StarObservations = {};
    for (const [key, value] of Object.entries(data)) {
      if (!/^\d+$/.test(key) || !Array.isArray(value)) continue;
      const valid = value.filter((item): item is Snapshot => typeof item === 'object' && item !== null
        && typeof item.at === 'number' && Number.isFinite(item.at)
        && typeof item.stars === 'number' && Number.isFinite(item.stars) && item.stars >= 0).slice(-31);
      if (valid.length) result[key] = valid;
    }
    return result;
  } catch { return {}; }
}

export function recordObservations(previous: StarObservations, repos: GitHubRepo[], now: number): StarObservations {
  const next: StarObservations = {};
  for (const [key, value] of Object.entries(previous)) {
    const recent = value.filter((item) => item.at >= now - 31 * 86400000).slice(-30);
    if (recent.length) next[key] = recent;
  }
  for (const repo of repos) {
    const key = String(repo.id);
    next[key] = [...(next[key] ?? []), { at: now, stars: repo.stargazers_count ?? 0 }].slice(-31);
  }
  return Object.fromEntries(Object.entries(next).sort((a, b) => (b[1].at(-1)?.at ?? 0) - (a[1].at(-1)?.at ?? 0)).slice(0, 500));
}

export function starTrend(repo: GitHubRepo, observations: StarObservations, period: TrendingPeriod, now: number): string {
  const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  const history = observations[String(repo.id)] ?? [];
  const first = history.find((item) => item.at >= now - days * 86400000 && item.stars < (repo.stargazers_count ?? 0));
  if (first) return `观察期 +${(repo.stargazers_count ?? 0) - first.stars} Star`;
  return history.some((item) => item.at < now - 3600000) ? '观察期无新增 Star' : '增长观察中';
}
