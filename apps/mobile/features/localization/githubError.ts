import type { GitHubError } from '@easyhub/github';
import type { Translator } from './index.ts';

/** GitHub status codes are stable; their diagnostic or authored messages are never translation keys. */
export function friendlyGitHubError(error: unknown, t: Translator): string {
  if (isGitHubError(error)) {
    if (error.status === 401) return t('repositoryOperations.yourGitHubSessionExpiredSignInAgain');
    if (error.status === 403) return t('github.actionDenied');
    if (error.status === 404) return t('repositoryOperations.thisProjectWasNotFoundOrYouDoNotHaveAccess');
    if (error.status === 422) return t('github.detailsRejected');
    return t('github.unavailable');
  }
  if (error instanceof Error && (error.name === 'AbortError' || 'code' in error && error.code === 'ABORT_ERR')) return t('github.canceled');
  return t('github.network');
}

function isGitHubError(error: unknown): error is GitHubError {
  return error instanceof Error && 'status' in error && typeof error.status === 'number';
}
