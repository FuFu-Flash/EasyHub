import { getTranslator } from './localization';
import { readLanguage, type Language } from './i18n';
import type { LocalProjectStatus, SyncPreview } from '@easyhub/types';

export type ProjectState = 'saved' | 'changes' | 'remote' | 'review' | 'checking' | 'unavailable';
export function projectPresentation(status?: LocalProjectStatus, remote?: SyncPreview, failed = false, language: Language = readLanguage()): { state: ProjectState; text: string } {
  const t = getTranslator(language);
  if (status?.needsReview || remote?.state === 'review') return { state: 'review', text: t("localWorkspace.contentNeedsYourChoice") };
  if (failed || remote?.state === 'blocked') return { state: 'unavailable', text: t("projectStatus.unavailable") };
  if (!status) return { state: 'checking', text: t("projectStatus.checking") };
  if (status.files.length) return { state: 'changes', text: t('projectStatus.unpublished', { count: status.files.length }) };
  if (remote?.state === 'ready') return { state: 'remote', text: t("projectStatus.remote") };
  if (!remote) return { state: 'checking', text: t("projectStatus.noLocalChanges") };
  return { state: 'saved', text: t("projectStatus.saved") };
}
