import type { SyncPreview } from '@easyhub/types';
import { useState } from 'react';
import { LocalWorkspace } from '../LocalWorkspace';
import { usePageData } from '../workspace/pageData';
import { PageStatus } from './shared';


import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { useRepository } from '../workspace/pageData';


export function LocalPage() {

  const w = useWorkspace();
  const { repos, downloads, loadRepos, refreshLocalLinks, navigation } = w;
  const { params } = usePageRoute();
  const onCreated = async () => { await loadRepos(true); await refreshLocalLinks(); };
const selected=useRepository(), selectedLocalId=params.localId??null;
 const [syncOpened,setSyncOpened]=useState(false);
 const sync=usePageData<SyncPreview|null>('local-sync:'+params.localId,async()=>params.sync&&params.localId?w.easyHub.localCheckSync(params.localId):null,null);
 return <><PageStatus loading={Boolean(params.sync)&&sync.loading&&!sync.data} error={sync.error} retry={sync.reload} cancel={sync.cancel}/><LocalWorkspace mode="list" repos={repos} selectedRepo={selected} initialLocalId={selectedLocalId} initialPublish={Boolean(params.publish)} initialSyncReview={!syncOpened&&params.sync&&params.localId&&sync.data?{id:params.localId,preview:sync.data,message:''}:null} onSyncReviewOpened={()=>setSyncOpened(true)}  onBack={() => navigation.back('projects')} onCreated={onCreated} onDownloadProject={(repo) => downloads.start({ kind: 'project', repo, fileName: repo.name })} downloadBusy={downloads.busy} /></>;

}
