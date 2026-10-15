import { ReleaseDownloads } from '../components/ReleaseDownloads';
import { TranslationPreferencesContext } from '../components/TranslatableContent';


import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageActions } from '../workspace/pageActions';
import { useRepository } from '../workspace/pageData';
import { PageStatus } from './shared';


export function ReleasePage() {

  const w = useWorkspace();
  const { user, language, automaticTranslation, translationTarget, translationNames, downloads, navigation } = w;
  const { params } = usePageRoute();
  const { openReadmeLink } = usePageActions();
const selected=useRepository();const canEditSelectedRelease=Boolean(selected&&!selected.archived&&(selected.permissions?.push||selected.permissions?.admin||selected.owner.login.toLowerCase()===user.login.toLowerCase()));if(!selected)return <PageStatus loading error=""/>;
 return <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}><ReleaseDownloads draftAccount={user.login} repo={selected} language={language} focusTag={params.tag} editOnOpen={Boolean(params.edit)} canEdit={canEditSelectedRelease} onDownload={(request) => void downloads.start(request)} downloadBusy={downloads.busy} onBack={() => navigation.back('project')} onOpenLink={(url) => void openReadmeLink(url, selected)} /></TranslationPreferencesContext.Provider>;

}
