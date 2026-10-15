import type { GitHubRelease } from '@easyhub/github';
import type { CreateReleaseInput,ProjectRelease,ReleaseMutationFailure,ReleaseProgress } from '@easyhub/types';
import { useEffect,useRef,useState } from 'react';
import { ReleaseEditor } from '../components/ReleaseEditor';
import { createDraftKey,removeDraft } from '../draftStore';
import { errorText as message } from '../errors';
import { usePageFeedback } from '../workspace/pageFeedback';


import { useContext } from 'react';
import { PageActivityContext } from '../components/NavigationPages';
import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import type { View } from '../workspace/navigation';
import { usePageData,useRepository } from '../workspace/pageData';
import { ownerOf,PageStatus } from './shared';


export function ReleaseCreatePage() {

  const w = useWorkspace();
  const { setError } = usePageFeedback();
  const { user, language, localLinks, localStatuses, api, easyHub, storage: workspaceStorage, navigation } = w;
  const { params } = usePageRoute();
  const setView = (view: View) => navigation.navigate(view, ['project','local','issues','pulls','downloads','history','new-release','source-history'].includes(view) ? {repo:params.repo,localId:params.localId} : {});

  const selected=useRepository();const active=useContext(PageActivityContext),present=useRef(active);present.current=active;
  const history=usePageData<ProjectRelease[]>('release-history:'+params.repo,async()=>{if(!selected)return[];const items=await api<GitHubRelease[]>('releases',ownerOf(selected),selected.name);return items.map(item=>({id:String(item.id),tagName:item.tag_name,title:item.name||item.tag_name,body:item.body||'',channel:/^alpha/i.test(item.tag_name)?'alpha':/^beta/i.test(item.tag_name)?'beta':'stable',publishedAt:item.published_at||'',assets:item.assets.map(asset=>({id:String(asset.id),name:asset.name,size:asset.size,mimeType:asset.content_type}))}));},[]);
  const releaseHistory=history.data;const [releaseImages,setReleaseImages]=useState<Record<string,string>>({}),[releaseBusy,setReleaseBusy]=useState(false),[releaseProgress,setReleaseProgress]=useState<ReleaseProgress|null>(null),[releaseFailure,setReleaseFailure]=useState<ReleaseMutationFailure<unknown>|null>(null);const submitting=useRef(false);
  useEffect(()=>easyHub.onReleaseProgress(value=>{if(submitting.current&&present.current)setReleaseProgress(value);}),[easyHub]);
  const imageUrls=useRef(releaseImages);imageUrls.current=releaseImages;useEffect(()=>()=>{Object.values(imageUrls.current).filter(value=>value.startsWith('blob:')).forEach(value=>URL.revokeObjectURL(value));},[]);
  async function publishNewRelease(input:CreateReleaseInput){if(!selected||submitting.current)return;submitting.current=true;setReleaseBusy(true);setReleaseFailure(null);setReleaseProgress(null);try{const result=await easyHub.publishRelease({owner:ownerOf(selected),repo:selected.name,tagName:input.tagName,title:input.title,body:input.body,channel:input.channel,assetIds:input.assets.map(asset=>asset.id)});if('status' in result){if(result.status==='failed')setReleaseFailure(result);return;}removeDraft(createDraftKey(user.login,selected.id,'release','new'),workspaceStorage);if(present.current){navigation.navigate('downloads',{repo:selected.full_name,tag:result.tag_name},true);}}catch(cause){if(present.current)setError(message(cause));}finally{submitting.current=false;setReleaseBusy(false);setReleaseProgress(null);}}
  if(!selected)return <PageStatus loading error=""/>;

 return <><PageStatus loading={history.loading} error={history.error} retry={history.reload} cancel={history.cancel}/><ReleaseEditor draftAccount={user.login} draftRepository={selected.id} key={selected.id} project={{ name: selected.name,
        health: localLinks.some((link) => link.repositoryId === selected.id && (localStatuses[link.id]?.files.length ?? 0) > 0) ? 'changes' : 'saved',
        releases: releaseHistory }} language={language} busy={releaseBusy} progress={releaseProgress} failure={releaseFailure} imageSources={releaseImages}
        onRegisterInlineImage={(id, source) => setReleaseImages((current) => ({ ...current, [id]: typeof source === 'string' ? source : URL.createObjectURL(source) }))}
        onChooseFiles={(inline) => easyHub!.chooseReleaseFiles(inline)} onPublish={(input) => void publishNewRelease(input)}
        onBack={() => { if (releaseBusy) void easyHub?.cancelRelease(); else navigation.back('project'); }} onOpenUpdate={() => setView('local')}
        onOpenLink={(url) => void easyHub?.openExternalLink(url)} /></>;

}
