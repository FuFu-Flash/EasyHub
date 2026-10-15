import { useTranslation } from '../localization';
import type { GitHubPullRequest,GitHubRepo } from '@easyhub/github';
import { ArrowLeft,X } from 'lucide-react';
import { useCallback,useRef,useState } from 'react';
import { canReviewRepository } from '../activityCounts';
import { ErrorMessage } from '../components/ErrorMessage';
import { PullRequestsPanel } from '../components/PullRequestsPanel';
import { PullReviewGroups } from '../components/PullReviewGroups';
import { TranslationPreferencesContext } from '../components/TranslatableContent';


import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { useRepository } from '../workspace/pageData';
import { RepoLogo } from './shared';

import { useNestedNavigation } from '../nestedNavigation';
export function PullsPage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { user, language, repos, activityCounts, activityError, automaticTranslation, translationTarget, translationNames, downloads, refreshActivityCount, navigation } = w;
  const { params } = usePageRoute();
  const scrollArea = navigation.scrollArea;
  const reviewRepos = repos.filter(repo => canReviewRepository(repo, user.login));
  const navigateSidebar = navigation.sidebar;

  const selected=useRepository();const pullInitialRequest=(w.cache.get('pull:'+params.repo+':'+params.number) as GitHubPullRequest|undefined)??null;
  const pullBack=useRef<(()=>void)|null>(null);const [pullBackBlocked,setPullBackBlocked]=useState(false);const root=useRef<HTMLDivElement>(null);
  const onPullBackChange=useCallback((back:(()=>void)|null,_key:string,blocked:boolean)=>{pullBack.current=back;setPullBackBlocked(blocked);},[]);
  const setSelected=(_value:null)=>navigation.navigate('pulls',{});
  const openRequest=(repo:GitHubRepo,request?:GitHubPullRequest)=>{w.cache.set('repo:'+repo.full_name,repo);if(request)w.cache.set('pull:'+repo.full_name+':'+request.number,request);navigation.navigate('pulls',{repo:repo.full_name,number:request?.number});};
  useNestedNavigation(root,()=>{if(pullBackBlocked)return;if(pullBack.current)pullBack.current();else navigation.back();},null,pullBackBlocked);

 return <div ref={root} style={{display:"contents"}}>{selected && <button className="back-link" disabled={pullBackBlocked} onClick={()=>{if(pullBack.current)pullBack.current();else navigation.back();}}><ArrowLeft size={17}/>{t("pullsPage.back")}</button>}<>
        <div className="page-header"><div><div className="eyebrow">{t("pullsPage.improveTogether")}</div><h1>{t("pullsPage.pullRequestReviews")}</h1><p>{t("pullsPage.reviewProposedChangesAndDecideWhetherToMergeThem")}</p></div></div>
        {activityError && <p className="live-error" role="alert"><ErrorMessage error={activityError} /></p>}
        {selected ? <>
          <div className="toolbar"><button className="filter-project" onClick={() => { setSelected(null); }}>{selected.name}<X size={15} /></button></div>
          <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation && !selected.private, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}><PullRequestsPanel onBackChange={onPullBackChange} scrollArea={scrollArea} repo={selected} initialRequest={pullInitialRequest} currentUser={user.login} language={language} downloadBusy={downloads.busy} onActivityChanged={() => void refreshActivityCount(selected)} onOpenAiSettings={() => navigateSidebar('settings')} onDownloadFile={(number, path, headSha) => downloads.start({ kind: 'pull-file', repo: selected, number, path, headSha, fileName: path.split('/').pop() || path })} /></TranslationPreferencesContext.Provider>
        </> : <PullReviewGroups repos={reviewRepos} counts={activityCounts} logo={(repo) => <RepoLogo repo={repo} small />} onOpen={openRequest} />}
      </></div>;

}
