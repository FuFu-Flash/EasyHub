import { getTranslator } from './localization';
import type { Language } from './i18n';
const labels = {
  environment: 'sensitive.environment',
  'key-file': 'sensitive.key-file',
  'credential-file': 'sensitive.credential-file',
  'login-config': 'sensitive.login-config',
  'private-key': 'sensitive.private-key',
  'github-token': 'sensitive.github-token',
  'aws-key': 'sensitive.aws-key',
  'slack-token': 'sensitive.slack-token',
  'service-account': 'sensitive.service-account',
} as const;
export function sensitiveReasonText(reason: string, language: Language): string {
  const key = Object.hasOwn(labels, reason) ? labels[reason as keyof typeof labels] : 'sensitive.unknown';
  return getTranslator(language)(key);
}
