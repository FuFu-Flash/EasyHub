export type NoticeClock = {
  now: () => number;
  schedule: (callback: () => void, milliseconds: number) => unknown;
  cancel: (handle: unknown) => void;
};

const systemClock: NoticeClock = {
  now: () => Date.now(),
  schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Only brief success feedback expires. Independent interactions pause its remaining time. */
export function createNoticeTimer(expire: () => void, duration = 4000, clock = systemClock) {
  let remaining = duration;
  let started = 0;
  let handle: unknown;
  let disposed = false;
  let generation = 0;
  const paused = new Set<string>();
  const resume = () => {
    const request = ++generation;
    started = clock.now();
    handle = clock.schedule(() => {
      if (disposed || paused.size || request !== generation) return;
      disposed = true;
      expire();
    }, remaining);
  };
  const timer = {
    pause: (reason: string) => {
      if (disposed || paused.has(reason)) return;
      if (!paused.size) {
        generation++;
        remaining = Math.max(0, remaining - Math.max(0, clock.now() - started));
        clock.cancel(handle);
      }
      paused.add(reason);
    },
    release: (reason: string) => {
      if (!disposed && paused.delete(reason) && !paused.size) resume();
    },
    dispose: () => {
      disposed = true;
      generation++;
      clock.cancel(handle);
    },
  };
  resume();
  return timer;
}
