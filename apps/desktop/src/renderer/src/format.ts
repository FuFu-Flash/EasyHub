import { getTranslator } from './localization';
import type { Language } from './i18n';
const locale = (language: Language): string => (language === 'en' ? 'en-US' : 'zh-CN');
export function formatDateTime(iso: string | null | undefined, language: Language): string {
  const date = new Date(iso ?? '');
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale(language), { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : '—';
}
export function formatRelative(iso: string, language: Language): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  const seconds = (time - Date.now()) / 1000;
  if (Math.abs(seconds) < 60) return getTranslator(language)('time.justNow');
  const [divisor, unit] =
    Math.abs(seconds) < 3600
      ? ([60, 'minute'] as const)
      : Math.abs(seconds) < 86400
        ? ([3600, 'hour'] as const)
        : ([86400, 'day'] as const);
  return new Intl.RelativeTimeFormat(locale(language), { numeric: 'auto' }).format(Math.trunc(seconds / divisor), unit);
}
