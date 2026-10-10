export type RefreshTask = () => Promise<unknown>;

/** One gesture waits for every visible data source, including sources that fail. */
export function createPullRefresh() {
  let active = false;
  let refreshing = false;
  let generation = 0;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (value: boolean) => {
    if (refreshing === value) return;
    refreshing = value;
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => refreshing,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate: () => { active = true; },
    deactivate: () => { active = false; generation++; pending = null; publish(false); },
    run: (tasks: readonly RefreshTask[]): Promise<void> => {
      if (!active) return Promise.resolve();
      if (pending) return pending;
      const current = ++generation;
      const task = Promise.allSettled(tasks.map((task) => Promise.resolve().then(() => {
        if (!active || current !== generation) return;
        return task();
      }))).then(() => {
        if (!active || current !== generation) return;
        pending = null;
        publish(false);
      });
      pending = task;
      publish(true);
      return task;
    },
  };
}
