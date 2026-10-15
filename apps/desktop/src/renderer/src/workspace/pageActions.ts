import type { GitHubCommit, GitHubIssue, GitHubRepo, GitHubSearchUser } from '@easyhub/github';
import type { LocalProjectLink } from '@easyhub/types';
import { readmeReleaseLink } from '../components/readmeReleaseLink';
import { errorText } from '../errors';
import { parseProjectAddress } from '../projectAddress';
import { usePageRoute } from './NavigationContext';
import { useWorkspace } from './WorkspaceContext';

export function usePageActions() {
  const workspace = useWorkspace(),
    { navigation, cache, user, repos, api, recordSearch } = workspace;
  const route = usePageRoute();
  const remember = (repo: GitHubRepo) => {
    cache.set('repo:' + repo.full_name, repo);
  };
  const openProject = (repo: GitHubRepo, localId?: string | null) => {
    remember(repo);
    navigation.navigate('project', {
      repo: repo.full_name,
      localId: localId ?? undefined,
      section: route.view === 'starred' ? 'profile' : 'projects',
    });
  };
  const openPublicProject = (repo: GitHubRepo, tag?: string) => {
    remember(repo);
    navigation.navigate('public-project', {
      repo: repo.full_name,
      ...(tag !== undefined ? { tag } : {}),
      section: navigation.section,
    });
  };
  const openLocal = (link: LocalProjectLink, repo?: GitHubRepo, publish = false, sync = false) => {
    if (repo) remember(repo);
    navigation.navigate('local', {
      repo: repo?.full_name,
      localId: link.id,
      publish,
      sync,
      ...(publish || sync ? { visit: Date.now() } : {}),
    });
  };
  const openIssue = (item: GitHubIssue, repo: GitHubRepo) => {
    remember(repo);
    cache.set(`issue:${repo.full_name}:${item.number}`, item);
    navigation.navigate('issue', { repo: repo.full_name, number: item.number });
  };
  const openVersionFor = (repo: GitHubRepo, commit: GitHubCommit) => {
    remember(repo);
    cache.set(`commit:${repo.full_name}:${commit.sha}`, commit);
    navigation.navigate('version', { repo: repo.full_name, sha: commit.sha, section: navigation.section });
  };
  const openProjectAddress = async (value: string) => {
    const address = parseProjectAddress(value);
    if (!address) return;
    try {
      const repo =
        repos.find((item) => item.full_name.toLowerCase() === `${address.owner}/${address.name}`.toLowerCase()) ??
        (await api<GitHubRepo>('repository', address.owner, address.name));
      if (repo.owner.login.toLowerCase() === user.login.toLowerCase() || repo.permissions?.push) openProject(repo);
      else if (!repo.private) openPublicProject(repo);
      else throw new Error('这个项目当前无法浏览。');
      recordSearch(value, 'public');
    } catch (cause) {
      workspace.setError(errorText(cause));
    }
  };
  const submitProjectSearch = (value: string, scope: 'projects' | 'users' = 'projects') => {
    if (parseProjectAddress(value)) {
      void openProjectAddress(value);
      return;
    }
    if (value.trim().length < 2) return;
    navigation.navigate('discover', { query: value, scope, page: 1, searchPage: 1 });
    recordSearch(value, scope === 'users' ? 'users' : 'public');
  };
  const openSearchedUser = (candidate: GitHubSearchUser) => {
    cache.set('profile:' + candidate.login, candidate);
    navigation.navigate('profile', { login: candidate.login, section: navigation.section });
  };
  const openProfileRepository = async (fullName: string) => {
    const [owner, name] = fullName.split('/');
    try {
      openPublicProject(await api<GitHubRepo>('publicRepo', owner, name));
    } catch (cause) {
      workspace.setError(errorText(cause));
    }
  };
  const openReadmeLink = async (url: string, current: GitHubRepo) => {
    const release = readmeReleaseLink(url);
    if (!release) {
      try {
        await workspace.easyHub.openExternalLink(url);
      } catch (cause) {
        workspace.setError(errorText(cause));
      }
      return;
    }
    const fullName = `${release.owner}/${release.repo}`;
    const owned = repos.find((item) => item.full_name.toLowerCase() === fullName.toLowerCase());
    if (
      owned ||
      (current.full_name.toLowerCase() === fullName.toLowerCase() &&
        current.owner.login.toLowerCase() === user.login.toLowerCase())
    ) {
      navigation.navigate('downloads', { repo: (owned ?? current).full_name, tag: release.tag });
      return;
    }
    try {
      const remote = await api<GitHubRepo>('publicRepo', release.owner, release.repo);
      remember(remote);
      navigation.navigate('public-project', {
        repo: remote.full_name,
        tag: release.tag,
        download: true,
        section: navigation.section,
      });
    } catch (cause) {
      workspace.setError(errorText(cause));
    }
  };
  const openCreatedFork = (repo: GitHubRepo) => {
    workspace.set('repos', (old) => [repo, ...old.filter((item) => item.id !== repo.id)]);
    openProject(repo);
  };
  return {
    openProject,
    openPublicProject,
    openLocal,
    openIssue,
    openVersionFor,
    openProjectAddress,
    submitProjectSearch,
    openSearchedUser,
    openProfileRepository,
    openReadmeLink,
    openCreatedFork,
  };
}
