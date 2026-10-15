import { getTranslator, type MessageKey } from './localization';
import { readAppError, encodeAppError, type ErrorCode } from '../../shared/errors';
import { readLanguage, type Language } from './i18n';
const messages = {
  NETWORK: 'errors.network',
  TIMEOUT: 'errors.timeout',
  UNAUTHORIZED: 'errors.unauthorized',
  RATE_LIMIT: 'errors.rate_limit',
  FORBIDDEN: 'errors.forbidden',
  NOT_FOUND: 'errors.not_found',
  CONFLICT: 'errors.conflict',
  VALIDATION: 'errors.validation',
  GIT_CONFLICT: 'errors.git_conflict',
  FILE_PERMISSION: 'errors.file_permission',
  SERVER: 'errors.server',
  UNKNOWN: 'errors.unknown',
} as const satisfies Record<ErrorCode, MessageKey>;
/** Keep the original, redacted information in state until the UI renders it. */
export function errorText(error: unknown, fallback?: string): string {
  return encodeAppError(error ?? fallback);
}
export function friendlyError(error: unknown, language: Language = readLanguage()): string {
  const result = readAppError(error);
  if (result.code === 'UNKNOWN' && language === 'zh' && /[\u3400-\u9fff]/u.test(result.detail))
    return result.detail.replace(/^\[[A-Z_]+\]\s*/u, '');
  return getTranslator(language)(messages[result.code]);
}
export { readAppError };
