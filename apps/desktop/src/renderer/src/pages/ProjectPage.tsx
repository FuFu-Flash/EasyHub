import { useTranslation } from '../localization';
import type { GitHubCommit } from '@easyhub/github';
import { ArrowDownToLine,ArrowRight,ChevronRight,FolderOpen,Globe2,LockKeyhole,Pencil,Tag } from 'lucide-react';
import { useState } from 'react';
import { ErrorMessage } from '../components/ErrorMessage';
import { ForkContributionPanel } from '../components/ForkContributionPanel';
import { IntroductionEditor } from '../components/IntroductionEditor';
import { LiveProjectDangerZone } from '../components/LiveProjectDangerZone';
import { ReadmeMarkdown } from '../components/ReadmeMarkdown';
import { SourceHistoryButton } from '../components/SourceHistory';
import { StarProjectButton } from '../components/StarProjectButton';
import { TranslatableContent,TranslationPreferencesContext } from '../components/TranslatableContent';
import { errorText as message } from '../errors';
import { formatRelative } from '../format';
import { projectPresentation } from '../projectPresentation';
import { usePageFeedback } from '../workspace/pageFeedback';


import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import type { View } from '../workspace/navigation';
import { usePageActions } from '../workspace/pageActions';
import { usePageData,useRepository } from '../workspace/pageData';
import { ownerOf,PageBack,PageStatus,RepoLogo } from './shared';


export function ProjectPage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { setNotice, setError } = usePageFeedback();
  const { user, language, localLinks, localStatuses, remotePreviews, localErrors, activityCounts, automaticTranslation, translationTarget, translationNames, api, easyHub, loadRepos, navigation } = w;
  const { params } = usePageRoute();
  const { openVersionFor, openProfileRepository, openReadmeLink } = usePageActions();
  const relativeDate = formatRelative;
  const setView = (view: View) => navigation.navigate(view, ['project','local','issues','pulls','downloads','history','new-release','source-history'].includes(view) ? {repo:params.repo,localId:params.localId} : {});
  const browseForkOriginal = (owner: string, name: string) => openProfileRepository(owner+'/'+name);

  const selected=useRepository(),selectedLocalId=params.localId??null;
  const intro=usePageData<string>('readme:'+params.repo,async()=>{if(!selected)return '';return api<string>('readme',ownerOf(selected),selected.name).catch(async cause=>{const link=localLinks.find(item=>selectedLocalId?item.id===selectedLocalId:item.repositoryId===selected.id);if(link)return easyHub.localReadIntroduction(link.id);throw cause;});},'');
  const history=usePageData<GitHubCommit[]>('commits:'+params.repo,async()=>selected?api('commits',ownerOf(selected),selected.name):[],[]);
  const readme=intro.data,commits=history.data,introductionLoading=intro.loading&&!intro.data,introductionError=intro.error,busy=intro.loading||history.loading;
  const details={reload:()=>{intro.reload();history.reload();}};
  const [introEditing,setIntroEditing]=useState(false),[introExpected,setIntroExpected]=useState(''),[introSaving,setIntroSaving]=useState(false),[introError,setIntroError]=useState('');
  const selectedLocalLink=localLinks.find(link=>selectedLocalId?link.id===selectedLocalId:link.repositoryId===selected?.id);
  const selectedState=selectedLocalLink?projectPresentation(localStatuses[selectedLocalLink.id],remotePreviews[selectedLocalLink.id],localErrors[selectedLocalLink.id]):{state:'saved',text:selected?.archived?t("projectPage.archivedReadOnly"):t("projectPage.savedOnGithub")};
  const canEditSelectedRelease=Boolean(selected&&!selected.archived&&(selected.permissions?.push||selected.permissions?.admin||selected.owner.login.toLowerCase()===user.login.toLowerCase()));
  const openVersion=(commit:GitHubCommit)=>{if(selected)openVersionFor(selected,commit);};
  async function beginEditIntroduction(){if(!selected||selected.archived)return;try{const links=await easyHub.localList();w.set('localLinks',links);const link=links.find(item=>selectedLocalId?item.id===selectedLocalId:item.repositoryId===selected.id);if(!link){setView('local');return;}setIntroExpected(await easyHub.localReadIntroduction(link.id));setIntroEditing(true);}catch(cause){setError(message(cause));}}
  async function saveIntroduction(content:string){if(!selectedLocalLink)return;setIntroSaving(true);setIntroError('');try{await easyHub.localSaveIntroduction(selectedLocalLink.id,introExpected,content);intro.setData(content);setIntroEditing(false);setNotice(t("projectPage.introductionSavedLocallyPublishTheSourceToSyncIt"));}catch(cause){setIntroError(message(cause));}finally{setIntroSaving(false);}}
  if(!selected)return <PageStatus loading error=""/>;

 return <><TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation, target: translationTarget, repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name }, names: translationNames }}>
        <PageBack>{params.section==='profile'?t("projectPage.backToStarredProjects"):t("projectPage.allProjects")}</PageBack>
        <section className="detail-hero has-source-history"><SourceHistoryButton language={language} onClick={() => { setView('source-history'); }} /><div className="detail-main"><RepoLogo repo={selected} /><div><div className="detail-name-row"><h1>{selected.name}</h1><span className="visibility-label">{selected.private ? <><LockKeyhole size={13} />{t("projectPage.onlyMe")}</> : <><Globe2 size={13} />{t("projectPage.everyone")}</>}</span></div>{!selected.private && selected.description ? <TranslatableContent text={selected.description} format="text" render={(value) => <p>{value}</p>} /> : <p>{selected.description || t("projectPage.noProjectDescriptionYet")}</p>}<span className={`status status-${selectedState.state}`}><span className="status-dot" />{selected.archived ? t("projectPage.archivedReadOnly") : selectedState.text}</span></div></div><div className="detail-actions"><StarProjectButton repo={selected} /><button className="button button-primary" disabled={selected.archived} onClick={() => setView('local')}><FolderOpen size={17} />{t("projectPage.localProjectPublishSourceCode")}</button><div className="detail-release-actions">{!selected.fork && !selected.archived && (selected.permissions?.push || ownerOf(selected).toLowerCase() === user.login.toLowerCase()) && <button className="button button-quiet" disabled={busy} onClick={() => navigation.navigate('new-release',{repo:selected.full_name})}><Tag size={17} />{t("projectPage.publishNewRelease")}</button>}<button className="button button-quiet" onClick={() => { navigation.navigate('downloads',{repo:selected.full_name,edit:canEditSelectedRelease}); }}>{canEditSelectedRelease ? <Pencil size={17} /> : <ArrowDownToLine size={17} />}{canEditSelectedRelease ? t("projectPage.editReleases") : t("projectPage.downloadReleasesOrSource")}</button></div></div></section>
        {selected.fork && <ForkContributionPanel key={selected.id} repo={selected} localLinkId={localLinks.find((item) => item.repositoryId === selected.id)?.id} suggestedTitle={commits[0]?.commit.message.split('\n')[0] ?? ''} onOpenLocal={() => setView('local')} onBrowseOriginal={(owner, name) => void browseForkOriginal(owner, name)} onOpenExternal={(url) => void easyHub?.openExternalLink(url)} />}
        <div className="detail-grid"><div className="detail-primary"><section className="panel"><div className="panel-heading"><h2>{t("projectPage.projectIntroduction")}</h2><button className="text-link" disabled={selected.archived} onClick={() => void beginEditIntroduction()}><Pencil size={15} />{t("projectPage.editIntroduction")}</button></div>{introductionLoading ? <p className="muted" role="status">{t("projectPage.loadingProjectIntroduction")}<button className="text-link" onClick={intro.cancel}>{t("projectPage.cancel")}</button></p> : introductionError ? <div className="live-error" role="alert"><ErrorMessage error={introductionError} /><button className="text-link" onClick={details.reload}>{t("projectPage.retry")}</button></div> : readme ? !selected.private ? <TranslatableContent text={readme} format="markdown" paragraphMode render={(value) => <ReadmeMarkdown markdown={value} repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }} onOpenLink={(href) => void openReadmeLink(href, selected)} />} /> : <ReadmeMarkdown markdown={readme} repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }} onOpenLink={(href) => void openReadmeLink(href, selected)} /> : <p className="muted">{t("projectPage.thisProjectHasNoIntroductionYet")}</p>}</section><section className="panel"><div className="panel-heading"><h2>{t("projectPage.changeHistory")}</h2><button className="text-link" onClick={() => setView('history')}>{t("projectPage.viewAll")} <ArrowRight size={16} /></button></div><PageStatus loading={false} error={history.error} retry={history.reload} cancel={history.cancel}/><div className="timeline-list">{commits.slice(0, 3).map((item) => <button className="timeline-item" key={item.sha} onClick={() => void openVersion(item)}><span className="timeline-dot" /><span><strong>{item.commit.message.split('\n')[0]}</strong><small>{item.commit.author?.date ? relativeDate(item.commit.author.date, language) : ''}</small></span><ChevronRight size={17} /></button>)}{commits.length === 0 && <p className="muted">{t("projectPage.noChangeHistoryYet")}</p>}</div></section></div><div className="detail-side"><section className="panel side-panel"><div className="panel-heading"><h2>{t("projectPage.issues")}</h2><span className="count-bubble">{activityCounts[selected.id]?.issues ?? '…'}</span></div><p>{t("projectPage.seeFeedbackAndMakeYourProjectBetterTogether")}</p><button className="button button-quiet full-width" onClick={() => setView('issues')}>{t("projectPage.viewIssues")} <ArrowRight size={16} /></button></section><section className="panel side-panel"><div className="panel-heading"><h2>{t("projectPage.pullRequestReviews")}</h2><span className="count-bubble">{activityCounts[selected.id]?.pullRequests ?? '…'}</span></div><p>{t("projectPage.readTheProposedChangesAndFilesBeforeDecidingWhether")}</p><button className="button button-quiet full-width" onClick={() => { setView('pulls'); }}>{t("projectPage.pullRequestReviews")} <ArrowRight size={16} /></button></section><section className="panel side-panel"><div className="panel-heading"><h2>{t("projectPage.projectStatus")}</h2></div><div className="status-detail"><span className={`big-status-dot ${selectedState.state}`} /><div><strong>{selectedState.text}</strong><small>{t("projectPage.lastUpdated")}{relativeDate(selected.updated_at, language)}</small></div></div><button className="text-link" onClick={() => setView('local')}>{t("projectPage.viewLocalChanges")} <ArrowRight size={16} /></button></section></div></div>
        {(selected.owner.login.toLowerCase() === user.login.toLowerCase() || selected.permissions?.admin) && <LiveProjectDangerZone repo={selected} language={language} onUpdate={(updated) => { w.cache.set('repo:'+updated.full_name,updated); w.set('repos',items=>items.map(item=>item.id===updated.id?updated:item)); }} onTransferred={() => {
navigation.removeRepository(selected.full_name); void loadRepos(true);
        }} onNotice={setNotice} />}
      </TranslationPreferencesContext.Provider>{introEditing && <IntroductionEditor initialMarkdown={introExpected} repository={{owner:ownerOf(selected),name:selected.name,branch:selected.default_branch}} live saving={introSaving} saveError={introError} onSave={content=>void saveIntroduction(content)} onCancel={()=>setIntroEditing(false)} onOpenLink={url=>void openReadmeLink(url,selected)}/>}</>;

}
