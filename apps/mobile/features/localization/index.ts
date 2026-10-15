import type { AppLanguage } from '../preferences/model.ts';
import { zh } from './locales/zh.ts';
import { en } from './locales/en.ts';
import type { CatalogMessage } from './types.ts';

export type MessageKey = keyof typeof zh;
type Slots<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Slots<Rest> : never;
export type StaticMessageKey = { [K in MessageKey]: Slots<(typeof zh)[K]> extends never ? K : never }[MessageKey];
type Values<K extends MessageKey> = Record<Slots<(typeof zh)[K]>, string | number | null | undefined>;
export type Translator = <K extends MessageKey>(key: K, ...args: [Slots<(typeof zh)[K]>] extends [never]
  ? [params?: never] : [params: Values<K>]) => string;

/** The catalog is used only for interface messages. Inserted authored content stays opaque. */
export function getTranslator(language: AppLanguage): Translator {
  return ((key: MessageKey, params?: Record<string, string | number | null | undefined>) => {
    const entry: CatalogMessage = language === 'en' ? en[key] : zh[key];
    if (entry === undefined) throw new Error(`Unknown interface message: ${key}`);
    // Android Hermes does not always provide Intl.PluralRules. These are the CLDR
    // cardinal rules for our two supported languages only: English +/-1 is one;
    // Chinese always uses other. Adding another locale requires its own rules.
    const message = typeof entry === 'string' ? entry
      : language === 'en' && Math.abs(Number(params?.[entry.count])) === 1 ? entry.one : entry.other;
    // replace runs once: braces inside filenames, code and user messages are never interpreted again.
    return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (_slot, name: string) => String(params?.[name] ?? ''));
  }) as Translator;
}
