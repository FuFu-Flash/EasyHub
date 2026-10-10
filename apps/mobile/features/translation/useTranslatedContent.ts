import { useEffect, useState } from 'react';
import { usePreferences } from '@/features/preferences/provider';
import { translationService } from './service';
import { translateMarkdownParts } from './paragraphs';

export function useTranslatedContent(original: string, protectedNames: string[], isPublic: boolean, format: 'text' | 'markdown' = 'text') {
  const { language, translationEnabled, translationNames } = usePreferences();
  const [result, setResult] = useState({ source: original, value: original, busy: false });
  const namesKey = JSON.stringify([...new Set([...protectedNames, ...translationNames])]);
  const enabled = translationEnabled && isPublic;
  useEffect(() => {
    const controller = new AbortController();
    const update = (value: string, busy: boolean) => { if (!controller.signal.aborted) setResult({ source: original, value, busy }); };
    queueMicrotask(() => update(original, enabled && Boolean(original)));
    if (enabled && original) {
      const translate = (text: string) => translationService.translate(text, language, JSON.parse(namesKey) as string[], controller.signal);
      const task = format === 'markdown'
        ? translateMarkdownParts(original, translate, controller.signal, (value) => update(value, true))
        : translate(original);
      void task.then((value) => update(value, false)).catch(() => update(original, false));
    }
    return () => controller.abort();
  }, [original, namesKey, enabled, format, language]);
  return { value: enabled && result.source === original ? result.value : original, busy: enabled && result.source === original && result.busy };
}
