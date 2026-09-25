import { describe, expect, it } from 'vitest';
import { resolveReadmeUrl } from './ReadmeMarkdown';

const repository = { owner: 'FuFu-Flash', name: 'elysia-tunnel-gui', branch: 'main' };

describe('README URLs', () => {
  it('loads repository screenshots from the same revision', () => {
    expect(resolveReadmeUrl('docs/screenshot.png', repository, true)).toBe(
      'https://raw.githubusercontent.com/FuFu-Flash/elysia-tunnel-gui/main/docs/screenshot.png',
    );
  });

  it('opens relative README links within the repository', () => {
    expect(resolveReadmeUrl('README.en.md', repository, false)).toBe(
      'https://github.com/FuFu-Flash/elysia-tunnel-gui/blob/main/README.en.md',
    );
  });

  it('preserves external badges and rejects unsafe links', () => {
    expect(resolveReadmeUrl('https://img.shields.io/badge/test-ok-blue', repository, true)).toBe(
      'https://img.shields.io/badge/test-ok-blue',
    );
    expect(resolveReadmeUrl('javascript:alert(1)', repository, false)).toBeNull();
  });
});
