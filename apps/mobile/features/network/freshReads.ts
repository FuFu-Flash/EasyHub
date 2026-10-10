/** Expo ignores RequestInit.cache, so native HTTP caches also need this header. */
export function withFreshReads(transport: typeof fetch): typeof fetch {
  return (input, init = {}) => {
    const inheritedHeaders = typeof input === 'object' && 'headers' in input ? input.headers : undefined;
    const headers = new Headers(init.headers === undefined ? inheritedHeaders : init.headers);
    headers.set('Cache-Control', 'no-store');
    return transport(input, { ...init, headers, cache: 'no-store' });
  };
}
