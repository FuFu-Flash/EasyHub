import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { createPullRefresh, type RefreshTask } from './pullRefresh';

export interface RefreshHandle { refresh(): Promise<unknown> }

/** Data loaders own cancellation and errors; this hook owns the pull indicator. */
export function usePullRefresh(tasks: readonly RefreshTask[]) {
  const controller = useMemo(() => createPullRefresh(), []);
  const refreshing = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useFocusEffect(useCallback(() => {
    controller.activate();
    return controller.deactivate;
  }, [controller]));
  const refresh = useCallback(() => { void controller.run(tasks); }, [controller, tasks]);
  return { refresh, refreshing };
}
