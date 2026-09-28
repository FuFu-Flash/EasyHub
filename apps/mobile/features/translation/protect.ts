export interface ProtectedText { value: string; originals: Map<string, string> }

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }

export function protectTranslationText(text: string, names: string[]): ProtectedText {
  const patterns = [
    /https?:\/\/[^\s<>"')]+/giu,
    /(?<![\p{L}\p{N}._/\\-])(?:[\p{L}\p{N}_-]+[\\/])*[\p{L}\p{N}_-]+\.[A-Za-z0-9]{1,10}(?![\p{L}\p{N}])/gu,
    /(?<![\p{L}\p{N}_])(?:v\d+(?:\.\d+)*|\d+(?:\.\d+)*)(?![\p{L}\p{N}_.])/giu,
    ...names.filter((name) => name.length >= 2).map((name) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, 'giu')),
  ];
  const matches = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length })));
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const originals = new Map<string, string>();
  let value = '';
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    value += text.slice(cursor, match.start);
    const marker = `⟦${originals.size}⟧`;
    originals.set(marker, text.slice(match.start, match.end));
    value += marker;
    cursor = match.end;
  }
  return { value: value + text.slice(cursor), originals };
}

export function restoreTranslationText(translated: string, protectedText: ProtectedText): string | null {
  let value = translated;
  for (const [marker, original] of protectedText.originals) {
    if (value.split(marker).length !== protectedText.value.split(marker).length) return null;
    value = value.replaceAll(marker, original);
  }
  return value;
}
