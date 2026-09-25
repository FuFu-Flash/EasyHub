import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FallbackTranslationProvider, GoogleWebTranslationProvider, MyMemoryTranslationProvider, TranslationService, detectSourceLanguage, splitTranslationSegments, type TranslationProvider } from './TranslationService';

const folders: string[] = [];
async function cachePath(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'easyhub-translation-test-')); folders.push(dir); return join(dir, 'translations.json'); }
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

function fakeProvider(calls: string[]): TranslationProvider {
  return { id: 'test-provider', async translate(text) { calls.push(text); return `译文 ${text}`; } };
}

describe('TranslationService', () => {
  it('preserves Markdown links, images and code while translating visible prose', async () => {
    const calls: string[] = [];
    const service = new TranslationService(fakeProvider(calls), await cachePath());
    const original = '# Install\n\n[Open docs](https://example.com/docs) and ![Screenshot](images/main.png).\n\n```ts\nconst value = "Do not translate";\n```';
    const result = await service.translate({ id: 'one', text: original, format: 'markdown', target: 'zh-CN' }, new AbortController().signal);
    expect(result).toContain('https://example.com/docs');
    expect(result).toContain('images/main.png');
    expect(result).toContain('const value = "Do not translate";');
    expect(result).toContain('译文 Install');
    expect(calls).not.toContain('Do not translate');
  });

  it('uses the local cache across service instances without changing the original', async () => {
    const path = await cachePath();
    const calls: string[] = [];
    const request = { id: 'one', text: 'Open the project', format: 'text' as const, target: 'zh-CN' as const };
    const first = await new TranslationService(fakeProvider(calls), path).translate(request, new AbortController().signal);
    const second = await new TranslationService(fakeProvider(calls), path).translate(request, new AbortController().signal);
    expect(first).toBe('译文 Open the project');
    expect(second).toBe(first);
    expect(request.text).toBe('Open the project');
    expect(calls).toEqual(['Open the project']);
  });

  it('skips content already in the target language and splits long text within the provider limit', async () => {
    expect(detectSourceLanguage('这是一个公开项目')).toBe('zh-CN');
    expect(detectSourceLanguage('これは日本語です')).toBe('ja');
    expect(detectSourceLanguage('Install the project')).toBe('en');
    const calls: string[] = [];
    const service = new TranslationService(fakeProvider(calls), await cachePath());
    expect(await service.translate({ id: 'same', text: '这是一个公开项目', format: 'text', target: 'zh-CN' }, new AbortController().signal)).toBe('这是一个公开项目');
    expect(calls).toHaveLength(0);
    const chunks = splitTranslationSegments('long phrase '.repeat(100));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('long phrase '.repeat(100));
    expect(chunks.every((part) => Buffer.byteLength(part, 'utf8') <= 450)).toBe(true);
  });

  it('stops before sending text to a provider when cancelled', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const service = new TranslationService(fakeProvider(calls), await cachePath());
    await expect(service.translate({ id: 'cancel', text: 'Install the project', format: 'text', target: 'zh-CN' }, controller.signal)).rejects.toThrow('翻译已取消');
    expect(calls).toHaveLength(0);
  });

  it('calls the public provider without an embedded secret', async () => {
    let called = '';
    const provider = new MyMemoryTranslationProvider(async (url) => {
      called = url;
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '你好' } }), { status: 200 });
    });
    expect(await provider.translate('Hello', 'en', 'zh-CN', new AbortController().signal)).toBe('你好');
    const url = new URL(called);
    expect(url.hostname).toBe('api.mymemory.translated.net');
    expect(url.searchParams.get('langpair')).toBe('en|zh-CN');
    expect(url.searchParams.has('key')).toBe(false);
  });

  it('uses another public provider after a rate limit and avoids repeating the limited request', async () => {
    let primaryCalls = 0;
    const primary: TranslationProvider = { id: 'limited', async translate() { primaryCalls++; throw new Error('翻译服务请求过于频繁，请稍后重试。'); } };
    const fallback = new GoogleWebTranslationProvider(async (url) => {
      expect(new URL(url).searchParams.has('key')).toBe(false);
      return new Response(JSON.stringify([[['中文译文', 'English text']]]), { status: 200 });
    });
    const provider = new FallbackTranslationProvider(primary, fallback);
    const signal = new AbortController().signal;
    expect(await provider.translate('English text', 'en', 'zh-CN', signal)).toBe('中文译文');
    expect(await provider.translate('Another text', 'en', 'zh-CN', signal)).toBe('中文译文');
    expect(primaryCalls).toBe(1);
  });

  it('starts the next paragraph request while an earlier network response is still pending', async () => {
    const started: string[] = [];
    let finishFirst: ((value: Response) => void) | undefined;
    const response = () => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '译文' } }), { status: 200 });
    const provider = new MyMemoryTranslationProvider(async (url) => {
      started.push(new URL(url).searchParams.get('q') ?? '');
      if (started.length === 1) return new Promise<Response>((resolve) => { finishFirst = resolve; });
      return response();
    });
    const signal = new AbortController().signal;
    const first = provider.translate('first paragraph', 'en', 'zh-CN', signal);
    const second = provider.translate('second paragraph', 'en', 'zh-CN', signal);
    try {
      await vi.waitFor(() => expect(started).toHaveLength(2), { timeout: 800, interval: 10 });
      expect(started).toEqual(['first paragraph', 'second paragraph']);
    } finally {
      finishFirst?.(response());
      await Promise.allSettled([first, second]);
    }
  });

  it('limits simultaneous translation requests and drops a cancelled waiting request', async () => {
    const started: string[] = [];
    const releases: Array<(value: Response) => void> = [];
    const response = () => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '译文' } }), { status: 200 });
    const provider = new MyMemoryTranslationProvider(async (url) => {
      started.push(new URL(url).searchParams.get('q') ?? '');
      return new Promise<Response>((resolve) => releases.push(resolve));
    });
    const signal = new AbortController().signal;
    const cancelled = new AbortController();
    const first = provider.translate('first', 'en', 'zh-CN', signal);
    const second = provider.translate('second', 'en', 'zh-CN', signal);
    const third = provider.translate('cancelled', 'en', 'zh-CN', cancelled.signal);
    try {
      await vi.waitFor(() => expect(started).toHaveLength(2), { timeout: 800, interval: 10 });
      cancelled.abort();
      await expect(third).rejects.toThrow('翻译已取消');
      expect(started).toEqual(['first', 'second']);
    } finally {
      releases.forEach((release) => release(response()));
      await Promise.allSettled([first, second, third]);
    }
  });

  it('translates ordinary headings while keeping project names, custom names, versions, files and links exact', async () => {
    const calls: string[] = [];
    const provider: TranslationProvider = { id: 'hostile-test', async translate(text) {
      calls.push(text);
      return text.replace(/Installation/gu, '安装').replace(/Sunshine/gu, '阳光').replace(/Moonlight/gu, '月光')
        .replace(/LizardByte/gu, '蜥蜴').replace(/setup\.exe/gu, '安装程序').replace(/v1\.2\.3/gu, '版本一');
    } };
    const source = '# Sunshine\n\n## Installation\n\nInstall Sunshine with Moonlight v1.2.3 from setup.exe. Visit https://example.com/help and `npm install Sunshine`.\n';
    const result = await new TranslationService(provider, await cachePath()).translate({
      id: 'names', text: source, format: 'markdown', target: 'zh-CN',
      repository: { name: 'Sunshine', owner: 'LizardByte', fullName: 'LizardByte/Sunshine' },
      protectedNames: ['Moonlight'],
    }, new AbortController().signal);
    expect(result).toContain('## 安装');
    expect(result).toContain('# Sunshine');
    expect(result).toContain('Moonlight v1.2.3 from setup.exe');
    expect(result).toContain('https://example.com/help');
    expect(result).toContain('`npm install Sunshine`');
    expect(result).not.toMatch(/阳光|月光|蜥蜴|安装程序|版本一/u);
    expect(calls.some((call) => call.includes('Installation'))).toBe(true);
    expect(calls.every((call) => !/Sunshine|Moonlight|setup\.exe|v1\.2\.3/u.test(call))).toBe(true);
  });

  it('recovers when a provider drops a placeholder by translating prose spans separately', async () => {
    const calls: string[] = [];
    const provider: TranslationProvider = { id: 'broken-test', async translate(text) {
      calls.push(text);
      return text.includes('EZH') ? text.replace(/EZH[A-F0-9]+T\d+Z/gu, '') : text.replace('Install', '安装').replace('now', '现在');
    } };
    const source = 'Install Sunshine now';
    const result = await new TranslationService(provider, await cachePath()).translate({
      id: 'broken', text: source, format: 'text', target: 'zh-CN', repository: { name: 'Sunshine', owner: 'LizardByte' },
    }, new AbortController().signal);
    expect(result).toBe('安装 Sunshine 现在');
    expect(calls).toEqual([expect.stringContaining('EZH'), 'Install', 'now']);
    expect(source).toBe('Install Sunshine now');
  });

  it('rejects an unrecoverable translation so the UI can show the original', async () => {
    const provider: TranslationProvider = { id: 'unrecoverable-test', async translate(text) {
      if (!text.includes('EZH')) throw new Error('翻译服务暂时不可用');
      return text.replace(/EZH[A-F0-9]+T\d+Z/gu, '');
    } };
    const source = 'Install Sunshine now';
    await expect(new TranslationService(provider, await cachePath()).translate({
      id: 'unrecoverable', text: source, format: 'text', target: 'zh-CN', repository: { name: 'Sunshine', owner: 'LizardByte' },
    }, new AbortController().signal)).rejects.toThrow('翻译服务暂时不可用');
    expect(source).toBe('Install Sunshine now');
  });

  it('uses a separate cache entry when protected names change', async () => {
    const calls: string[] = [];
    const service = new TranslationService(fakeProvider(calls), await cachePath());
    const base = { id: 'glossary-cache', text: 'Install Moonlight', format: 'text' as const, target: 'zh-CN' as const };
    await service.translate(base, new AbortController().signal);
    const protectedResult = await service.translate({ ...base, protectedNames: ['Moonlight'] }, new AbortController().signal);
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain('Moonlight');
    expect(protectedResult).toContain('Moonlight');
  });

  it('builds protection from whichever project is open without special-casing example names', async () => {
    const provider: TranslationProvider = { id: 'dynamic-names', async translate(text) {
      return text.replace(/Installation/gu, '安装').replace(/Aurora/gu, '极光').replace(/Moonlight/gu, '月光')
        .replace(/alpha0\.1/gu, '测试版本').replace(/src\/main\.ts/gu, '主文件');
    } };
    const service = new TranslationService(provider, await cachePath());
    const result = await service.translate({
      id: 'dynamic', text: '# Installation\n\nInstall Aurora alpha0.1 using src/main.ts. Moonlight is another project.',
      format: 'markdown', target: 'zh-CN', repository: { name: 'Aurora', owner: 'ExampleOrg' },
    }, new AbortController().signal);
    expect(result).toContain('# 安装');
    expect(result).toContain('Aurora alpha0.1 using src/main.ts');
    expect(result).toContain('月光 is another project');
  });

  it('adds linked GitHub project names to the glossary automatically', async () => {
    const calls: string[] = [];
    const provider: TranslationProvider = { id: 'linked-projects', async translate(text) {
      calls.push(text);
      return text.replace(/Moonlight/gu, '月光').replace(/Install/gu, '安装');
    } };
    const source = 'Install [Moonlight](https://github.com/ExampleOrg/Moonlight) to connect with Moonlight.';
    const result = await new TranslationService(provider, await cachePath()).translate({
      id: 'links', text: source, format: 'markdown', target: 'zh-CN', repository: { name: 'Sunshine', owner: 'AnotherOrg' },
    }, new AbortController().signal);
    expect(result).toContain('[Moonlight](https://github.com/ExampleOrg/Moonlight)');
    expect(result).toContain('with Moonlight');
    expect(calls.every((call) => !call.includes('Moonlight'))).toBe(true);
  });

  it('protects a Chinese project name even when adjacent to other Chinese characters', async () => {
    const provider: TranslationProvider = { id: 'chinese-names', async translate(text) { return text.replace(/星河/gu, 'Galaxy').replace(/使用/gu, 'Use'); } };
    const result = await new TranslationService(provider, await cachePath()).translate({
      id: 'chinese', text: '使用星河软件', format: 'text', target: 'en', repository: { name: '星河', owner: 'author' },
    }, new AbortController().signal);
    expect(result).toBe('Use星河软件');
  });
});
