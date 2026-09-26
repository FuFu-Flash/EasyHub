export interface ProjectAddress { owner: string; name: string }

export function parseProjectAddress(input: string): ProjectAddress | null {
  const value = input.trim();
  if (value.length > 2048) return null;
  const normal = /^https?:\/\/(?:www\.)?github\.com\//iu.test(value) ? value
    : /^(?:www\.)?github\.com\//iu.test(value) ? `https://${value}`
      : /^git@github\.com:/iu.test(value) ? value.replace(/^git@github\.com:/iu, 'https://github.com/') : null;
  if (!normal) return null;
  let url: URL;
  try { url = new URL(normal); } catch { return null; }
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const owner = segments[0]!;
  const name = segments[1]!.replace(/\.git$/iu, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/u.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/u.test(name) || name === '.' || name === '..') return null;
  return { owner, name };
}
