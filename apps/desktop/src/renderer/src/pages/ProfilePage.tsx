import type { GitHubUser } from '@easyhub/github';
import { UserProfile } from '../components/UserProfile';


import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageActions } from '../workspace/pageActions';


export function ProfilePage() {

  const w = useWorkspace();
  const { user, navigation } = w;
  const { params } = usePageRoute();
  const { openProfileRepository } = usePageActions();
const profileUser=(w.cache.get('profile:'+params.login) as GitHubUser|undefined)??(params.login===user.login?user:{login:params.login??user.login,name:null,avatar_url:'',html_url:''});
 return <UserProfile key={profileUser.login} login={profileUser.login} initialUser={profileUser} onBack={() => navigation.back()} onOpenRepository={(fullName) => void openProfileRepository(fullName)} />;

}
