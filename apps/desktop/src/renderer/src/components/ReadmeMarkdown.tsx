import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

export interface ReadmeRepository {
  owner: string;
  name: string;
  branch: string;
}

function repositoryBase(repository: ReadmeRepository, image: boolean): string {
  const owner = encodeURIComponent(repository.owner);
  const name = encodeURIComponent(repository.name);
  const branch = repository.branch.split('/').map(encodeURIComponent).join('/');
  return image
    ? `https://raw.githubusercontent.com/${owner}/${name}/${branch}/README.md`
    : `https://github.com/${owner}/${name}/blob/${branch}/README.md`;
}

export function resolveReadmeUrl(value: string, repository: ReadmeRepository | undefined, image: boolean): string | null {
  const source = value.trim();
  if (!source) return null;
  try {
    const base = repository ? repositoryBase(repository, image) : undefined;
    const absolute = source.startsWith('//') ? `https:${source}` : source.startsWith('/') ? `https://github.com${source}` : source;
    const url = new URL(absolute, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

export function ReadmeMarkdown({ markdown, repository, onOpenLink }: {
  markdown: string;
  repository?: ReadmeRepository;
  onOpenLink: (url: string) => void;
}) {
  return <div className="intro-markdown readme-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={{
    a: ({ href, children }) => {
      const target = href ? resolveReadmeUrl(href, repository, false) : null;
      return <a href={target ?? undefined} onClick={(event) => { event.preventDefault(); if (target) onOpenLink(target); }}>{children}</a>;
    },
    img: ({ src, alt, width, height }) => {
      const target = src ? resolveReadmeUrl(src, repository, true) : null;
      return target ? <img src={target} alt={alt ?? ''} width={width} height={height} loading="lazy" /> : <span className="readme-missing-image">{alt ?? '图片'}</span>;
    },
  }}>{markdown}</ReactMarkdown></div>;
}
