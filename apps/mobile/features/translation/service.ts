import { File, Paths } from 'expo-file-system';
import { protectTranslationText, restoreTranslationText } from './protect';
import { splitTranslationSegments } from './paragraphs';
import type { AppLanguage } from '@/features/preferences/model';

interface TranslationResponse { responseStatus?: number; responseData?: { translatedText?: string } }
export interface TranslationService {
  translate(text: string, target: AppLanguage, protectedNames: string[], signal?: AbortSignal): Promise<string>;
}

const cache = new Map<string, string>();
let cacheReady: Promise<void> | null = null;
const cacheFile = () => new File(Paths.document, 'easyhub-mobile-translations.json');

async function loadCache(): Promise<void> {
  cacheReady ??= (async () => {
    try {
      const file = cacheFile();
      if (!file.exists) return;
      const saved: unknown = JSON.parse(await file.text());
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [key, value] of Object.entries(saved)) if (typeof value === 'string') cache.set(key, value);
      }
    } catch { /* Cache failures leave the original text available. */ }
  })();
  await cacheReady;
}

function persistCache(): void {
  try {
    const file = cacheFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(Object.fromEntries([...cache].slice(-300))));
  } catch { /* In-memory cache still works for this session. */ }
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|#x27);/giu, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" })[entity.toLowerCase()] ?? entity);
}

export class MyMemoryBriefTranslationService implements TranslationService {
  private primaryUnavailable = false;

  private async translateWithMyMemory(text: string, target: AppLanguage, signal?: AbortSignal): Promise<string | null> {
    if (this.primaryUnavailable) return null;
    try {
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', text);
      url.searchParams.set('langpair', target === 'zh' ? 'en|zh-CN' : 'zh-CN|en');
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
      if (!response.ok) throw new Error('Translation unavailable');
      const data: TranslationResponse = await response.json();
      if (data.responseStatus !== 200 || !data.responseData?.translatedText) throw new Error('Translation unavailable');
      return decodeEntities(data.responseData.translatedText);
    } catch { if (!signal?.aborted) this.primaryUnavailable = true; return null; }
  }

  private async translateWithFallback(text: string, target: AppLanguage, signal?: AbortSignal): Promise<string | null> {
    try {
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.set('client', 'gtx');
      url.searchParams.set('sl', target === 'zh' ? 'en' : 'zh-CN');
      url.searchParams.set('tl', target === 'zh' ? 'zh-CN' : 'en');
      url.searchParams.set('dt', 't');
      url.searchParams.set('q', text);
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
      const translated = data[0].map((part: unknown) => Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '').join('');
      return translated || null;
    } catch { return null; }
  }

  async translate(text: string, target: AppLanguage, protectedNames: string[], signal?: AbortSignal): Promise<string> {
    const original = text.trim();
    if (!original || signal?.aborted || (target === 'zh' ? !/[A-Za-z]{3}/u.test(original) : !/\p{Script=Han}/u.test(original))) return text;
    await loadCache();
    const key = JSON.stringify([target, original, protectedNames]);
    const cached = cache.get(key);
    if (cached) return cached;
    const protectedText = protectTranslationText(original, protectedNames);
    try {
      let translated = '';
      for (const segment of splitTranslationSegments(protectedText.value)) {
        if (signal?.aborted) return text;
        const whitespace = segment.match(/^(\s*)([\s\S]*?)(\s*)$/u)!;
        if (!whitespace[2]) { translated += segment; continue; }
        const first = await this.translateWithMyMemory(whitespace[2], target, signal);
        const markers = [...protectedText.originals.keys()].filter((marker) => segment.includes(marker));
        const hasMarkers = (value: string | null) => value !== null && markers.every((marker) => value.split(marker).length === segment.split(marker).length);
        const result = hasMarkers(first) ? first : await this.translateWithFallback(whitespace[2], target, signal);
        if (!hasMarkers(result)) return text;
        translated += `${whitespace[1]}${result?.trim()}${whitespace[3]}`;
      }
      const safeText = restoreTranslationText(translated, protectedText);
      if (!safeText || safeText === original) return text;
      cache.set(key, safeText);
      persistCache();
      return safeText;
    } catch { return text; }
  }
}

export const translationService: TranslationService = new MyMemoryBriefTranslationService();
