import assert from 'node:assert/strict';
import test from 'node:test';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { formatAnalysisReport } from '../features/analysis/report.ts';

const markdownRequire = createRequire(realpathSync(new URL('../node_modules/react-native-markdown-display/package.json', import.meta.url)));
const MarkdownIt = markdownRequire('markdown-it');
const markdown = new MarkdownIt({ html: true, linkify: true });
const analysis = {
  id: 'analysis-one', fileName: 'program.exe', size: 1024, sha256: 'a'.repeat(64), format: 'PE', architecture: 'x86:LE:64', functionCount: 2,
  functions: [{ name: 'main', address: '0x140001000', code: 'int main() {\n    return 0;\n}\n' }],
  imports: ['ExitProcess'], strings: ['Static evidence'], summary: 'Static analysis complete.', limitations: ['Only sampled code was recovered.'],
};
const review = {
  analysisId: analysis.id, summary: 'The entry point returns.',
  findings: [{ severity: 'low', address: analysis.functions[0].address, description: 'The function returns zero.', suggestion: 'Check its callers.' }],
  limitations: ['The program was not run.'],
};

function allTokens(tokens) { return tokens.flatMap((token) => [token, ...allTokens(token.children || [])]); }

test('shared reports preserve recovered code, address, digest and sampled counts', () => {
  const report = formatAnalysisReport(analysis, review);
  const tokens = markdown.parse(report, {});
  const fences = tokens.filter((token) => token.type === 'fence');
  assert.equal(fences[0].info, 'c');
  assert.equal(fences[0].content, analysis.functions[0].code);
  assert.equal(fences[1].content, 'ExitProcess\n');
  assert.equal(fences[2].content, 'Static evidence\n');
  const rendered = markdown.render(report);
  assert.ok(rendered.includes(analysis.sha256));
  assert.ok(rendered.includes(analysis.functions[0].address));
  assert.match(rendered, /Functions \/ classes: 2 · Recovered: 1/);
  assert.match(rendered, /AI review/);
  assert.equal(markdown.parse(formatAnalysisReport({ ...analysis, format: 'CLASS' }), {}).find((token) => token.type === 'fence').info, 'java');
});

test('program text cannot close its code fence or inject Markdown, HTML, images or links', () => {
  const attack = '<script>alert(1)</script> [link](https://evil.invalid) ![image](https://evil.invalid/a.png) `inline`\n## fake heading';
  const code = 'const char *s = "<img src=x onerror=alert(1)>";\n```\n````````\n[link](https://evil.invalid)\n~~~\nreturn 0;\n';
  const input = {
    ...analysis, fileName: attack, format: attack, architecture: attack, sha256: attack, summary: attack, limitations: [attack],
    functions: [{ name: attack, address: attack, code }], imports: [attack, '``````````'], strings: [attack, '```\n## injected'],
  };
  const report = formatAnalysisReport(input, { ...review, summary: attack, findings: [{ severity: 'low', address: attack, description: attack, suggestion: attack }], limitations: [attack] });
  const tokens = markdown.parse(report, {});
  const nested = allTokens(tokens);
  assert.equal(nested.some((token) => ['html_block', 'html_inline', 'image', 'link_open'].includes(token.type)), false);
  assert.equal(tokens.filter((token) => token.type === 'heading_open' && token.tag === 'h1').length, 1);
  assert.equal(tokens.filter((token) => token.type === 'heading_open' && token.tag === 'h2').length, 5);
  const fences = tokens.filter((token) => token.type === 'fence');
  assert.equal(fences.length, 3);
  assert.equal(fences[0].content, code);
  assert.equal(fences[1].content, `${input.imports.join('\n')}\n`);
  assert.equal(fences[2].content, `${input.strings.join('\n')}\n`);
  const rendered = markdown.render(report);
  assert.ok(!rendered.includes('<script>') && !rendered.includes('<img'));
  assert.ok(rendered.includes('&lt;script&gt;'));
  assert.ok(rendered.includes('fake heading'));
});

test('reports do not attach a stale AI review to another analysis snapshot', () => {
  const withoutAi = formatAnalysisReport(analysis);
  assert.equal(formatAnalysisReport(analysis, null), withoutAi);
  assert.equal(formatAnalysisReport(analysis, { ...review, analysisId: 'another-file' }), withoutAi);
  assert.ok(!withoutAi.includes('## AI review'));
  assert.ok(formatAnalysisReport(analysis, review).includes('## AI review'));
});
