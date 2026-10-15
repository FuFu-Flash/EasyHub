import { useTranslation } from '../localization';
import type { GitHubCommit,GitHubRepo } from '@easyhub/github';
import type { LocalProjectLink } from '@easyhub/types';
import { ArrowRight,ChevronRight,CloudDownload,FolderOpen } from 'lucide-react';
import { canReviewRepository,sumActivity } from '../activityCounts';
import { DashboardIntro } from '../components/DashboardIntro';
import { ErrorMessage } from '../components/ErrorMessage';
import { errorText as message } from '../errors';
import { formatRelative } from '../format';
import { projectPresentation } from '../projectPresentation';
import { findLocalLink } from '../repositoryLinks';
import { usePageFeedback } from '../workspace/pageFeedback';


import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import type { View } from '../workspace/navigation';
import { usePageActions } from '../workspace/pageActions';
import { usePageData } from '../workspace/pageData';
import { ownerOf,RepoLogo } from './shared';


export function HomePage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { setNotice, setError } = usePageFeedback();
  const { user, language, repos, localLinks, localStatuses, remotePreviews, localErrors, activityCounts, checkingLocal, loading: sharedLoading, api, easyHub, loadRepos, refreshLocalLinks, navigation } = w;
  const { params } = usePageRoute();
  const { openProject, openLocal, openVersionFor } = usePageActions();
  const relativeDate = formatRelative;
  const ownRepos = repos.filter(repo => !repo.fork);
  const totalPendingIssues = sumActivity(repos, activityCounts, 'issues'), reviewRepos = repos.filter(repo => canReviewRepository(repo, user.login)), totalPendingPulls = sumActivity(reviewRepos, activityCounts, 'pullRequests');
  const pendingIssueCount = (repo: GitHubRepo) => activityCounts[repo.id]?.issues ?? null;
  const setView = (view: View) => navigation.navigate(view, ['project','local','issues','pulls','downloads','history','new-release','source-history'].includes(view) ? {repo:params.repo,localId:params.localId} : {});
  const onCreated = async () => { await loadRepos(true); await refreshLocalLinks(); };

  const updates = usePageData<{items:{repo:GitHubRepo;commit:GitHubCommit}[];partial:boolean}>('recent-updates', async () => {
    const results = await Promise.allSettled(repos.filter(repo=>!repo.fork).slice(0,4).map(async repo=>({repo,items:await api<GitHubCommit[]>('commits',ownerOf(repo),repo.name)})));
    const items=results.flatMap(result=>result.status==='fulfilled'?result.value.items.slice(0,3).map(commit=>({repo:result.value.repo,commit})):[]).sort((a,b)=>(Date.parse(b.commit.commit.author?.date??'')||0)-(Date.parse(a.commit.commit.author?.date??'')||0));
    return {items,partial:results.some(result=>result.status==='rejected')};
  }, {items:[],partial:false}, repos.map(repo=>repo.id+':'+repo.updated_at).join('|'));
  const recentUpdates=updates.data.items,recentLoading=updates.loading,recentError=updates.error||(updates.data.partial?t("homePage.updatesForSomeProjectsCouldNotBeLoaded"):'');

  const busy=sharedLoading;
  const pendingLocal=localLinks.map(link=>({link,repo:repos.find(repo=>repo.id===link.repositoryId),status:localStatuses[link.id]})).find(item=>item.repo&&item.status?.files.length);
  const states=localLinks.map(link=>projectPresentation(localStatuses[link.id],remotePreviews[link.id],localErrors[link.id], language));
  const localState=localLinks.length===0?'none':checkingLocal||states.some(s=>s.state==='checking')?'checking':states.some(s=>s.state==='unavailable'||s.state==='review')?'unavailable':states.some(s=>s.state==='remote')?'remote':'saved';
  const unpublishedCount=localLinks.some(link=>!localStatuses[link.id]||localErrors[link.id])?null:localLinks.reduce((n,link)=>n+(localStatuses[link.id]?.files.length??0),0);
  async function getLatestFromHome(link:LocalProjectLink,repo:GitHubRepo){
    try{const preview=await easyHub.localCheckSync(link.id);if(preview.state==='review'){openLocal(link,repo,false,true);return;}if(preview.state==='blocked'){setError(preview.message??t("homePage.cannotSafelyGetTheLatestChangesRightNow"));return;}if(preview.state==='ready')await easyHub.localSync(link.id,preview.remoteRevision,[]);w.set('refreshRevision',n=>n+1);await onCreated();setNotice(t("homePage.thisProjectIsUpToDate"));}catch(cause){setError(message(cause));}
  }
  function homeRepoRow(repo: GitHubRepo) {
    const link = findLocalLink(repo, localLinks);
    const changed = link ? localStatuses[link.id]?.files.length ?? 0 : 0;
    const remote = link ? remotePreviews[link.id] : undefined;
    const state = link ? projectPresentation(localStatuses[link.id], remote, localErrors[link.id], language) : { state: 'saved', text: t("homePage.savedOnGithub") };
    const hasRemote = remote?.state === 'ready' || remote?.state === 'review';
    return <div className="home-project-row" key={repo.id}>
      <RepoLogo repo={repo} />
      <button className="home-project-name" onClick={() => void openProject(repo)}><strong>{repo.name}</strong><span>{repo.description || t("homePage.noProjectDescriptionYet")}</span></button>
      <div className="home-project-meta"><span className={`home-row-status ${state.state}`}><i />{changed ? t("homePage.changesToReview") : state.text}</span><small>{t('home.rowMeta', { time: relativeDate(repo.updated_at, language), count: pendingIssueCount(repo) ?? '…' })}</small></div>
      <div className="home-project-actions">{remote?.state === 'review' ? <button className="button button-primary" onClick={() => { openLocal(link!, repo, false, true); }}>{t("homePage.reviewContents")}</button> : changed && link ? <button className="button button-primary" onClick={() => openLocal(link, repo)}>{t("homePage.viewChanges")}</button> : hasRemote && link ? <button className="button button-quiet" disabled={busy} onClick={() => void getLatestFromHome(link, repo)}>{t("homePage.getLatest")}</button> : <button className="button button-quiet" onClick={() => void openProject(repo)}>{t("homePage.openProject")}</button>}</div>
    </div>;
  }


 return <>
        <DashboardIntro projectCount={ownRepos.length} unpublishedCount={unpublishedCount} localState={localState} projectChanges={pendingLocal?.status?.files.length} issueCount={totalPendingIssues} pullCount={totalPendingPulls} projectName={pendingLocal?.repo?.name} onCreate={() => setView('new-project')} onContinue={() => { if (pendingLocal) openLocal(pendingLocal.link, pendingLocal.repo, true); else { navigation.navigate('projects',{scope:localLinks.length?'local':'mine'}); } }} onProjects={() => { setView('projects'); }} onIssues={() => { setView('issues'); }} onPulls={() => { setView('pulls'); }} />
        <div className="home-dashboard"><section className="home-panel home-projects-panel"><div className="home-panel-heading"><h2>{t("homePage.myProjects")}</h2><button className="text-link" onClick={() => setView('projects')}>{t("homePage.viewAll")} <ChevronRight size={17} /></button></div><div className="home-project-list">{ownRepos.slice(0, 3).map(homeRepoRow)}{ownRepos.length === 0 && !busy && <p className="live-empty">{t("homePage.noProjectsYetYouCanCreateOne")}</p>}</div></section><section className="home-panel home-recent-panel"><div className="home-panel-heading"><h2>{t("homePage.recentUpdates")}</h2><button className="text-link" onClick={() => setView('recent-history')}>{t("homePage.viewAll")} <ChevronRight size={17} /></button></div><div className="home-recent-list">{recentUpdates.slice(0, 4).map(({ repo, commit: item }) => <button className="home-recent-row" key={`${repo.id}:${item.sha}`} onClick={() => void openVersionFor(repo, item)}><RepoLogo repo={repo} small /><span><strong>{repo.name}</strong><small>{relativeDate(item.commit.author?.date ?? repo.pushed_at ?? repo.updated_at, language)}</small><em data-content-original>{item.commit.message.split('\n')[0]}</em></span></button>)}{recentLoading && <p className="muted">{t("homePage.loadingRecentUpdates")}</p>}{recentError && <p className="muted"><ErrorMessage error={recentError} /></p>}{!recentLoading && !recentUpdates.length && !recentError && <p className="muted">{t("homePage.noChangeHistoryYet")}</p>}</div></section></div>
        <div className="home-shortcuts"><button onClick={() => { setView('projects'); }}><CloudDownload size={17} />{t("homePage.downloadFromGithub")} <ArrowRight size={15} /></button><button onClick={() => { setView('local'); }}><FolderOpen size={17} />{t("homePage.addExistingFolder")} <ArrowRight size={15} /></button></div>
      </>;

}
