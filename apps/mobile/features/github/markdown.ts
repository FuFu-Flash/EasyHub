export function resolveReadmeLinks(markdown: string, owner: string, repo: string, branch: string): string {
  const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/`;
  const pageBase = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(branch)}/`;
  const resolve = (url: string, image: boolean): string => {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) return url;
    const clean = url.replace(/^\.\//, '').replace(/^\//, '');
    if (clean.split('/').some((part) => part === '..')) return url;
    return `${image ? rawBase : pageBase}${clean}`;
  };
  return markdown.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (match, start: string, url: string, end: string) => {
    return `${start}${resolve(url, start.startsWith('!'))}${end}`;
  }).replace(/<(img|a)\b([^>]*?)\b(src|href)=(['"])([^'"]+)\4([^>]*)>/gi,
    (match, tag: string, before: string, attr: string, quote: string, url: string, after: string) => {
      const absolute = resolve(url, tag.toLowerCase() === 'img');
      return absolute === url ? match : `<${tag}${before}${attr}=${quote}${absolute}${quote}${after}>`;
    });
}

export async function inlineReadmeImages(
  html: string, owner: string, repo: string, branch: string,
  load: (path: string) => Promise<string | null>,
): Promise<string> {
  const base = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/`;
  const paths = [...html.matchAll(/<img\b[^>]*\bsrc=(['"])([^'"]+)\1[^>]*>/gi)]
    .map((match) => match[2])
    .filter((source): source is string => !!source && source.startsWith(base))
    .map((source) => ({ source, path: decodeURIComponent(source.slice(base.length)) }))
    .filter(({ path }) => path && !path.split('/').some((part) => !part || part === '.' || part === '..'));
  const unique = [...new Map(paths.map((item) => [item.source, item.path])).entries()].slice(0, 8);
  const resolved = await Promise.all(unique.map(async ([source, path]) => {
    try { return [source, await load(path)] as const; }
    catch { return [source, null] as const; }
  }));
  const replacements = new Map(resolved.filter((entry): entry is readonly [string, string] => !!entry[1]));
  return html.replace(/(<img\b[^>]*\bsrc=(['"]))([^'"]+)(\2[^>]*>)/gi,
    (match, start: string, _quote: string, source: string, end: string) => {
      const image = replacements.get(source);
      return image ? `${start}${image}${end}` : match;
    });
}
