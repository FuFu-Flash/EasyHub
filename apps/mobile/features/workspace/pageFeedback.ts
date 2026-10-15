/** Ephemeral page feedback has a shorter lifetime than drafts and operation results. */
export function createPageFeedback<T>(empty: T) {
  let value = empty;
  let active = false;
  let language = '';
  let generation = 0;
  const listeners = new Set<() => void>();
  const clear = () => {
    value = empty;
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate: (nextLanguage: string) => { generation += 1; active = true; language = nextLanguage; clear(); },
    deactivate: () => { generation += 1; active = false; clear(); },
    changeLanguage: (nextLanguage: string) => {
      if (language === nextLanguage) return;
      generation += 1; language = nextLanguage; clear();
    },
    set: (next: T) => {
      if (!active) return;
      value = next;
      for (const listener of listeners) listener();
    },
    capture: (visible: () => boolean = () => true) => {
      const request = generation;
      return () => active && request === generation && visible();
    },
  };
}
