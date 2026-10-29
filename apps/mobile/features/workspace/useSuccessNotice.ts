import { useCallback, useLayoutEffect, useRef } from "react";
import { usePageFeedback } from "./usePageFeedback";

export type SuccessNotice = { id: number; message: string };

/** Each operation gets a fresh deadline, including repeated identical success messages. */
export function useSuccessNotice() {
  const { value, set: setValue } = usePageFeedback<SuccessNotice | null>(null);
  const sequence = useRef(0);
  const current = useRef(value);
  useLayoutEffect(() => {
    current.current = value;
  }, [value]);
  const set = useCallback(
    (message: string) => {
      const next = message ? { id: ++sequence.current, message } : null;
      current.current = next;
      setValue(next);
    },
    [setValue],
  );
  const dismiss = useCallback(
    (id: number) => {
      if (current.current?.id !== id) return;
      current.current = null;
      setValue(null);
    },
    [setValue],
  );
  return { value, set, dismiss };
}
