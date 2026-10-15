import { LocalWorkspace } from '../LocalWorkspace';


import { useWorkspace } from '../workspace/WorkspaceContext';


export function NewProjectPage() {

  const w = useWorkspace();
  const { repos, downloads, loadRepos, refreshLocalLinks, navigation } = w;
  const onCreated = async () => { await loadRepos(true); await refreshLocalLinks(); };

 return <LocalWorkspace mode="create" repos={repos} selectedRepo={null} onBack={() => navigation.back('projects')} onCreated={onCreated} onDownloadProject={(repo) => downloads.start({ kind: 'project', repo, fileName: repo.name })} downloadBusy={downloads.busy} />;

}
