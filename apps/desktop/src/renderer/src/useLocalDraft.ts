import { useCallback, useRef, useState } from 'react';
import { readDraft, writeDraft, removeDraft } from './draftStore';

export function useLocalDraft(key: string): readonly [string, (value: string) => void, (expected?: string) => void] {
  const memory = useRef(new Map<string, string>());
  const [, render] = useState(0);
  if (!memory.current.has(key)) memory.current.set(key, readDraft(key));
  const value = memory.current.get(key)!;
  const setValue = useCallback((next: string) => {
    memory.current.set(key, next);
    writeDraft(key, next);
    render((version) => version + 1);
  }, [key]);
  const clear = useCallback((expected?: string) => {
    const latest = memory.current.has(key) ? memory.current.get(key) : readDraft(key);
    if (expected !== undefined && latest !== expected) return;
    memory.current.set(key, ''); removeDraft(key); render((version) => version + 1);
  }, [key]);
  return [value, setValue, clear];
}
