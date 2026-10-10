export interface TranslationPart { source: string; translate: boolean }

export function publicTranslationAllowed(repository: { private?: boolean } | null | undefined): boolean {
  return repository?.private === false;
}

/** Keep executable text, Markdown layout, destinations, and HTML attributes out of translation. */
export function markdownTranslationParts(markdown: string): TranslationPart[] {
  const parts: TranslationPart[] = [];
  const add = (source: string, translate: boolean) => {
    if (!source) return;
    const previous = parts.at(-1);
    if (previous?.translate === translate) previous.source += source;
    else parts.push({ source, translate });
  };
  let fence = '';
  let htmlComment = false;
  let codeTag = '';
  let htmlTag = false;
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
    if (codeTag) {
      add(line, false);
      if (new RegExp(`</${codeTag}\\s*>`, 'iu').test(line)) codeTag = '';
      continue;
    }
    const boundary = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (boundary) {
      if (!fence) fence = boundary;
      else if (boundary[0] === fence[0] && boundary.length >= fence.length) fence = '';
      add(line, false); continue;
    }
    if (fence || /^(?: {4}|\t)/u.test(line) || /^\s*\[[^\]]+\]:/u.test(line) || /^\s*[-:|\s]+\s*$/u.test(line)) {
      add(line, false); continue;
    }
    const prefix = line.match(/^\s*(?:(?:#{1,6}|>|[-+*]|\d+[.)])\s+|\[[ xX]\]\s+)*/u)?.[0] ?? '';
    add(prefix, false);
    let cursor = prefix.length;
    while (cursor < line.length) {
      if (htmlComment || line.startsWith('<!--', cursor)) {
        const end = line.indexOf('-->', cursor);
        if (end === -1) { add(line.slice(cursor), false); htmlComment = true; break; }
        add(line.slice(cursor, end + 3), false); cursor = end + 3; htmlComment = false; continue;
      }
      const remainder = line.slice(cursor);
      if (htmlTag || remainder.startsWith('<') && !remainder.includes('>')) {
        const end = remainder.indexOf('>');
        if (end === -1) { add(remainder, false); htmlTag = true; break; }
        add(remainder.slice(0, end + 1), false); cursor += end + 1; htmlTag = false; continue;
      }
      const codeStart = remainder.match(/^<(pre|code|script|style)\b[^>]*>/iu);
      if (codeStart) {
        const close = remainder.match(new RegExp(`</${codeStart[1]}\\s*>`, 'iu'));
        if (close?.index !== undefined) { const end = close.index + close[0].length; add(remainder.slice(0, end), false); cursor += end; continue; }
        add(remainder, false); codeTag = codeStart[1]; break;
      }
      const reference = remainder.match(/^!?\[[^\]\n]+\](?:\[[^\]\n]*\])?/u)?.[0];
      if (reference && !remainder.slice(reference.length).startsWith('(')) {
        const named = reference.match(/^\[([^\]]+)\](\[[^\]]+\])$/u);
        if (named) { add('[', false); add(named[1], true); add(`]${named[2]}`, false); }
        else add(reference, false);
        cursor += reference.length; continue;
      }
      const protectedToken = remainder.match(/^(?:`+[^`\n]*`+|!?\[[^\]\n]*\]\([^\n)]*\)|<[^>\n]+>|https?:\/\/[^\s<>]+|\\.|[\[\]*_~|]+)/u)?.[0];
      if (protectedToken) {
        // Link labels are prose; images, destinations, and punctuation stay unchanged.
        const link = protectedToken.match(/^\[([^\]]+)\](\([^)]*\))$/u);
        if (link) { add('[', false); add(link[1], true); add(`]${link[2]}`, false); }
        else add(protectedToken, false);
        cursor += protectedToken.length; continue;
      }
      let end = cursor + 1;
      while (end < line.length && !/[`<!\[\]*_~|\\]/u.test(line[end]) && !line.startsWith('http', end)) end++;
      add(line.slice(cursor, end), true); cursor = end;
    }
  }
  return parts;
}

/** Split at natural boundaries without splitting Unicode characters or protected placeholders. */
export function splitTranslationSegments(text: string, maximumBytes = 420): string[] {
  const segments: string[] = [];
  const tokens = text.match(/⟦\d+⟧|[\s\S]/gu) ?? [];
  let current = '';
  let bytes = 0;
  const byteLength = (value: string) => new TextEncoder().encode(value).length;
  for (const token of tokens) {
    const tokenBytes = byteLength(token);
    if (current && bytes + tokenBytes > maximumBytes) {
      const boundary = Math.max(current.lastIndexOf(' '), current.lastIndexOf('\n'), current.lastIndexOf('。'), current.lastIndexOf('.'));
      if (boundary > current.length / 3) { segments.push(current.slice(0, boundary + 1)); current = current.slice(boundary + 1); }
      else { segments.push(current); current = ''; }
      bytes = byteLength(current);
    }
    current += token; bytes += tokenBytes;
  }
  if (current) segments.push(current);
  return segments;
}

export async function translateMarkdownParts(markdown: string, translate: (text: string) => Promise<string>, signal?: AbortSignal,
  onProgress?: (value: string) => void): Promise<string> {
  const parts = markdownTranslationParts(markdown);
  for (const part of parts) {
    if (signal?.aborted) throw new Error('Translation cancelled');
    if (!part.translate || !/\p{L}/u.test(part.source)) continue;
    const whitespace = part.source.match(/^(\s*)([\s\S]*?)(\s*)$/u)!;
    const translated = await translate(whitespace[2]);
    if (signal?.aborted) throw new Error('Translation cancelled');
    part.source = `${whitespace[1]}${translated}${whitespace[3]}`;
    onProgress?.(parts.map((item) => item.source).join(''));
  }
  return parts.map((part) => part.source).join('');
}
