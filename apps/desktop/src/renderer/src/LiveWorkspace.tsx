import { useTranslation } from './localization';
import { PageStatus } from './pages/shared';
import { Check,ChevronRight,Compass,Folder,GitPullRequest,Globe2,Home,Languages,MessageCircle,Minus,RotateCw,Settings2,Square,X } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import { canReviewRepository,sumActivity } from './activityCounts';
import appIcon from './assets/easyhub-icon.svg';
import { useEasyHub } from './bridge';
import { RecoveryHomeContext } from './components/AppErrorBoundary';
import type { ActivityNotice } from './components/DownloadNotifications';
import { DownloadNotifications } from './components/DownloadNotifications';
import { ErrorMessage } from './components/ErrorMessage';
import { FeedbackNotice } from './components/FeedbackNotice';
import { NavigationPages } from './components/NavigationPages';
import { ProfileMenu } from './components/ProfileMenu';
import { TopbarSearch } from './components/TopbarSearch';
import { LanguageContext } from './i18n';
import { navigateNested } from './nestedNavigation';
import { WorkspacePage } from './pages/WorkspacePage';
import { findLocalLink } from './repositoryLinks';
import { useNavigationShortcuts } from './useNavigationShortcuts';
import { NavigationProvider,PageRouteContext } from './workspace/NavigationContext';
import { usePageActions } from './workspace/pageActions';
import { finishRefresh,useShellEffects } from './workspace/shellEffects';
import type { WorkspaceProps } from './workspace/WorkspaceContext';
import { WorkspaceProvider,useWorkspace } from './workspace/WorkspaceContext';

export function LiveWorkspace(props: WorkspaceProps) {
  const scrollArea = useRef<HTMLDivElement>(null);
  return <NavigationProvider scrollArea={scrollArea}><WorkspaceProvider {...props}><WorkspaceShell /></WorkspaceProvider></NavigationProvider>;
}

function WorkspaceShell() {
  const w = useWorkspace(), easyHub = useEasyHub();
  const { navigation, user, language, windowStyle, repos, localLinks, activityCounts, downloads, demo, offline, authRetrying, onRetryAuth } = w;
  const t = useTranslation(language);
  const { page, section: nav, scrollArea } = navigation;
  const { openProject, openLocal, submitProjectSearch } = usePageActions();
  const root = useRef<HTMLDivElement>(null), refreshIcon = useRef<SVGSVGElement>(null), refreshingLock = useRef(false);
  const [search, setSearch] = useState(''), [languageMenuOpen, setLanguageMenuOpen] = useState(false), [refreshing, setRefreshing] = useState(false);
  const instance = JSON.stringify([page.view,page.params.repo,page.params.localId,page.params.number,page.params.sha,page.params.login,page.params.visit]);
  const formPage = page.view === 'settings' || page.view === 'new-project';
  const canScrollDown = useShellEffects(root, scrollArea, language, instance);
  useEffect(() => { if (page.view === 'projects' || page.view === 'discover') setSearch(page.params.query ?? ''); }, [page.view,page.params.query]);
  useNavigationShortcuts(() => { if (!navigateNested('back')) navigation.back(); }, () => { if (!navigateNested('forward')) navigation.forward(); });
  const pendingIssues = sumActivity(repos,activityCounts,'issues'), pendingPulls = sumActivity(repos.filter(repo=>canReviewRepository(repo,user.login)),activityCounts,'pullRequests');
  const activity: ActivityNotice[] = repos.flatMap(repo => {
    const result:ActivityNotice[]=[];const count=activityCounts[repo.id];
    if(count?.issues)result.push({id:`issues-${repo.id}`,revision:`issues:${count.issues}`,title:t("liveWorkspace.hasOpenIssues", { p0: repo.name, p1: count.issues }),detail:t("liveWorkspace.viewIssues"),onOpen:()=>navigation.navigate('issues',{repo:repo.full_name})});
    if(count?.pullRequests&&canReviewRepository(repo,user.login))result.push({id:`pulls-${repo.id}`,revision:`pulls:${count.pullRequests}`,title:t("liveWorkspace.hasPullRequests", { p0: repo.name, p1: count.pullRequests }),detail:t("liveWorkspace.pullRequestReviews"),onOpen:()=>navigation.navigate('pulls',{repo:repo.full_name})});return result;
  });
  async function refreshCurrent() {
    if(refreshingLock.current)return;refreshingLock.current=true;setRefreshing(true);setRefreshError('');const started=performance.now();
    try{if(await w.loadRepos(true)){await w.refreshLocalLinks();w.set('refreshRevision',n=>n+1);}}
    catch(cause){setRefreshError(cause instanceof Error?cause.message:String(cause));}
    finally{await finishRefresh(refreshIcon.current,started);refreshingLock.current=false;setRefreshing(false);}
  }
  const refreshError=w.refreshError,setRefreshError=(value:string)=>w.set('refreshError',value);
  const chooseLanguage=(value:'zh'|'en')=>{w.set('language',value);setLanguageMenuOpen(false);};
  return <LanguageContext.Provider value={language}><RecoveryHomeContext.Provider value={()=>navigation.sidebar('home')}><div className={`app-shell live-shell${demo?' demo-workspace':''}`} data-layout-preference={w.layout.preference} data-layout={w.layout.density} ref={root}>
    <aside className="sidebar"><nav className="sidebar-nav" aria-label={t("liveWorkspace.mainNavigation")}>
      <button className={nav==='home'?'active':''} onClick={()=>navigation.sidebar('home')}><Home size={19}/>{t("liveWorkspace.home")}</button>
      <button className={nav==='projects'?'active':''} onClick={()=>navigation.sidebar('projects')}><Folder size={19}/>{t("liveWorkspace.myProjects")}</button>
      <button className={nav==='discover'?'active':''} onClick={()=>navigation.sidebar('discover')}><Compass size={19}/>{t("liveWorkspace.discover")}</button>
      <button className={nav==='issues'?'active':''} onClick={()=>navigation.sidebar('issues')}><MessageCircle size={19}/>{t("liveWorkspace.issues")}{pendingIssues!==null&&pendingIssues>0&&<span className="nav-count" aria-label={t("liveWorkspace.unresolvedIssues", { p0: pendingIssues })}>{pendingIssues}</span>}</button>
      <button className={nav==='pulls'?'active':''} onClick={()=>navigation.sidebar('pulls')}><GitPullRequest size={19}/>{t("liveWorkspace.pullRequests")}{pendingPulls!==null&&pendingPulls>0&&<span className="nav-count" aria-label={t("liveWorkspace.pullRequestsAwaitingYourReview", { p0: pendingPulls })}>{pendingPulls}</span>}</button>
      <button className={nav==='settings'?'active':''} onClick={()=>navigation.sidebar('settings')}><Settings2 size={19}/>{t("liveWorkspace.settings")}</button>
    </nav><div className="sidebar-bottom live-sidebar-bottom"><button type="button" className={`sidebar-refresh${refreshing?' is-refreshing':''}`} aria-label={t("liveWorkspace.refreshGithubData")} title={t("liveWorkspace.refreshGithubData")} aria-busy={refreshing} disabled={refreshing||w.loading} onClick={()=>void refreshCurrent()}><RotateCw ref={refreshIcon} size={15} className={refreshing?'live-spin':undefined}/></button>{!demo&&<span title={user.name?`${user.name} (${user.login})`:user.login} className={`sidebar-demo live-connected${offline?' is-offline':''}`}><span/>{offline?t("liveWorkspace.githubIsOffline"):t("liveWorkspace.connectedToGithub")} · {user.login}</span>}</div></aside>
    <div className="main-column" ref={scrollArea}><header className={`topbar topbar-${windowStyle}`}>
      {windowStyle==='reference'&&<div className="window-controls" aria-label={t("liveWorkspace.windowControls")}><button className="window-dot window-close" aria-label={t("liveWorkspace.closeWindow")} onClick={()=>void easyHub?.closeWindow()}/><button className="window-dot window-minimize" aria-label={t("liveWorkspace.minimizeWindow")} onClick={()=>void easyHub?.minimizeWindow()}/><button className="window-dot window-maximize" aria-label={t("liveWorkspace.maximizeOrRestoreWindow")} onClick={()=>void easyHub?.toggleMaximizeWindow()}/></div>}
      <button className="topbar-brand" onClick={()=>navigation.sidebar('home')}><img src={appIcon} alt=""/><span>EasyHub</span></button>
      <TopbarSearch query={search} onQueryChange={value=>{setSearch(value);if(page.view==='projects'||!value&&page.view==='discover')navigation.updateParams({query:value});}} language={language} scope={page.params.scope==='users'?'users':'projects'} onSearch={submitProjectSearch} projects={[...repos.map(repo=>({key:'repo-'+repo.id,name:repo.name,detail:repo.full_name,avatar:repo.owner.avatar_url,onOpen:()=>{const link=findLocalLink(repo,localLinks);if(link)openLocal(link,repo);else openProject(repo);}})),...localLinks.filter(link=>!repos.some(repo=>repo.id===link.repositoryId)).map(link=>({key:link.id,name:link.name,detail:link.localPath,onOpen:()=>openLocal(link)}))]}/>
      <div className="topbar-actions"><button className={`icon-button translation-toggle ${w.automaticTranslation?'active':''}`} type="button" aria-label={w.automaticTranslation?t("liveWorkspace.turnOffTranslation"):t("liveWorkspace.turnOnTranslation")} aria-pressed={w.automaticTranslation} title={t("liveWorkspace.contentTranslation")} onClick={()=>w.set('automaticTranslation',value=>!value)}><Languages size={21} strokeWidth={1.8}/></button>
        <div className="language-switcher"><button className="icon-button language-trigger" aria-label={t("liveWorkspace.chooseLanguage")} aria-expanded={languageMenuOpen} title={t("liveWorkspace.interfaceLanguage")} onClick={()=>setLanguageMenuOpen(value=>!value)}><Globe2 size={21} strokeWidth={1.8}/></button>{languageMenuOpen&&<div className="language-menu" role="group" aria-label={t("liveWorkspace.languageOptions")}><button aria-pressed={language==='zh'} onClick={()=>chooseLanguage('zh')}><span>{t("liveWorkspace.chinese")}</span>{language==='zh'&&<Check size={16}/>}</button><button aria-pressed={language==='en'} onClick={()=>chooseLanguage('en')}><span>English</span>{language==='en'&&<Check size={16}/>}</button></div>}</div>
        <DownloadNotifications center={downloads} savedPublicRepoIds={w.savedPublicRepos.map(repo=>repo.id)} onAddPublic={w.addPublicProject} activity={activity} account={user.login}/>
        <ProfileMenu avatar={user.avatar_url?<img src={user.avatar_url} alt=""/>:user.login.slice(0,1).toUpperCase()} name={demo?t("liveWorkspace.demoAccount"):user.login} onProfile={()=>navigation.navigate('profile',{login:user.login,section:'profile'})} onStarred={()=>navigation.navigate('starred',{visit:Date.now(),section:'profile'})}/>
      </div>{windowStyle==='windows'&&<div className="windows-window-controls" aria-label={t("liveWorkspace.windowControls")}><button className="windows-control-button" aria-label={t("liveWorkspace.minimizeWindow")} title={t("liveWorkspace.minimize")} onClick={()=>void easyHub?.minimizeWindow()}><Minus size={17} strokeWidth={1.6}/></button><button className="windows-control-button" aria-label={t("liveWorkspace.maximizeOrRestoreWindow")} title={t("liveWorkspace.maximizeOrRestore")} onClick={()=>void easyHub?.toggleMaximizeWindow()}><Square size={13} strokeWidth={1.7}/></button><button className="windows-control-button windows-control-close" aria-label={t("liveWorkspace.closeWindow")} title={t("liveWorkspace.close")} onClick={()=>void easyHub?.closeWindow()}><X size={17} strokeWidth={1.6}/></button></div>}
    </header>
    {demo&&<div className="demo-mode-notice" role="status"><span>{t("liveWorkspace.demoModeChangesAreNotUploadedToGithubFiles")}</span>{!demo.only&&<button className="button button-quiet small-button" onClick={demo.onLogin}>{t("liveWorkspace.signInToGithub")}</button>}</div>}
    <FeedbackNotice message={w.error} kind="error" onClose={()=>w.setError('')} language={language}/><FeedbackNotice message={w.notice} onClose={()=>w.setNotice('')} language={language}/>
    <NavigationPages active={instance}><PageRouteContext.Provider value={page}><main className={`page-content live-page${page.view==='home'||page.view==='projects'?' page-with-footer':''}${formPage?' page-form-layout':''}`}><div className="v2-page-transition" key={page.view}>
      {offline&&<div className="live-offline" role="status" aria-live="polite"><span>{t("liveWorkspace.githubIsTemporarilyUnavailableShowingYourLastSavedData")}</span><button className="button button-quiet small-button" disabled={authRetrying} onClick={onRetryAuth}>{t("liveWorkspace.retry")}</button><button className="text-link" onClick={()=>{navigation.sidebar('settings');requestAnimationFrame(()=>root.current?.querySelector('.github-proxy-panel')?.scrollIntoView({block:'center'}));}}>{t("liveWorkspace.networkRepair")}</button></div>}
      <PageStatus loading={w.loading&&!w.repos.length} error="" cancel={w.cancelRepoReads}/><WorkspacePage/>
    </div></main></PageRouteContext.Provider></NavigationPages>
    {canScrollDown&&<button className="scroll-down-cue" aria-label={t("liveWorkspace.scrollDown")} onClick={()=>scrollArea.current?.scrollBy({top:Math.max(300,scrollArea.current.clientHeight*0.75),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}><ChevronRight size={27} strokeWidth={2.6} style={{transform:'rotate(90deg)'}}/></button>}</div>
    {refreshError&&<div className="live-error refresh-feedback" role="alert"><ErrorMessage error={refreshError}/><button onClick={()=>setRefreshError('')} aria-label={t("liveWorkspace.dismissRefreshError")}><X size={15}/></button></div>}
  </div></RecoveryHomeContext.Provider></LanguageContext.Provider>;
}
