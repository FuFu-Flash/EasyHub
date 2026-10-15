import { usePageRoute } from '../workspace/NavigationContext';
import { DiscoverPage } from './DiscoverPage';
import { HistoryPage } from './HistoryPage';
import { HomePage } from './HomePage';
import { IssuePage } from './IssuePage';
import { IssuesPage } from './IssuesPage';
import { LocalPage } from './LocalPage';
import { NewProjectPage } from './NewProjectPage';
import { ProfilePage } from './ProfilePage';
import { ProjectPage } from './ProjectPage';
import { ProjectsPage } from './ProjectsPage';
import { PublicPage } from './PublicPage';
import { PullsPage } from './PullsPage';
import { RecentHistoryPage } from './RecentHistoryPage';
import { ReleaseCreatePage } from './ReleaseCreatePage';
import { ReleasePage } from './ReleasePage';
import { SettingsPage } from './SettingsPage';
import { SourceHistoryPage } from './SourceHistoryPage';
import { StarredPage } from './StarredPage';
import { VersionPage } from './VersionPage';
const pages = {
  home: HomePage,
  projects: ProjectsPage,
  discover: DiscoverPage,
  project: ProjectPage,
  issues: IssuesPage,
  issue: IssuePage,
  pulls: PullsPage,
  'public-project': PublicPage,
  local: LocalPage,
  'new-project': NewProjectPage,
  downloads: ReleasePage,
  'new-release': ReleaseCreatePage,
  history: HistoryPage,
  version: VersionPage,
  'recent-history': RecentHistoryPage,
  'source-history': SourceHistoryPage,
  settings: SettingsPage,
  profile: ProfilePage,
  starred: StarredPage,
};
export function WorkspacePage() {
  const { view } = usePageRoute();
  const Page = pages[view];
  return <Page />;
}
