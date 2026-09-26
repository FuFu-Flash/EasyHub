import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ReadmeMarkdown, resolveReadmeUrl } from './ReadmeMarkdown';

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

describe('README preview', () => {
  it('keeps the centered icon and title used by the EasyHub README', () => {
    const markdown = '<p align="center"><img src="apps/desktop/src/renderer/src/assets/easyhub-icon.svg" alt="EasyHub 图标" width="72" height="72"></p>\n\n<h1 align="center">EasyHub</h1>';
    const html = renderToStaticMarkup(createElement(ReadmeMarkdown, { markdown, repository: { owner: 'FuFu-Flash', name: 'EasyHub', branch: 'main' }, onOpenLink: () => undefined }));
    expect(html).toContain('raw.githubusercontent.com/FuFu-Flash/EasyHub/main/apps/desktop/src/renderer/src/assets/easyhub-icon.svg');
    expect(html).toContain('width="72"');
    expect(html).toContain('align="center"');
    expect(html).toContain('EasyHub</h1>');
  });

  it('drops executable HTML and unsafe links while keeping supported formatting', () => {
    const markdown = '<script>alert(1)</script><p align="center" onclick="alert(2)"><a href="javascript:alert(3)">bad</a><strong>Safe</strong></p>';
    const html = renderToStaticMarkup(createElement(ReadmeMarkdown, { markdown, repository, onOpenLink: () => undefined }));
    expect(html).toContain('<strong>Safe</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
  });
});
