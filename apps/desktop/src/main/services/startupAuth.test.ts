import { describe, expect, it, vi } from 'vitest';
import { GitHubError } from '@easyhub/github';
import { checkStartupAuth } from './startupAuth';
const user = { login: 'tester', name: 'Test', avatar_url: 'https://example.com/avatar', html_url: 'https://github.com/tester' };
describe('startup authentication', () => {
  it('does not contact GitHub when signed out', async () => {
    const read = vi.fn(); expect(await checkStartupAuth(null, read, user)).toEqual({ state: 'signed-out', user: null, clientId: null }); expect(read).not.toHaveBeenCalled();
  });
  it('uses the verified user when signed in', async () => { expect(await checkStartupAuth('client', async () => user, null)).toEqual({ state: 'signed-in', user, clientId: 'client' }); });
  it('distinguishes an expired token from network failures', async () => {
    expect((await checkStartupAuth('client', async () => { throw new GitHubError(401, 'expired'); }, user)).state).toBe('expired');
  });
  it.each([new Error('network'), new GitHubError(500, 'unavailable'), new GitHubError(503, 'unavailable')])('retains cached identity offline (%s)', async (cause) => {
    expect(await checkStartupAuth('client', async () => { throw cause; }, user)).toEqual({ state: 'offline', user, clientId: 'client' });
  });
  it('stops an unresponsive request after eight seconds', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    try { const result = checkStartupAuth('client', (value) => { signal = value; return new Promise(() => {}); }, user); await vi.advanceTimersByTimeAsync(8000); expect(await result).toMatchObject({ state: 'offline', user }); expect(signal?.aborted).toBe(true); }
    finally { vi.useRealTimers(); }
  });
});
