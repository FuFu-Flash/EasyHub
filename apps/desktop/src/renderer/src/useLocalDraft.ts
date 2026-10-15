import { useCallback, useRef, useState } from 'react';
import { readDraft, writeDraft, removeDraft } from './draftStore';
import { useWorkspaceStorage } from './bridge';

export function useLocalDraft(key: string): readonly [string, (value: string) => void, (expected?: string) => void] {
  const storage = useWorkspaceStorage();
  const memory = useRef(new Map<string, string>());
  const [, render] = useState(0);
  if (!memory.current.has(key)) memory.current.set(key, readDraft(key, storage));
  const value = memory.current.get(key)!;
  const setValue = useCallback((next: string) => {
    memory.current.set(key, next);
    writeDraft(key, next, storage);
    render((version) => version + 1);
  }, [key]);
  const clear = useCallback((expected?: string) => {
    const latest = memory.current.has(key) ? memory.current.get(key) : readDraft(key, storage);
    if (expected !== undefined && latest !== expected) return;
    memory.current.set(key, ''); removeDraft(key, storage); render((version) => version + 1);
  }, [key]);
  return [value, setValue, clear];
}
