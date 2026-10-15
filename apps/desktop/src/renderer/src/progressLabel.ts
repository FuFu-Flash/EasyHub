import type { LocalOperationProgress } from '@easyhub/types';
import type { Translator } from './localization';

/** Progress carries stable operation codes; human diagnostics are never UI lookup keys. */
export function progressLabel(progress: Pick<LocalOperationProgress, 'step' | 'fileName' | 'count'> | null, t: Translator): string {
  switch (progress?.step) {
    case 'checking-files': return t('progress.checkingFiles');
    case 'preparing-project': return t('progress.preparingProject');
    case 'downloading-project': return t('progress.downloadingProject');
    case 'publishing-source': return t('progress.publishingSource');
    case 'saving-selection': return t('progress.savingSelection');
    case 'checking-remote': return t('progress.checkingRemote');
    case 'getting-latest': return t('progress.gettingLatest');
    case 'collecting-changes': return t('progress.collectingChanges');
    case 'creating-project': return t('progress.creatingProject');
    case 'finding-projects': return t('progress.findingProjects', { count: progress.count ?? 0 });
    case 'matching-projects': return t('progress.matchingProjects', { count: progress.count ?? 0 });
    case 'uploading-asset': return t('progress.uploadingAsset', { name: progress.fileName ?? '' });
    case 'creating-release': return t('progress.creatingRelease');
    case 'confirming-release': return t('progress.confirmingRelease');
    case 'reviewing-program': return t('progress.reviewingProgram');
    case 'review-complete': return t('progress.reviewComplete');
    case 'reading-changes': return t('progress.readingChanges');
    case 'reviewing-changes': return t('progress.reviewingChanges');
    case 'analyzing-file': return t('progress.analyzingFile', { name: progress.fileName ?? '' });
    case 'reviewing-file': return t('progress.reviewingFile', { name: progress.fileName ?? '' });
    default: return t('progress.working');
  }
}
