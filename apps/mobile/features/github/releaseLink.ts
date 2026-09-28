export interface ReleaseLink { owner: string; repo: string; tag?: string }

export function readmeReleaseLink(href: string): ReleaseLink | null {
  try {
    const url = new URL(href);
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) || !['https:', 'http:'].includes(url.protocol)) return null;
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 3 || parts[2]?.toLowerCase() !== 'releases') return null;
    const [owner, repo] = parts;
    if (!owner || !repo || !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) return null;
    if (parts.length === 3 || parts.length === 4 && parts[3] === 'latest') return { owner, repo };
    if (parts[3] === 'latest' && parts[4] === 'download' && parts.length >= 6) return { owner, repo };
    if (parts[3] === 'tag' && parts.length === 5 && parts[4]) return { owner, repo, tag: parts[4] };
    if (parts[3] === 'download' && parts.length >= 6 && parts[4]) return { owner, repo, tag: parts[4] };
    return null;
  } catch { return null; }
}
