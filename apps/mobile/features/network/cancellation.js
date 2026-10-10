/**
 * React Native's AbortSignal exposes `aborted` without `throwIfAborted`.
 * @param {Pick<AbortSignal, 'aborted'> | undefined} signal
 */
export function throwIfCancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('操作已取消。');
  error.name = 'AbortError';
  throw error;
}
