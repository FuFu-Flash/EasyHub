import { useEffect, useRef, useState } from 'react';
import type { GitHubCreatedRelease, GitHubRelease, GitHubReleasePage, GitHubRepo } from '@easyhub/github';
import { ArrowDownToLine, ArrowLeft, ChevronDown, ChevronUp, FileArchive, RotateCw, Sparkles } from 'lucide-react';
import { BinaryAnalysisPanel } from './BinaryAnalysisPanel';
import { isProgramFileName } from '../../../shared/programFiles';
import type { DownloadRequest } from './useDownloadCenter';
import { TranslatableContent } from './TranslatableContent';
import { ReleaseEditPanel } from './ReleaseEditPanel';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import { readmeReleaseLink } from './readmeReleaseLink';
import { readLanguage, translateText, type Language } from '../i18n';

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReleaseDownloads({ repo, draftAccount, onBack, onDownload, downloadBusy, offerAdd = false, focusTag, canEdit = false, editOnOpen = false, language = readLanguage(), onOpenLink }: { repo: GitHubRepo; draftAccount?: string; onBack: () => void; onDownload: (request: DownloadRequest) => void; downloadBusy: boolean; offerAdd?: boolean; focusTag?: string; canEdit?: boolean; editOnOpen?: boolean; language?: Language; onOpenLink?: (url: string) => void }) {
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failedPage, setFailedPage] = useState(false);
  const [requestedTag, setRequestedTag] = useState(focusTag);
  const [reload, setReload] = useState(0);
  const requestGeneration = useRef(0);
  const loadingPage = useRef(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedReleaseIds, setExpandedReleaseIds] = useState<Set<number>>(() => new Set());
  const [analysisAsset, setAnalysisAsset] = useState<{ releaseId: number; id: number; name: string } | null>(null);
  const owner = repo.owner.login;

  useEffect(() => { setRequestedTag(focusTag); }, [focusTag, owner, repo.name]);

  useEffect(() => {
    let active = true;
    requestGeneration.current += 1;
    loadingPage.current = false;
    setNextPage(null); setLoadingMore(false); setFailedPage(false);
    setLoading(true); setError(''); setReleases([]); setEditingId(null); setExpandedReleaseIds(new Set()); setAnalysisAsset(null);
    void window.easyHub?.github<GitHubReleasePage>('releasesPage', owner, repo.name, 1)
      .then(async ({ items, nextPage: more }) => {
        if (!active) return;
        const published = items.filter((item) => !item.draft);
        setReleases(published); setNextPage(more);
        if (editOnOpen && canEdit) setEditingId((published.find((item) => item.tag_name === requestedTag) ?? published[0])?.id ?? null);
        if (requestedTag && !published.some((item) => item.tag_name === requestedTag)) {
          const linked = await window.easyHub!.github<GitHubRelease | null>('releaseByTag', owner, repo.name, requestedTag);
          if (!active) return;
          if (linked && !linked.draft) {
            setReleases((current) => [...current.filter((item) => item.id !== linked.id), linked]);
            if (editOnOpen && canEdit) setEditingId(linked.id);
          } else setError(readLanguage() === 'en' ? 'This release is unavailable. You can choose another release below.' : '找不到这个发行版，可以选择下方其他版本。');
        }
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '暂时无法获取发布的版本。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; requestGeneration.current += 1; };
  }, [owner, repo.name, editOnOpen, canEdit, requestedTag, reload]);

  async function loadMore(): Promise<void> {
    if (nextPage === null || loadingPage.current) return;
    const generation = requestGeneration.current;
    loadingPage.current = true; setLoadingMore(true); setFailedPage(false); setError('');
    try {
      const result = await window.easyHub!.github<GitHubReleasePage>('releasesPage', owner, repo.name, nextPage);
      if (generation !== requestGeneration.current) return;
      setReleases((current) => [...current, ...result.items.filter((item) => !item.draft && !current.some((known) => known.id === item.id))]);
      setNextPage(result.nextPage);
    } catch (cause) {
      if (generation === requestGeneration.current) { setFailedPage(true); setError(cause instanceof Error ? cause.message : '暂时无法获取发布的版本。'); }
    } finally {
      if (generation === requestGeneration.current) { loadingPage.current = false; setLoadingMore(false); }
    }
  }

  function openDescriptionLink(url: string): void {
    const link = readmeReleaseLink(url);
    if (link && link.owner.toLowerCase() === owner.toLowerCase() && link.repo.toLowerCase() === repo.name.toLowerCase()) {
      setRequestedTag(link.tag);
      if (link.tag === requestedTag) document.querySelector('.release-download-card:not(.release-source-card)')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (onOpenLink) onOpenLink(url);
    else void window.easyHub?.openExternalLink(url).catch(() => setError(language === 'en' ? 'Unable to open this link.' : '暂时无法打开这个链接。'));
  }

  const renderDescription = (markdown: string) => <div className="release-description"><ReadmeMarkdown markdown={markdown} repository={{ owner, name: repo.name, branch: repo.default_branch }} onOpenLink={openDescriptionLink} /></div>;

  const visibleReleases = requestedTag ? [...releases].sort((a, b) => Number(b.tag_name === requestedTag) - Number(a.tag_name === requestedTag)) : releases;
  const download = (ref: string, fileName: string, assetId?: number): void => onDownload({ kind: 'archive', repo, ref, assetId, fileName, offerAdd });
  const onUpdated = (value: GitHubCreatedRelease): void => setReleases((current) => current.map((item) => item.id === value.id ? value : item));
  const toggleDescription = (releaseId: number): void => setExpandedReleaseIds((current) => {
    const next = new Set(current);
    if (next.has(releaseId)) next.delete(releaseId);
    else next.add(releaseId);
    return next;
  });

  return <div className="release-downloads" data-testid="release-downloads">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回项目</button>
    <div className="page-header"><div><div className="eyebrow">{repo.full_name}</div><h1>{editOnOpen && canEdit ? '编辑发行版' : '下载发行版或源码'}</h1><p>{editOnOpen && canEdit ? '选择已发布的版本，修改介绍或管理下载文件。' : '选择发行版文件或源码，再保存到电脑。'}</p></div></div>
    {error && <div className="live-error" role="alert">{error}{!loading && <button type="button" className="text-link" disabled={loadingMore} onClick={() => failedPage ? void loadMore() : setReload((value) => value + 1)}>{language === 'en' ? 'Try again' : '重试'}</button>}</div>}
    {downloadBusy && <p className="muted">下载正在进行，可在右上角通知中查看进度。</p>}
    <section className="panel release-download-card release-source-card">
      <h2>当前项目源码</h2>
      <p className="muted">下载当前默认版本的完整源码。安装包或其他文件请从下方发布的版本中选择。</p>
      <button type="button" className="release-asset" disabled={downloadBusy} onClick={() => download(repo.default_branch, `${repo.name}-${repo.default_branch}.zip`)}><FileArchive size={20} /><span><strong>下载源码 ZIP</strong><small>{repo.default_branch}</small></span><ArrowDownToLine size={18} /></button>
    </section>
    {loading ? <p className="live-loading"><RotateCw size={16} className="live-spin" />正在获取版本…</p> : <>
      {releases.length === 0 && !error && <p className="muted">{editOnOpen && canEdit ? '这个项目还没有可编辑的发行版，请先发布新版本。' : '这个项目还没有发布可下载的新版本，你仍可以下载项目源码。'}</p>}
      {visibleReleases.map((release) => {
        const expanded = expandedReleaseIds.has(release.id);
        const descriptionId = `release-description-${repo.id}-${release.id}`;
        return <section className="panel release-download-card" key={release.id}>
        {canEdit && <div className="release-edit-entry"><button type="button" className="secondary-button" onClick={() => setEditingId((value) => value === release.id ? null : release.id)}>{translateText(editingId === release.id ? '收起编辑' : '编辑发行版', readLanguage())}</button></div>}
        <div className="release-download-heading"><div><span className="release-tag">{release.tag_name}</span>{release.prerelease && <span className="release-prerelease">测试版</span>}{releases[0]?.id === release.id && !release.prerelease && <span className="release-latest">最新版本</span>}{requestedTag === release.tag_name && <span className="release-latest">README 提到的版本</span>}<h2>{release.name || release.tag_name}</h2><small>{release.published_at ? new Date(release.published_at).toLocaleString() : '尚未公布时间'}</small></div></div>
        <div className="release-assets"><h3>可下载文件</h3>{release.assets.filter((asset) => asset.state === 'uploaded').map((asset) => <div className="binary-release-asset" key={asset.id}><button className="release-asset" disabled={downloadBusy} onClick={() => download(release.tag_name, asset.name, asset.id)}><FileArchive size={20} /><span><strong>{asset.name}</strong><small>{asset.label || sizeLabel(asset.size)} · 已下载 {asset.download_count.toLocaleString()} 次</small></span><ArrowDownToLine size={18} /></button>{isProgramFileName(asset.name) && <button className="button button-quiet small-button" onClick={() => setAnalysisAsset((current) => current?.id === asset.id ? null : { releaseId: release.id, id: asset.id, name: asset.name })} aria-label={`${language === 'en' ? 'AI review program file' : 'AI 审查程序文件'} ${asset.name}`}><Sparkles size={16} />{language === 'en' ? 'AI review' : 'AI 审查'}</button>}</div>)}<button className="release-asset" disabled={downloadBusy} onClick={() => download(release.tag_name, `${repo.name}-${release.tag_name}.zip`)}><FileArchive size={20} /><span><strong>项目源码 ZIP</strong><small>{release.tag_name} 的完整源码</small></span><ArrowDownToLine size={18} /></button></div>
        {analysisAsset?.releaseId === release.id && <BinaryAnalysisPanel language={language} source={{ kind: 'release', owner, repo: repo.name, assetId: analysisAsset.id, name: analysisAsset.name }} />}
        {release.body && <>
          <button type="button" className="secondary-button release-description-toggle" aria-expanded={expanded} aria-controls={descriptionId} onClick={() => toggleDescription(release.id)}>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {translateText(expanded ? '收起说明' : '展开完整说明', readLanguage())}
          </button>
          <div id={descriptionId} className="release-description-content" hidden={!expanded}>
            {expanded && (offerAdd || !repo.private ? <TranslatableContent text={release.body} format="markdown" render={renderDescription} /> : renderDescription(release.body))}
          </div>
        </>}
        {canEdit && editingId === release.id && <ReleaseEditPanel repo={repo} release={release} draftAccount={draftAccount} onUpdated={onUpdated} onClose={() => setEditingId(null)} onOpenLink={openDescriptionLink} />}
      </section>;
      })}
      {nextPage !== null && <button type="button" className="button button-quiet" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <><RotateCw size={16} className="live-spin" />{language === 'en' ? 'Loading…' : '正在加载…'}</> : language === 'en' ? 'Load more releases' : '加载更多版本'}</button>}
    </>}
  </div>;
}
