import { describe, expect, it } from 'vitest';
import type { GitHubRepo } from '@easyhub/github';
import type { LocalProjectLink, SyncPreview } from '@easyhub/types';
import { homeTasks } from './homeTasks';

const repo = (id: number, name: string) => ({ id, name, owner: { login: 'me' } }) as GitHubRepo;
const link = (id: string, repositoryId: number) =>
  ({ id, repositoryId, owner: 'me', name: id, localPath: 'C:\\p\\' + id }) as LocalProjectLink;
const counts = (issues: number, pullRequests: number) => ({
  issues,
  closedIssues: 0,
  pullRequests,
  closedPullRequests: 0,
});
const preview = (state: SyncPreview['state']) => ({ state }) as SyncPreview;

describe('home tasks', () => {
  const mod = repo(1, 'MinecraftMod'),
    tool = repo(2, 'MyTool'),
    site = repo(3, 'PersonalSite');
  const base = {
    repos: [tool, mod, site],
    reviewRepos: [tool, mod, site],
    localLinks: [link('mod', 1), link('site', 3)],
    localStatuses: {
      mod: { files: Array(6).fill({ path: 'a', kind: 'modified' }), needsReview: false },
      site: { files: [], needsReview: false },
    },
    remotePreviews: { mod: preview('current'), site: preview('ready') },
    localErrors: {},
    activityCounts: { 1: counts(1, 0), 2: counts(3, 1), 3: counts(0, 0) },
  };

  it('puts unpublished files first, then issues and pull requests, and incoming content last', () => {
    expect(homeTasks(base).map((task) => [task.kind, task.repo.name, task.count])).toEqual([
      ['publish', 'MinecraftMod', 6],
      ['issues', 'MyTool', 3],
      ['issues', 'MinecraftMod', 1],
      ['pulls', 'MyTool', 1],
      ['sync', 'PersonalSite', undefined],
    ]);
  });

  it('asks for a decision before publishing when content needs review', () => {
    const tasks = homeTasks({ ...base, remotePreviews: { ...base.remotePreviews, mod: preview('review') } });
    expect(tasks[0]).toMatchObject({ kind: 'review', repo: mod });
    expect(tasks.some((task) => task.kind === 'publish')).toBe(false);
  });

  it('reports unreadable folders and waits for status before offering to get the latest', () => {
    const tasks = homeTasks({ ...base, localStatuses: {}, localErrors: { mod: true } });
    expect(tasks.filter((task) => task.link).map((task) => task.kind)).toEqual(['unavailable']);
  });

  it('only counts pull requests in projects the user can review and skips unknown folders', () => {
    const tasks = homeTasks({ ...base, reviewRepos: [mod], localLinks: [...base.localLinks, link('gone', 99)] });
    expect(tasks.some((task) => task.kind === 'pulls')).toBe(false);
    expect(tasks.some((task) => task.link?.id === 'gone')).toBe(false);
  });
});
