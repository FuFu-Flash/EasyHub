import { describe, expect, it } from 'vitest';
import { readmeReleaseLink } from './readmeReleaseLink';

describe('readmeReleaseLink', () => {
  it('recognizes release lists, specific tags and asset links', () => {
    expect(readmeReleaseLink('https://github.com/Owner/Repo/releases')).toEqual({ owner: 'Owner', repo: 'Repo' });
    expect(readmeReleaseLink('https://github.com/Owner/Repo/releases/latest')).toEqual({ owner: 'Owner', repo: 'Repo' });
    expect(readmeReleaseLink('https://github.com/Owner/Repo/releases/latest/download/app.exe')).toEqual({ owner: 'Owner', repo: 'Repo' });
    expect(readmeReleaseLink('https://github.com/Owner/Repo/releases/tag/v1.2.0')).toEqual({ owner: 'Owner', repo: 'Repo', tag: 'v1.2.0' });
    expect(readmeReleaseLink('https://github.com/Owner/Repo/releases/download/v1.2.0/app.exe')).toEqual({ owner: 'Owner', repo: 'Repo', tag: 'v1.2.0' });
  });

  it('leaves unrelated or deceptive links external', () => {
    expect(readmeReleaseLink('https://github.com/Owner/Repo/issues')).toBeNull();
    expect(readmeReleaseLink('https://evilgithub.com/Owner/Repo/releases')).toBeNull();
    expect(readmeReleaseLink('javascript:alert(1)')).toBeNull();
    expect(readmeReleaseLink('https://github.com/Owner/Repo/releases/tag')).toBeNull();
  });
});
