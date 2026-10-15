import { LocalWorkspace } from '../LocalWorkspace';
import type { GitHubRepo } from '@easyhub/github';
import { useTranslation } from '../localization';


import { useWorkspace } from '../workspace/WorkspaceContext';


export function NewProjectPage() {

  const w = useWorkspace();
  const t = useTranslation();
  const { repos, downloads, loadRepos, refreshLocalLinks, navigation } = w;
  const onCreated = async (repo?: GitHubRepo) => {
    if (repo) {
      w.cache.set('repo:' + repo.full_name, repo);
      w.set('repos', (items) => [repo, ...items.filter((item) => item.id !== repo.id)]);
      w.setNotice(t("localWorkspace.cloudProjectCreated"));
      navigation.navigate('project', { repo: repo.full_name, section: 'projects' }, true);
      return;
    }
    await loadRepos(true); await refreshLocalLinks();
  };

 return <LocalWorkspace mode="create" repos={repos} selectedRepo={null} onBack={() => navigation.back('projects')} onCreated={onCreated} onCreatedLocal={(link) => navigation.navigate('local', { repo: `${link.owner}/${link.name}`, localId: link.id, publish: true }, true)} onDownloadProject={(repo) => downloads.start({ kind: 'project', repo, fileName: repo.name })} downloadBusy={downloads.busy} />;

}
