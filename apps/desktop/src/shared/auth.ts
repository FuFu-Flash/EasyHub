import type { GitHubUser } from '@easyhub/github';
export interface AuthStatus {
  state: 'signed-out' | 'signed-in' | 'expired' | 'offline';
  user: GitHubUser | null;
  clientId: string | null;
}
