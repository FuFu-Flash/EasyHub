import type { LocalProjectLink } from '@easyhub/types';
export function repositoryIdentity(address: string): string {
  return address
    .trim()
    .replace(/^git@github\.com:/iu, '')
    .replace(/^(?:https?:\/\/)?github\.com\//iu, '')
    .replace(/\.git\/?$/iu, '')
    .replace(/\/$/u, '')
    .toLowerCase();
}
export function findLocalLink(
  repo: { id: number; full_name: string },
  links: readonly (LocalProjectLink & { remoteUrl?: string })[],
  failed: Readonly<Record<string, boolean>> = {},
): LocalProjectLink | undefined {
  const identity = repositoryIdentity(repo.full_name);
  const matches = links.filter(
    (link) =>
      link.repositoryId === repo.id || repositoryIdentity(link.remoteUrl ?? `${link.owner}/${link.name}`) === identity,
  );
  // One repository can have several local folders; prefer one whose status could be read.
  return matches.find((link) => !failed[link.id]) ?? matches[0];
}
