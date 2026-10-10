import { useTranslatedContent } from './useTranslatedContent';

export function useTranslatedBrief(original: string, protectedNames: string[]): string {
  return useTranslatedContent(original, protectedNames, true).value;
}
