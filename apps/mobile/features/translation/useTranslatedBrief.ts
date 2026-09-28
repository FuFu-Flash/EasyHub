import { useEffect, useState } from 'react';
import { usePreferences } from '@/features/preferences/provider';
import { translationService } from './service';

export function useTranslatedBrief(original: string, protectedNames: string[]): string {
  const { language, translationEnabled } = usePreferences();
  const [value, setValue] = useState(original);
  const namesKey = JSON.stringify(protectedNames);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setValue(original); });
    if (translationEnabled && original) {
      void translationService.translate(original, language, JSON.parse(namesKey) as string[])
        .then((translated) => { if (active) setValue(translated); });
    }
    return () => { active = false; };
  }, [original, namesKey, language, translationEnabled]);
  return value;
}
