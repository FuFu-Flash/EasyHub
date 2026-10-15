export type PullReviewFilter = 'open' | 'closed';
export type PullReviewExpansion = Record<string, boolean | undefined>;

export function pullReviewGroupKey(repoId: number, filter: PullReviewFilter): string {
  return `${repoId}:${filter}`;
}

/** A user's choice wins over counts that arrive or change after the first render. */
export function pullReviewGroupExpanded(expansion: PullReviewExpansion, repoId: number, filter: PullReviewFilter, count: number | undefined): boolean {
  return expansion[pullReviewGroupKey(repoId, filter)] ?? (filter === 'open' && (count ?? 0) > 0);
}

/** Groups own their errors; each refresh starts before another group can finish. */
export async function refreshPullReviewGroups(groups: Iterable<{ refresh(): Promise<unknown> }>): Promise<void> {
  await Promise.allSettled([...groups].map(group => Promise.resolve().then(() => group.refresh())));
}
