import type { BinaryAnalysisResult, BinaryAiReviewResult } from '@easyhub/types';

// Treat program and AI text as literal data, including in renderers that enable
// HTML and automatic links. Generated headings and separators remain Markdown.
function text(value: string): string {
  return value.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/gu, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return `\\${character}`;
  });
}

function line(value: string): string { return text(value.replace(/[\r\n\t]+/gu, ' ')); }

function block(value: string, language = ''): string {
  let length = 3;
  for (const run of value.matchAll(/`+/gu)) length = Math.max(length, run[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}${language}\n${value}${value.endsWith('\n') ? '' : '\n'}${fence}`;
}

/** Serializes one analysis snapshot; a review of a different file is excluded. */
export function formatAnalysisReport(analysis: BinaryAnalysisResult, review?: BinaryAiReviewResult | null): string {
  const language = /^(apk|dex|jar|class)$/iu.test(analysis.format) ? 'java' : 'c';
  const sections = [
    `# ${line(analysis.fileName)}`,
    `${line(analysis.format)} · ${line(analysis.architecture)} · ${analysis.size} bytes`,
    `SHA-256: ${line(analysis.sha256)}`,
    text(analysis.summary),
    `Functions / classes: ${analysis.functionCount} · Recovered: ${analysis.functions.length}`,
    '## Analysis limits',
    ...analysis.limitations.map((value) => `- ${text(value)}`),
    ...analysis.functions.flatMap((item) => [`## ${line(item.name)}`, `Address: ${line(item.address)}`, block(item.code, language)]),
    '## Imports', block(analysis.imports.join('\n')),
    '## Strings', block(analysis.strings.join('\n')),
  ];
  if (review?.analysisId === analysis.id) {
    sections.push('## AI review', text(review.summary));
    for (const finding of review.findings) sections.push(
      `### ${line(finding.severity)}${finding.address ? ` · ${line(finding.address)}` : ''}`,
      text(finding.description), `Suggestion: ${text(finding.suggestion)}`,
    );
    sections.push('### AI review limits', ...review.limitations.map((value) => `- ${text(value)}`));
  }
  return `${sections.join('\n\n')}\n`;
}
