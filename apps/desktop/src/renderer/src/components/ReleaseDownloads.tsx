import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GitHubRelease, GitHubRepo } from '@easyhub/github';
import { ArrowDownToLine, ArrowLeft, FileArchive, RotateCw } from 'lucide-react';
import type { DownloadRequest } from './useDownloadCenter';
import { TranslatableContent } from './TranslatableContent';

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReleaseDownloads({ repo, onBack, onDownload, downloadBusy, offerAdd = false, focusTag }: { repo: GitHubRepo; onBack: () => void; onDownload: (request: DownloadRequest) => void; downloadBusy: boolean; offerAdd?: boolean; focusTag?: string }) {
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const owner = repo.owner.login;

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setReleases([]);
    void window.easyHub?.github<GitHubRelease[]>('releases', owner, repo.name)
      .then((items) => { if (active) setReleases(items.filter((item) => !item.draft)); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '暂时无法获取发布的版本。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner, repo.name]);

  const visibleReleases = focusTag ? [...releases].sort((a, b) => Number(b.tag_name === focusTag) - Number(a.tag_name === focusTag)) : releases;
  const download = (ref: string, fileName: string, assetId?: number): void => onDownload({ kind: 'archive', repo, ref, assetId, fileName, offerAdd });

  return <div className="release-downloads" data-testid="release-downloads">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回项目</button>
    <div className="page-header"><div><div className="eyebrow">{repo.full_name}</div><h1>版本下载</h1><p>选择你需要的版本或文件，再保存到电脑。</p></div></div>
    {error && <div className="live-error" role="alert">{error}</div>}
    {downloadBusy && <p className="muted">下载正在进行，可在右上角通知中查看进度。</p>}
    {loading ? <p className="live-loading"><RotateCw size={16} className="live-spin" />正在获取版本…</p> : <>
      {releases.length === 0 && !error && <p className="muted">这个项目还没有发布可下载的新版本，你仍可以下载项目源码。</p>}
      {visibleReleases.map((release) => <section className="panel release-download-card" key={release.id}>
        <div className="release-download-heading"><div><span className="release-tag">{release.tag_name}</span>{release.prerelease && <span className="release-prerelease">测试版</span>}{releases[0]?.id === release.id && !release.prerelease && <span className="release-latest">最新版本</span>}{focusTag === release.tag_name && <span className="release-latest">README 提到的版本</span>}<h2>{release.name || release.tag_name}</h2><small>{release.published_at ? new Date(release.published_at).toLocaleString() : '尚未公布时间'}</small></div></div>
        {release.body && (offerAdd || !repo.private ? <TranslatableContent text={release.body} format="markdown" render={(value) => <div className="release-description"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{value}</ReactMarkdown></div>} /> : <div className="release-description"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{release.body}</ReactMarkdown></div>)}
        <div className="release-assets"><h3>可下载文件</h3>{release.assets.filter((asset) => asset.state === 'uploaded').map((asset) => <button className="release-asset" key={asset.id} disabled={downloadBusy} onClick={() => download(release.tag_name, asset.name, asset.id)}><FileArchive size={20} /><span><strong>{asset.name}</strong><small>{asset.label || sizeLabel(asset.size)} · 已下载 {asset.download_count.toLocaleString()} 次</small></span><ArrowDownToLine size={18} /></button>)}<button className="release-asset" disabled={downloadBusy} onClick={() => download(release.tag_name, `${repo.name}-${release.tag_name}.zip`)}><FileArchive size={20} /><span><strong>项目源码 ZIP</strong><small>{release.tag_name} 的完整源码</small></span><ArrowDownToLine size={18} /></button></div>
      </section>)}
      <section className="panel release-download-card"><h2>当前项目源码</h2><p className="muted">下载当前默认版本的完整源码。安装包或其他文件请从上方发布的版本中选择。</p><button className="release-asset" disabled={downloadBusy} onClick={() => download(repo.default_branch, `${repo.name}-${repo.default_branch}.zip`)}><FileArchive size={20} /><span><strong>下载源码 ZIP</strong><small>{repo.default_branch}</small></span><ArrowDownToLine size={18} /></button></section>
    </>}
  </div>;
}
