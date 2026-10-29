import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFocusEffect } from "expo-router";
import { usePreferences } from "../preferences/provider";
import { createPageFeedback } from "./pageFeedback";

/** Keep translated notices local to the currently active visit; never reset a draft. */
export function usePageFeedback<T = string>(empty: T = "" as T, enabled = true) {
  const { language } = usePreferences();
  const [feedback] = useState(() => createPageFeedback(empty));
  const visible = useRef(enabled);
  useLayoutEffect(() => {
    visible.current = enabled;
    if (!enabled) feedback.deactivate();
  }, [enabled, feedback]);
  const value = useSyncExternalStore(feedback.subscribe, feedback.snapshot, feedback.snapshot);
  useEffect(() => feedback.changeLanguage(language), [feedback, language]);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) {
        feedback.deactivate();
        return;
      }
      feedback.activate(language);
      return feedback.deactivate;
    }, [feedback, language, enabled]),
  );
  const set = useCallback(
    (next: T) => {
      if (visible.current) feedback.set(next);
    },
    [feedback],
  );
  const capture = useCallback(() => feedback.capture(() => visible.current), [feedback]);
  return { value: enabled ? value : empty, set, capture };
}
