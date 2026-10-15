import { GitHubError } from '@easyhub/github';
import type { GitHubUser } from '@easyhub/github';
import type { AuthStatus } from '../../shared/auth';

export async function checkStartupAuth(clientId: string | null, readUser: (signal: AbortSignal) => Promise<GitHubUser>, cachedUser: GitHubUser | null, timeout = 8000): Promise<AuthStatus> {
  if (!clientId) return { state: 'signed-out', user: null, clientId: null };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Timed out')); }, timeout); });
  try { return { state: 'signed-in', user: await Promise.race([readUser(controller.signal), deadline]), clientId }; }
  catch (cause) {
    return cause instanceof GitHubError && cause.status === 401
      ? { state: 'expired', user: null, clientId }
      : { state: 'offline', user: cachedUser, clientId };
  } finally { clearTimeout(timer!); }
}
