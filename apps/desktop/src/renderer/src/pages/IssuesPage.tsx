import { useTranslation } from '../localization';
import type { GitHubIssue,GitHubIssuePage,GitHubRepo } from '@easyhub/github';
import { ChevronDown,ChevronRight,CircleHelp,MessageCircle,X } from 'lucide-react';
import { useRef,useState } from 'react';
import { sumActivity } from '../activityCounts';
import { DiscussionSearch,useDiscussionSearchState } from '../components/DiscussionSearch';
import { ErrorMessage } from '../components/ErrorMessage';
import { SegmentedControl } from '../components/SegmentedControl';
import { errorText as message } from '../errors';
import { formatRelative } from '../format';
import { usePageFeedback } from '../workspace/pageFeedback';
import { readPageWindow } from '../workspace/pageWindow';


import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageActions } from '../workspace/pageActions';
import { usePageData,useRepository } from '../workspace/pageData';
import { IssueListTitle,ownerOf,PageBack,PageStatus,RepoLogo } from './shared';


export function IssuesPage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { setError } = usePageFeedback();
  const { user, language, repos, activityCounts, activityError, api, navigation } = w;
  const { params } = usePageRoute();
  const { openIssue: openIssueFor } = usePageActions();
  const relativeDate = formatRelative;
  const totalPendingIssues = sumActivity(repos, activityCounts, 'issues');
  const pendingIssueCount = (repo: GitHubRepo) => activityCounts[repo.id]?.issues ?? null;

  const selected=useRepository();
  const issueFilter=params.filter==='closed'?'closed':'open',setIssueFilter=(filter:string)=>navigation.updateParams({filter});
  const [issueExpansion,setIssueExpansion]=useState<Record<number,boolean>>({}),[showOtherIssueRepos,setShowOtherIssueRepos]=useState(false),[loadingMoreIssues,setLoadingMoreIssues]=useState(false);
  const [issueSearch,changeIssueSearch]=useDiscussionSearchState(user.login,`own:${selected?`${selected.id}:${selected.full_name}`:'all'}:issue`);const issueSearchActive=Boolean(issueSearch.query);
  const loadedPages=useRef<Record<number,number>>({});
  const readIssues=(repo:GitHubRepo)=>readPageWindow(()=>api<GitHubIssuePage>('issuesPage',ownerOf(repo),repo.name,'all',1),page=>api<GitHubIssuePage>('issuesPage',ownerOf(repo),repo.name,'all',page),loadedPages.current[repo.id]??1,item=>item.id);
  const groups=usePageData<Record<number,GitHubIssuePage>>('issue-groups:'+(params.repo??'all'),async()=>{
    const targets=selected?[selected]:repos.filter(repo=>issueExpansion[repo.id]??((activityCounts[repo.id]?.issues??0)>0));
    const results=await Promise.allSettled(targets.map(async repo=>({id:repo.id,result:await readIssues(repo)})));
    const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
    const next={...((w.cache.get('issue-groups:'+(params.repo??'all')) as Record<number,GitHubIssuePage>)??{})};for(const item of results)if(item.status==='fulfilled')next[item.value.id]=item.value.result;return next;
  },{}, repos.map(repo=>repo.id+':'+activityCounts[repo.id]?.issues).join('|'));
  const issueGroups=Object.fromEntries(Object.entries(groups.data).map(([id,value])=>[Number(id),value.items]));
  const issueNextPages=Object.fromEntries(Object.entries(groups.data).map(([id,value])=>[Number(id),value.nextPage]));
  const issues=selected?issueGroups[selected.id]??[]:[],busy=groups.loading;
  const orderedIssueRepos=[...repos].sort((a,b)=>(pendingIssueCount(b)??-1)-(pendingIssueCount(a)??-1)||a.name.localeCompare(b.name));
  const emptyIssueRepos=orderedIssueRepos.filter(repo=>(issueFilter==='open'?activityCounts[repo.id]?.issues:activityCounts[repo.id]?.closedIssues)===0);
  const shownIssueRepos=orderedIssueRepos.filter(repo=>showOtherIssueRepos||!emptyIssueRepos.includes(repo));const issuePagingRepo=selected;
  const openIssue=(item:GitHubIssue,repo:GitHubRepo|null=selected)=>{if(repo)openIssueFor(item,repo);};
  const setSelected=(_value:null)=>navigation.navigate('issues',{});
  async function toggleIssueGroup(repo:GitHubRepo){const expanded=issueExpansion[repo.id]??(issueFilter==='open'&&(activityCounts[repo.id]?.issues??0)>0);setIssueExpansion(old=>({...old,[repo.id]:!expanded}));if(expanded)return;try{const result=await readIssues(repo);groups.setData(old=>({...old,[repo.id]:result}));}catch(cause){setError(message(cause));}}
  async function loadMoreIssuesFor(repo:GitHubRepo){const next=issueNextPages[repo.id];if(!next||loadingMoreIssues)return;setLoadingMoreIssues(true);try{const result=await api<GitHubIssuePage>('issuesPage',ownerOf(repo),repo.name,'all',next);loadedPages.current[repo.id]=next;groups.setData(old=>({...old,[repo.id]:{...result,items:[...(old[repo.id]?.items??[]),...result.items.filter(item=>!old[repo.id]?.items.some(known=>known.id===item.id))]}}));}catch(cause){setError(message(cause));}finally{setLoadingMoreIssues(false);}}

 return <>{selected && <PageBack/>}<PageStatus loading={busy&&!Object.keys(groups.data).length} error={groups.error} retry={groups.reload} cancel={groups.cancel}/><>
        <div className="page-header"><div><div className="eyebrow">{t("issuesPage.improveTogether")}</div><h1>{t("issuesPage.issues")}</h1><p>{t("issuesPage.readFeedbackReplyToIdeasAndSolveProblems")}</p></div></div>
        {activityError && <p className="live-error" role="alert"><ErrorMessage error={activityError} /></p>}
        <DiscussionSearch filters={<div className="toolbar"><SegmentedControl role="tablist" aria-label={t("issuesPage.issueStatus")}><button id="issues-open-tab" aria-controls="issues-status-panel" className={issueFilter === 'open' ? 'selected' : ''} onClick={() => setIssueFilter('open')}>{t("issuesPage.open")} <span>{selected ? activityCounts[selected.id]?.issues ?? '…' : totalPendingIssues ?? '…'}</span></button><button id="issues-closed-tab" aria-controls="issues-status-panel" className={issueFilter === 'closed' ? 'selected' : ''} onClick={() => setIssueFilter('closed')}>{t("issuesPage.resolved")}</button></SegmentedControl>{selected && <button className="filter-project" onClick={() => setSelected(null)}>{selected.name}<X size={15} /></button>}</div>} repositories={selected ? [selected] : repos} kind="issue" state={issueFilter} language={language} search={issueSearch} onSearchChange={changeIssueSearch} onOpen={(item, repo) => void openIssue(item, repo)} />
        <div id="issues-status-panel" role="tabpanel" aria-labelledby={`issues-${issueFilter}-tab`} tabIndex={0} hidden={issueSearchActive}>
        {selected ? <div className="issue-list">{issues.filter((item) => item.state === issueFilter).map((item) => <button className="issue-row" key={item.id} onClick={() => void openIssue(item)}><span className={`issue-indicator ${item.state === 'closed' ? 'closed' : ''}`}><CircleHelp size={19} /></span><span className="issue-row-main"><IssueListTitle issue={item} repo={selected} /><small>{selected.name} · {item.user?.login || t("issuesPage.githubUser")} · {relativeDate(item.created_at, language)}</small></span><span className="issue-comments"><MessageCircle size={16} />{item.comments}</span><ChevronRight size={18} className="chevron" /></button>)}{!busy && issues.filter((item) => item.state === issueFilter).length === 0 && <div className="empty-state"><span className="empty-icon"><MessageCircle size={28} /></span><h3>{issueFilter === 'open' ? t("issuesPage.noOpenIssues") : t("issuesPage.noResolvedIssuesYet")}</h3><p>{t("issuesPage.feedbackOnYourProjectsWillAppearHere")}</p></div>}</div> : <div className="issue-project-list">{shownIssueRepos.map((repo) => { const expanded = issueExpansion[repo.id] ?? (issueFilter === 'open' && (activityCounts[repo.id]?.issues ?? 0) > 0); const items = (issueGroups[repo.id] || []).filter((item) => item.state === issueFilter); return <section className="issue-project-group live-issue-group" key={repo.id}><button className="issue-project-header" aria-expanded={expanded} onClick={() => void toggleIssueGroup(repo)}><RepoLogo repo={repo} small /><span className="issue-project-heading"><strong>{repo.name}</strong><small>{repo.description || t("issuesPage.noProjectDescriptionYet")}</small></span><span className={`issue-project-count ${issueFilter === 'open' && (pendingIssueCount(repo) ?? 0) > 0 ? 'live-pending-count' : ''}`}>{issueFilter === 'open' ? t("issuesPage.openIssues", { p0: pendingIssueCount(repo) ?? '…' }) : expanded ? t("issuesPage.resolvedIssues", { p0: activityCounts[repo.id]?.closedIssues ?? '…' }) : t("issuesPage.viewResolvedIssues")}</span><ChevronDown className={`issue-project-chevron ${expanded ? 'expanded' : ''}`} size={19} /></button><div className="issue-project-items live-group-items" hidden={!expanded}>{expanded && (items.length ? items.map((item) => <button className="issue-row" key={item.id} onClick={() => void openIssue(item, repo)}><span className={`issue-indicator ${item.state === 'closed' ? 'closed' : ''}`}><CircleHelp size={19} /></span><span className="issue-row-main"><IssueListTitle issue={item} repo={repo} /><small>{item.user?.login || t("issuesPage.githubUser")} · {relativeDate(item.created_at, language)}</small></span><span className="issue-comments"><MessageCircle size={16} />{item.comments}</span><ChevronRight size={18} className="chevron" /></button>) : issueGroups[repo.id] && <p className="live-empty">{issueFilter === 'open' ? t("issuesPage.noOpenIssues") : t("issuesPage.noResolvedIssuesYet")}</p>)}{expanded && issueNextPages[repo.id] && <button className="button button-quiet pull-more" disabled={loadingMoreIssues} onClick={() => void loadMoreIssuesFor(repo)}>{t("issuesPage.loadMoreIssues")}</button>}</div></section>; })}</div>}
        {!selected && shownIssueRepos.length === 0 && <div className="empty-state"><span className="empty-icon"><MessageCircle size={28} /></span><h3>{issueFilter === 'open' ? t("issuesPage.noOpenIssues") : t("issuesPage.noResolvedIssuesYet")}</h3><p>{t("issuesPage.feedbackOnYourProjectsWillAppearHere")}</p></div>}
        {!selected && emptyIssueRepos.length > 0 && <button className="text-link other-projects-toggle" aria-expanded={showOtherIssueRepos} onClick={() => setShowOtherIssueRepos((value) => !value)}>{showOtherIssueRepos ? t("issuesPage.hideOtherProjects") : t("issuesPage.showOtherProjects")} <span>{emptyIssueRepos.length}</span><ChevronDown size={16} /></button>}
        {selected && issuePagingRepo && issueNextPages[issuePagingRepo.id] && <button className="button button-quiet pull-more" disabled={loadingMoreIssues} onClick={() => void loadMoreIssuesFor(issuePagingRepo)}>{loadingMoreIssues ? t("issuesPage.loading") : t("issuesPage.loadMoreIssues")}</button>}
        </div>
      </></>;

}
