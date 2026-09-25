import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import type { TranslationProgress, TranslationRequest, TranslationTargetLanguage } from '@easyhub/types';

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }
export interface TranslationProvider {
  readonly id: string;
  translate(text: string, source: string, target: TranslationTargetLanguage, signal: AbortSignal): Promise<string>;
}

const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkStringify);
const MAX_SEGMENT_BYTES = 450;
const CACHE_FORMAT = 'protected-v1';

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }

function protectedNames(request: TranslationRequest, tree: MarkdownNode): string[] {
  const names = [request.repository?.name, request.repository?.owner, request.repository?.fullName, ...(request.protectedNames ?? [])];
  const addLinkedProjects = (node: MarkdownNode): void => {
    if (node.type === 'link' && node.url) {
      try {
        const url = new URL(node.url);
        const [owner, repo] = url.pathname.split('/').filter(Boolean);
        if (url.hostname.toLowerCase() === 'github.com' && owner && repo && !/^(?:issues|pulls|discussions|settings)$/iu.test(repo)) {
          const project = repo.replace(/\.git$/iu, '');
          names.push(owner, project, `${owner}/${project}`);
          if (/[-_.]/u.test(project)) names.push(project.replace(/[-_.]+/gu, ' '));
        }
      } catch { /* Relative and malformed links do not add glossary entries. */ }
    }
    for (const child of node.children ?? []) addLinkedProjects(child);
  };
  if (request.format === 'markdown') addLinkedProjects(tree);
  const slug = request.repository?.name;
  if (slug && /[-_.]/u.test(slug)) names.push(slug.replace(/[-_.]+/gu, ' '));
  return [...new Set(names.map((value) => value?.trim()).filter((value): value is string => Boolean(value && value.length >= 2 && value.length <= 80)))].sort((a, b) => b.length - a.length);
}

interface ProtectedText { value: string; originals: Map<string, string> }
class PlaceholderMismatchError extends Error {
  constructor() { super('译文未能保留项目名称，已显示原文。'); }
}

function protectText(text: string, names: string[]): ProtectedText {
  const candidates: { start: number; end: number }[] = [];
  const patterns = [
    /https?:\/\/[^\s<>"')]+/giu,
    /(?<![\p{L}\p{N}._/\\-])(?:[\p{L}\p{N}_-]+[\\/])*[\p{L}\p{N}_-]+\.[A-Za-z0-9]{1,10}(?![\p{L}\p{N}])/gu,
    /(?<![\p{L}\p{N}_])(?:v\d+(?:\.\d+)*(?:[-+][A-Za-z0-9.-]+)?|\d+(?:\.\d+)+(?:[-+][A-Za-z0-9.-]+)?|(?:alpha|beta|rc)\s?\d+(?:\.\d+)*)(?![\p{L}\p{N}_.])/giu,
    ...names.map((name) => new RegExp(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(name)
      ? escapeRegExp(name) : `(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, 'giu')),
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) candidates.push({ start: match.index, end: match.index + match[0].length });
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const nonce = randomBytes(6).toString('hex').toUpperCase();
  const originals = new Map<string, string>();
  let value = '';
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;
    value += text.slice(cursor, candidate.start);
    const marker = `EZH${nonce}T${originals.size}Z`;
    originals.set(marker, text.slice(candidate.start, candidate.end));
    value += marker;
    cursor = candidate.end;
  }
  value += text.slice(cursor);
  return { value, originals };
}

function splitProtectedSegments(text: string): string[] {
  const tokens = text.match(/EZH[A-F0-9]{12}T\d+Z|[\s\S]/gu) ?? [];
  const segments: string[] = [];
  let current = '';
  let bytes = 0;
  for (const token of tokens) {
    const length = Buffer.byteLength(token, 'utf8');
    if (current && bytes + length > MAX_SEGMENT_BYTES) {
      const split = Math.max(current.lastIndexOf(' '), current.lastIndexOf('\n'), current.lastIndexOf('。'), current.lastIndexOf('.'));
      if (split > current.length / 3) {
        segments.push(current.slice(0, split + 1));
        current = current.slice(split + 1);
      } else { segments.push(current); current = ''; }
      bytes = Buffer.byteLength(current, 'utf8');
    }
    current += token;
    bytes += length;
  }
  if (current) segments.push(current);
  return segments;
}

function restoreProtectedText(text: string, originals: Map<string, string>, source: string): string {
  for (const [marker, original] of originals) {
    const expected = source.split(marker).length - 1;
    const actual = text.split(marker).length - 1;
    if (expected !== actual) throw new PlaceholderMismatchError();
    text = text.replaceAll(marker, original);
  }
  return text;
}

export function detectSourceLanguage(text: string): string {
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/u.test(text)) return 'ko';
  if (/\p{Script=Han}/u.test(text)) return 'zh-CN';
  if (/\p{Script=Cyrillic}/u.test(text)) return 'ru';
  if (/\p{Script=Arabic}/u.test(text)) return 'ar';
  if (/\p{Script=Devanagari}/u.test(text)) return 'hi';
  const words = text.toLowerCase().match(/\p{Script=Latin}+/gu) ?? [];
  const profiles: Record<string, string[]> = {
    es: ['el', 'la', 'los', 'las', 'para', 'con', 'una', 'que', 'del', 'este', 'proyecto'],
    fr: ['le', 'les', 'des', 'une', 'pour', 'avec', 'dans', 'est', 'ce', 'projet'],
    de: ['der', 'die', 'das', 'und', 'mit', 'ein', 'eine', 'für', 'nicht', 'projekt'],
    pt: ['não', 'uma', 'para', 'com', 'dos', 'das', 'este', 'projeto', 'você'],
    it: ['gli', 'della', 'per', 'con', 'una', 'questo', 'progetto', 'sono'],
  };
  const scores = Object.entries(profiles).map(([language, terms]) => ({ language, score: words.filter((word) => terms.includes(word)).length }));
  scores.sort((a, b) => b.score - a.score);
  return scores[0]?.score && scores[0].score >= 2 ? scores[0].language : 'en';
}

export function splitTranslationSegments(text: string): string[] {
  if (Buffer.byteLength(text, 'utf8') <= MAX_SEGMENT_BYTES) return [text];
  const segments: string[] = [];
  let remaining = text;
  while (remaining) {
    let count = 0;
    let offset = 0;
    for (const char of remaining) {
      const bytes = Buffer.byteLength(char, 'utf8');
      if (count + bytes > MAX_SEGMENT_BYTES) break;
      count += bytes;
      offset += char.length;
    }
    if (offset === remaining.length) { segments.push(remaining); break; }
    const prefix = remaining.slice(0, offset);
    const boundary = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\n'), prefix.lastIndexOf('。'), prefix.lastIndexOf('.'));
    const end = boundary > offset / 3 ? boundary + 1 : offset;
    segments.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return segments;
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|#x27);/gi, (value) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" })[value.toLowerCase()] ?? value);
}

export class MyMemoryTranslationProvider implements TranslationProvider {
  readonly id = 'mymemory-v1';
  private startQueue: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];
  private lastRequestAt = 0;
  constructor(private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>) {}

  private async acquireSlot(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('翻译已取消。');
    if (this.inFlight < 2) { this.inFlight++; return; }
    await new Promise<void>((resolve, reject) => {
      const granted = (): void => { signal.removeEventListener('abort', cancelled); resolve(); };
      const cancelled = (): void => {
        const index = this.waiting.indexOf(granted);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new Error('翻译已取消。'));
      };
      this.waiting.push(granted);
      signal.addEventListener('abort', cancelled, { once: true });
    });
    if (signal.aborted) { this.releaseSlot(); throw new Error('翻译已取消。'); }
  }

  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next(); else this.inFlight--;
  }

  private async waitForStart(signal: AbortSignal): Promise<void> {
    let release: () => void = () => undefined;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.startQueue;
    this.startQueue = turn;
    await previous;
    try {
      const delay = Math.max(0, 350 - (Date.now() - this.lastRequestAt));
      if (delay) {
        try { await sleep(delay, undefined, { signal }); }
        catch { throw new Error('翻译已取消。'); }
      }
      if (signal.aborted) throw new Error('翻译已取消。');
      this.lastRequestAt = Date.now();
    } finally { release(); }
  }

  async translate(text: string, source: string, target: TranslationTargetLanguage, signal: AbortSignal): Promise<string> {
    await this.acquireSlot(signal);
    try {
      await this.waitForStart(signal);
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', text);
      url.searchParams.set('langpair', `${source}|${target}`);
      let response: Response;
      try { response = await this.fetcher(url.toString(), { signal, headers: { Accept: 'application/json' } }); }
      catch { throw new Error(signal.aborted ? '翻译已取消。' : '无法连接翻译服务，请检查网络后重试。'); }
      if (!response.ok) throw new Error(response.status === 429 ? '翻译服务请求过于频繁，请稍后重试。' : '翻译服务暂时不可用，请稍后重试。');
      const data: unknown = await response.json();
      if (typeof data !== 'object' || data === null || !('responseStatus' in data) || data.responseStatus !== 200 || !('responseData' in data) ||
        typeof data.responseData !== 'object' || data.responseData === null || !('translatedText' in data.responseData) || typeof data.responseData.translatedText !== 'string') {
        throw new Error('翻译服务没有返回有效内容，请稍后重试。');
      }
      return decodeEntities(data.responseData.translatedText);
    } finally { this.releaseSlot(); }
  }
}

export class GoogleWebTranslationProvider implements TranslationProvider {
  readonly id = 'google-web-v1';
  constructor(private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>) {}

  async translate(text: string, source: string, target: TranslationTargetLanguage, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error('翻译已取消。');
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', source);
    url.searchParams.set('tl', target);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);
    let response: Response;
    try { response = await this.fetcher(url.toString(), { signal, headers: { Accept: 'application/json' } }); }
    catch { throw new Error(signal.aborted ? '翻译已取消。' : '无法连接翻译服务，请检查网络后重试。'); }
    if (!response.ok) throw new Error(response.status === 429 ? '翻译服务请求过于频繁，请稍后重试。' : '翻译服务暂时不可用，请稍后重试。');
    const data: unknown = await response.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('翻译服务没有返回有效内容，请稍后重试。');
    const result = data[0].map((part: unknown) => Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '').join('');
    if (!result.trim()) throw new Error('翻译服务没有返回有效内容，请稍后重试。');
    return result;
  }
}

export class FallbackTranslationProvider implements TranslationProvider {
  readonly id: string;
  private primaryUnavailable = false;
  constructor(private readonly primary: TranslationProvider, private readonly fallback: TranslationProvider) {
    this.id = `${primary.id}+${fallback.id}`;
  }

  async translate(text: string, source: string, target: TranslationTargetLanguage, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error('翻译已取消。');
    if (!this.primaryUnavailable) {
      try { return await this.primary.translate(text, source, target, signal); }
      catch (cause) {
        if (signal.aborted) throw cause;
        this.primaryUnavailable = true;
      }
    }
    return this.fallback.translate(text, source, target, signal);
  }
}

export class TranslationService {
  private readonly cache = new Map<string, string>();
  private loading: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly provider: TranslationProvider, private readonly cacheFile: string) {}

  private async load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(this.cacheFile, 'utf8'));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) if (/^[a-f0-9]{64}$/u.test(key) && typeof value === 'string') this.cache.set(key, value);
        }
      } catch { /* An absent or invalid cache can be rebuilt from public content. */ }
    })();
    await this.loading;
  }

  private async save(): Promise<void> {
    const entries = [...this.cache.entries()].slice(-1_000);
    const snapshot = JSON.stringify(Object.fromEntries(entries));
    this.saving = this.saving.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.cacheFile), { recursive: true });
      const temp = `${this.cacheFile}.${randomUUID()}.tmp`;
      await writeFile(temp, snapshot, 'utf8');
      await rename(temp, this.cacheFile);
    });
    await this.saving;
  }

  private key(text: string, source: string, target: TranslationTargetLanguage, names: string[]): string {
    return createHash('sha256').update(JSON.stringify([CACHE_FORMAT, this.provider.id, source, target, text, names])).digest('hex');
  }

  private async translateProtected(core: string, source: string, target: TranslationTargetLanguage,
    originals: Map<string, string>, signal: AbortSignal): Promise<string> {
    const translated = await this.provider.translate(core, source, target, signal);
    if (!translated.trim()) throw new Error('翻译服务没有返回有效内容，请稍后重试。');
    try { return restoreProtectedText(translated, originals, core); }
    catch (cause) {
      if (!(cause instanceof PlaceholderMismatchError)) throw cause;
      // Some providers remove adjacent placeholders. Translate only prose spans, then reassemble locally.
      const parts = core.split(/(EZH[A-F0-9]{12}T\d+Z)/gu);
      const safe: string[] = [];
      for (const part of parts) {
        if (originals.has(part) || !/\p{L}/u.test(part)) { safe.push(part); continue; }
        if (signal.aborted) throw new Error('翻译已取消。');
        const leading = part.match(/^\s*/u)?.[0] ?? '';
        const trailing = part.match(/\s*$/u)?.[0] ?? '';
        const prose = part.slice(leading.length, part.length - trailing.length);
        if (!prose || detectSourceLanguage(prose).toLowerCase().split('-')[0] === target.toLowerCase().split('-')[0]) { safe.push(part); continue; }
        const value = await this.provider.translate(prose, detectSourceLanguage(prose), target, signal);
        if (!value.trim()) throw new Error('翻译服务没有返回有效内容，请稍后重试。');
        safe.push(`${leading}${value}${trailing}`);
      }
      return restoreProtectedText(safe.join(''), originals, core);
    }
  }

  private async translateSegment(text: string, names: string[], target: TranslationTargetLanguage, signal: AbortSignal,
    onCompleted: () => void): Promise<string> {
    const protectedText = protectText(text, names);
    const parts: string[] = [];
    for (const segment of splitProtectedSegments(protectedText.value)) {
      if (signal.aborted) throw new Error('翻译已取消。');
      const leading = segment.match(/^\s*/u)?.[0] ?? '';
      const trailing = segment.match(/\s*$/u)?.[0] ?? '';
      const core = segment.slice(leading.length, segment.length - trailing.length);
      const plain = core.replace(/EZH[A-F0-9]{12}T\d+Z/gu, '');
      let result = core;
      if (/\p{L}/u.test(plain)) {
        const source = detectSourceLanguage(plain);
        if (source.toLowerCase().split('-')[0] !== target.toLowerCase().split('-')[0]) {
          const cacheKey = this.key(core.replace(/EZH[A-F0-9]{12}T\d+Z/gu, (marker) => protectedText.originals.get(marker) ?? marker), source, target, names);
          const cached = this.cache.get(cacheKey);
          if (cached !== undefined) result = cached;
          else {
            result = await this.translateProtected(core, source, target, protectedText.originals, signal);
            this.cache.set(cacheKey, result);
            if (this.cache.size > 1_000) this.cache.delete(this.cache.keys().next().value!);
          }
        }
      }
      if (result === core) result = restoreProtectedText(result, protectedText.originals, core);
      parts.push(`${leading}${result}${trailing}`);
      onCompleted();
    }
    return parts.join('');
  }

  async translate(request: TranslationRequest, signal: AbortSignal, onProgress?: (progress: TranslationProgress) => void): Promise<string> {
    await this.load();
    const original = request.text;
    if (!original.trim()) return original;
    const tree = request.format === 'markdown' ? markdown.parse(original) as MarkdownNode : { type: 'root', children: [{ type: 'text', value: original }] } as MarkdownNode;
    const names = protectedNames(request, tree);
    const nodes: MarkdownNode[] = [];
    const collect = (node: MarkdownNode): void => {
      if (node.type === 'text' && node.value && /\p{L}/u.test(node.value)) nodes.push(node);
      for (const child of node.children ?? []) collect(child);
    };
    collect(tree);
    const total = nodes.reduce((sum, node) => sum + splitProtectedSegments(protectText(node.value ?? '', names).value).length, 0);
    let completed = 0;
    let changed = false;
    try {
      for (const node of nodes) {
        const before = node.value ?? '';
        node.value = await this.translateSegment(before, names, request.target, signal,
          () => onProgress?.({ id: request.id, completed: ++completed, total }));
        if (node.value !== before) changed = true;
      }
      if (signal.aborted) throw new Error('翻译已取消。');
      return request.format === 'markdown' && changed ? markdown.stringify(tree as Parameters<typeof markdown.stringify>[0]) : changed ? tree.children?.[0]?.value ?? original : original;
    } finally {
      if (this.cache.size) await this.save().catch(() => undefined);
    }
  }
}
