import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSession } from './session';

/** Reconnect repeats the focused read without changing its client or reading window. */
export function useSessionReadFocusEffect(effect: (revision: number) => void | (() => void)) {
  const { readRevision } = useSession();
  useFocusEffect(useCallback(() => effect(readRevision), [effect, readRevision]));
}
