import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { zh } from './locales/zh';
import { en } from './locales/en';
import { getTranslator, useTranslation } from './localization';
import { LanguageContext } from './i18n';
import type { CatalogMessage } from './localizationTypes';
const slots = (text: string) => [...new Set([...text.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]))].sort();
describe('key based interface localization', () => {
  it('has exactly the same keys and parameters in both catalogs', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      const entry: CatalogMessage = en[key];
      for (const text of typeof entry === 'string' ? [entry] : [entry.one, entry.other]) {
        expect(slots(text), key).toEqual(slots(zh[key]));
        expect(text, key).not.toMatch(/[\u3400-\u9fff]/u);
      }
      if (typeof entry !== 'string') expect(slots(zh[key]), key).toContain(entry.count);
    }
  });
  it('selects singular, zero and plural variants using the count', () => {
    const t = getTranslator('en');
    expect(t('projectStatus.unpublished', { count: 1 })).toBe('1 file not published');
    expect(t('projectStatus.unpublished', { count: 0 })).toBe('0 files not published');
    expect(t('projectStatus.unpublished', { count: 3 })).toBe('3 files not published');
    expect(getTranslator('zh')('projectStatus.unpublished', { count: 1 })).toBe('有 1 个文件还没发布');
  });
  it('does not reinterpret substituted names, code or placeholders', () => {
    const name = '安装 Installation {count} <code>中文</code>';
    expect(getTranslator('en')('downloadNotifications.downloadProgressFor', { p0: name })).toBe(
      `Download progress for ${name}`,
    );
  });
  it('uses provider language before storage effects', () => {
    function Label() {
      const t = useTranslation();
      return createElement('input', {
        placeholder: t('topbarSearch.searchProjectsUsers2'),
        title: t('topbarSearch.clearSearch'),
      });
    }
    const html = renderToStaticMarkup(createElement(LanguageContext.Provider, { value: 'en' }, createElement(Label)));
    expect(html).not.toMatch(/[\u3400-\u9fff]/u);
    expect(html).toContain('Search projects/users');
  });
});
