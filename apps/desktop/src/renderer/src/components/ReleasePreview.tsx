import { ArrowDownToLine, CalendarDays, FileArchive, FileImage } from 'lucide-react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ProjectRelease, ReleaseAsset } from '@easyhub/types';
import type { Language } from '../i18n';

type PreviewRelease = Pick<ProjectRelease, 'tagName' | 'title' | 'body' | 'channel' | 'assets'> & Partial<Pick<ProjectRelease, 'publishedAt'>>;

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
}

export function ReleasePreview({ release, imageSources, language, onAssetClick, onOpenLink }: {
  release: PreviewRelease;
  imageSources: Record<string, string>;
  language: Language;
  onAssetClick?: (asset: ReleaseAsset) => void;
  onOpenLink?: (url: string) => void;
}) {
  return <article className="release-presentation">
    <div className="release-presentation-heading">
      <div>
        <span className={`release-tag release-tag-${release.channel}`}>{release.tagName}</span>
        {release.channel !== 'stable' && <span className="release-prerelease">预览版</span>}
        <h2>{release.title}</h2>
        <small><CalendarDays size={14} />{release.publishedAt ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', { dateStyle: 'medium' }).format(new Date(release.publishedAt)) : '发布后展示给下载者'}</small>
      </div>
    </div>
    <div className="release-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key) => key === 'src' && url.startsWith('easyhub-image:') ? url : defaultUrlTransform(url)}
        components={{
          a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) onOpenLink?.(href); }}>{children}</a>,
          img: ({ src, alt }) => {
            const image = src?.startsWith('easyhub-image:') ? imageSources[src.slice('easyhub-image:'.length)] : src;
            return image ? <img src={image} alt={alt ?? ''} loading="lazy" /> : <span className="release-missing-image">{alt || '图片'}</span>;
          },
        }}
      >{release.body}</ReactMarkdown>
    </div>
    <div className="release-downloads">
      <h3>下载文件 <span>{release.assets.length}</span></h3>
      {release.assets.length ? release.assets.map((asset) => <button type="button" key={asset.id} className="release-download-row" onClick={() => onAssetClick?.(asset)}>
        {asset.mimeType.startsWith('image/') ? <FileImage size={19} /> : <FileArchive size={19} />}
        <strong>{asset.name}</strong><span>{formatFileSize(asset.size)}</span><ArrowDownToLine size={17} />
      </button>) : <p className="release-no-assets">没有额外安装包。GitHub 发布后仍会提供项目源码压缩包。</p>}
    </div>
  </article>;
}
