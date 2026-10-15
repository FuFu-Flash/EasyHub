import { useTranslation } from '../localization';
import type { GitHubCommit } from '@easyhub/github';
import { ArrowDownToLine,ArrowLeft,Folder } from 'lucide-react';
import { formatDateTime } from '../format';


import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageData,useRepository } from '../workspace/pageData';
import { ownerOf,PageStatus } from './shared';


export function VersionPage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { language, api, downloads, navigation } = w;
  const { params } = usePageRoute();
  const date = (value: string) => formatDateTime(value, language);

  const selected=useRepository();const result=usePageData<GitHubCommit|null>('commit:'+params.repo+':'+params.sha,async()=>selected&&params.sha?api('commit',ownerOf(selected),selected.name,params.sha):null,(w.cache.get('commit:'+params.repo+':'+params.sha) as GitHubCommit)??null);const commit=result.data;const download=(ref:string)=>selected?downloads.start({kind:'archive',repo:selected,ref,fileName:`${selected.name}-${ref.slice(0,8)}.zip`}):Promise.resolve();if(!selected||!commit)return <PageStatus loading={result.loading} error={result.error}/>;

 return <>
        <button className="back-link" onClick={() => navigation.back()}><ArrowLeft size={17} />{t("versionPage.changeHistory")}</button><div className="narrow-page"><div className="eyebrow">{selected.name}  {t("versionPage.changeHistory2")}</div><h1>{commit.commit.message.split('\n')[0]}</h1><p className="page-subtitle">{commit.author?.login || commit.commit.author?.name || t("versionPage.unknownAuthor")}  {t("versionPage.publishedOn")} {commit.commit.author?.date ? date(commit.commit.author.date) : ''}</p>
        <div className="version-stats"><div><strong>{commit.files?.length ?? '—'}</strong><span>{t("versionPage.changedFiles")}</span></div><div><strong className="positive">+{commit.stats?.additions ?? '—'}</strong><span>{t("versionPage.linesAdded")}</span></div><div><strong className="negative">−{commit.stats?.deletions ?? '—'}</strong><span>{t("versionPage.linesDeleted")}</span></div></div><section className="panel"><div className="panel-heading"><h2>{t("versionPage.changedFiles")}</h2></div>{commit.files?.length ? <div className="file-list">{commit.files.map((file) => <div className="file-row" key={file.filename}><span className="file-kind"><Folder size={16} /></span><span>{file.filename}</span></div>)}</div> : <p className="muted">{t("versionPage.noFileDetailsAreAvailableForThisChange")}</p>}</section><button className="button button-primary version-download" disabled={result.loading} onClick={() => void download(commit.sha)}><ArrowDownToLine size={18} />{t("versionPage.downloadFilesAtThisPoint")}</button></div>
      </>;

}
