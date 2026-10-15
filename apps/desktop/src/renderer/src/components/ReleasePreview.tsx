import { useTranslation } from '../localization';
import { formatDateTime } from '../format';
import { ArrowDownToLine, CalendarDays, FileArchive, FileImage } from 'lucide-react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { ProjectRelease, ReleaseAsset } from '@easyhub/types';
import type { Language } from '../i18n';

type PreviewRelease = Pick<ProjectRelease, 'tagName' | 'title' | 'body' | 'channel' | 'assets'> &
  Partial<Pick<ProjectRelease, 'publishedAt'>>;
const previewSchema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, src: [...(defaultSchema.protocols?.src ?? []), 'easyhub-image'] },
};

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
}

export function ReleasePreview({
  release,
  imageSources,
  language,
  onAssetClick,
  onOpenLink,
}: {
  release: PreviewRelease;
  imageSources: Record<string, string>;
  language: Language;
  onAssetClick?: (asset: ReleaseAsset) => void;
  onOpenLink?: (url: string) => void;
}) {
  const t = useTranslation(language);
  return (
    <article className="release-presentation">
      <div className="release-presentation-heading">
        <div>
          <span className={`release-tag release-tag-${release.channel}`}>{release.tagName}</span>
          {release.channel !== 'stable' && <span className="release-prerelease">{t('releasePreview.prerelease')}</span>}
          <h2>{release.title}</h2>
          <small>
            <CalendarDays size={14} />
            {release.publishedAt
              ? formatDateTime(release.publishedAt, language)
              : t('releasePreview.shownToDownloadersAfterPublishing')}
          </small>
        </div>
      </div>
      <div className="release-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, previewSchema]]}
          urlTransform={(url, key) =>
            key === 'src' && url.startsWith('easyhub-image:') ? url : defaultUrlTransform(url)
          }
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  if (href) onOpenLink?.(href);
                }}
              >
                {children}
              </a>
            ),
            img: ({ src, alt }) => {
              const image = src?.startsWith('easyhub-image:') ? imageSources[src.slice('easyhub-image:'.length)] : src;
              return image ? (
                <img src={image} alt={alt ?? ''} loading="lazy" />
              ) : (
                <span className="release-missing-image">{alt || t('releasePreview.image')}</span>
              );
            },
          }}
        >
          {release.body}
        </ReactMarkdown>
      </div>
      <div className="release-downloads">
        <h3>
          {t('releasePreview.downloadFiles')} <span>{release.assets.length}</span>
        </h3>
        {release.assets.length ? (
          release.assets.map((asset) => (
            <button type="button" key={asset.id} className="release-download-row" onClick={() => onAssetClick?.(asset)}>
              {asset.mimeType.startsWith('image/') ? <FileImage size={19} /> : <FileArchive size={19} />}
              <strong>{asset.name}</strong>
              <span>{formatFileSize(asset.size)}</span>
              <ArrowDownToLine size={17} />
            </button>
          ))
        ) : (
          <p className="release-no-assets">{t('releasePreview.noExtraInstallerGithubWillStillOfferSourceArchives')}</p>
        )}
      </div>
    </article>
  );
}
