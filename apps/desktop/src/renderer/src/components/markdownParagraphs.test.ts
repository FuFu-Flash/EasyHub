import { describe, expect, it } from 'vitest';
import { splitMarkdownParagraphs } from './markdownParagraphs';

describe('splitMarkdownParagraphs', () => {
  it('splits top-level paragraphs without splitting fenced code or lists', () => {
    const markdown = '# Installation\n\nFirst paragraph.\n\nSecond paragraph.\n\n- one\n- two\n\n```ts\nconst x = 1;\n```';
    const result = splitMarkdownParagraphs(markdown);
    expect(result.paragraphs.map((part) => part.source)).toEqual([
      '# Installation', 'First paragraph.', 'Second paragraph.', '- one\n- two', '```ts\nconst x = 1;\n```',
    ]);
    expect(result.paragraphs.map((part) => part.hasProse)).toEqual([true, true, true, true, false]);
  });

  it('keeps reference definitions available to every rendered paragraph and discovers linked project names', () => {
    const result = splitMarkdownParagraphs('See [Moonlight][project].\n\nAnother paragraph.\n\n[project]: https://github.com/ExampleOrg/Moonlight');
    expect(result.paragraphs).toHaveLength(2);
    expect(result.definitions).toBe('[project]: https://github.com/ExampleOrg/Moonlight');
    expect(result.linkedNames).toEqual(expect.arrayContaining(['ExampleOrg', 'Moonlight', 'ExampleOrg/Moonlight']));
  });
});
