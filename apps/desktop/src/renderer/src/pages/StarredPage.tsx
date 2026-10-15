import { StarredProjects } from '../components/StarredProjects';

import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageActions } from '../workspace/pageActions';

export function StarredPage() {
  const w = useWorkspace();
  const { user, navigation } = w;
  const { openProject, openPublicProject } = usePageActions();

  return (
    <StarredProjects
      onBack={() => navigation.back()}
      onOpen={(repo) => {
        if (repo.owner.login.toLowerCase() === user.login.toLowerCase() || repo.permissions?.push) {
          void openProject(repo);
        } else openPublicProject(repo);
      }}
    />
  );
}
