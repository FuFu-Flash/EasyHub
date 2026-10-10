import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownTranslationParts, splitTranslationSegments, translateMarkdownParts, publicTranslationAllowed } from '../features/translation/paragraphs.ts';

test('translation only uses confirmed public repository metadata', () => {
  assert.equal(publicTranslationAllowed(null), false);
  assert.equal(publicTranslationAllowed({}), false);
  assert.equal(publicTranslationAllowed({ private: true }), false);
  assert.equal(publicTranslationAllowed({ private: false }), true);
});

test('markdown translation preserves code, image and link destinations, markup and reference definitions', async () => {
  const source = '# Hello\n\n[Read this](https://example.com/page) and `code()`\n\n![Image](file.png)\n\n```js\nconst Hello = 1;\n```\n\n<div class="Hello">Hello</div>\n\n[ref]: https://example.com\n';
  const calls = [];
  const output = await translateMarkdownParts(source, async (text) => { calls.push(text); return text.replaceAll('Hello', '你好').replaceAll('Read this', '阅读'); });
  assert.match(output, /^# 你好/u);
  assert.match(output, /\[阅读\]\(https:\/\/example.com\/page\)/u);
  assert.ok(output.includes('const Hello = 1;'));
  assert.ok(output.includes('<div class="Hello">你好</div>'));
  assert.ok(output.includes('![Image](file.png)'));
  assert.ok(output.includes('[ref]: https://example.com'));
  assert.ok(calls.every((text) => !text.includes('code()') && !text.includes('https://') && !text.includes('const Hello')));
  assert.equal(markdownTranslationParts(source).map((part) => part.source).join(''), source);
});

test('HTML executable blocks are preserved without sending their contents', async () => {
  const source = '<script>\nconst Hello = 1;\n</script>\n<pre>Hello</pre>\nHello';
  const output = await translateMarkdownParts(source, async (text) => text.replaceAll('Hello', '你好'));
  assert.equal(output, '<script>\nconst Hello = 1;\n</script>\n<pre>Hello</pre>\n你好');
});

test('reference targets and multiline HTML attributes survive translation', async () => {
  const source = '[Hello][ref]\n[ref]\n[Hello][]\n<img\n alt="Hello"\n src="file.png">\nHello';
  const output = await translateMarkdownParts(source, async (text) => text.replaceAll('Hello', '你好'));
  assert.equal(output, '[你好][ref]\n[ref]\n[Hello][]\n<img\n alt="Hello"\n src="file.png">\n你好');
});

test('long translation segments preserve Unicode and placeholder boundaries', () => {
  const source = 'Hello 世界😀 ⟦123⟧ '.repeat(90);
  const segments = splitTranslationSegments(source);
  assert.equal(segments.join(''), source);
  assert.ok(segments.every((value) => new TextEncoder().encode(value).length <= 420));
  assert.ok(segments.every((value) => !value.includes('�')));
  assert.equal(segments.filter((value) => value.includes('⟦') && !/⟦123⟧/u.test(value)).length, 0);
});

test('cancelled translation does not continue to subsequent paragraphs', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(translateMarkdownParts('# First\n\n## Second', async (text) => { calls++; controller.abort(); return text; }, controller.signal), /cancelled/u);
  assert.equal(calls, 1);
});
