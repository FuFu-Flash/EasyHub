import { useContext, useMemo } from 'react';
import { LanguageContext, readLanguage, type Language } from './i18n';
import { zh } from './locales/zh';
import { en } from './locales/en';
import type { CatalogMessage } from './localizationTypes';

export type MessageKey = keyof typeof zh;
type Slots<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Slots<Rest> : never;
export type StaticMessageKey = { [K in MessageKey]: Slots<(typeof zh)[K]> extends never ? K : never }[MessageKey];
type Values<K extends MessageKey> = Record<Slots<(typeof zh)[K]>, string | number | null | undefined>;
export type Translator = <K extends MessageKey>(key: K, ...args: [Slots<(typeof zh)[K]>] extends [never] ? [params?: never] : [params: Values<K>]) => string;

/** Substitution happens only at explicit UI call sites; inserted user text is opaque. */
export function getTranslator(language: Language): Translator {
  const pluralRules = new Intl.PluralRules(language === 'en' ? 'en' : 'zh-CN');
  return ((key: MessageKey, params?: Record<string, string | number | null | undefined>) => {
    const entry: CatalogMessage = language === 'en' ? en[key] : zh[key];
    const message = typeof entry === 'string' ? entry : pluralRules.select(Number(params?.[entry.count])) === 'one' ? entry.one : entry.other;
    return message.replace(/\{([^}]+)\}/gu, (_slot, name: string) => String(params?.[name] ?? ''));
  }) as Translator;
}

export function useLanguage(language?: Language): Language {
  const inherited = useContext(LanguageContext);
  return language ?? inherited ?? readLanguage();
}
export function useTranslation(language?: Language): Translator {
  const current = useLanguage(language);
  return useMemo(() => getTranslator(current), [current]);
}
