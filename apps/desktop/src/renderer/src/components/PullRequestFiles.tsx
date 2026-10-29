import { ArrowRight, Download, RotateCw, Sparkles } from 'lucide-react';
import type { GitHubPullFile, GitHubPullRequest } from '@easyhub/github';
import type { BinaryAnalysisSettingsStatus } from '@easyhub/types';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { requestProgramReviewSettings } from '../programReviewNotice';
import { PullFileChanges } from './PullFileChanges';

/** Changed files of one pull request, with the AI review entry and per-file downloads. */
export function PullRequestFiles({
  owner,
  repoName,
  language,
  selected,
  files,
  filesTruncated,
  busy,
  snapshotReady,
  hasRevision,
  aiPreparing,
  aiRunning,
  onPrepareAiReview,
  noticesEnabled,
  onDisableNotices,
  programComponentsMissing,
  currentProgramStatus,
  onOpenAiSettings,
  onOpenLink,
  canDownload,
  downloadingFile,
  downloadBusy,
  onDownload,
}: {
  owner: string;
  repoName: string;
  language: Language;
  selected: GitHubPullRequest;
  files: GitHubPullFile[];
  filesTruncated: boolean;
  busy: boolean;
  snapshotReady: boolean;
  hasRevision: boolean;
  aiPreparing: boolean;
  aiRunning: boolean;
  onPrepareAiReview: () => void;
  noticesEnabled: boolean;
  onDisableNotices: () => void;
  programComponentsMissing: boolean;
  currentProgramStatus: BinaryAnalysisSettingsStatus | null;
  onOpenAiSettings?: () => void;
  onOpenLink: (url: string) => void;
  canDownload: boolean;
  downloadingFile: string | null;
  downloadBusy: boolean;
  onDownload: (file: GitHubPullFile) => void;
}) {
  const t = useTranslation(language);
  return (
    <div className="pull-files">
      <div className="pull-files-heading">
        <h3>
          {t('pullRequestsPanel.changedFiles')} {selected.changed_files ?? files.length}
        </h3>
        <button
          className="button button-quiet"
          disabled={busy || !snapshotReady || !hasRevision || aiPreparing || aiRunning}
          onClick={onPrepareAiReview}
        >
          {aiPreparing ? <RotateCw size={16} className="live-spin" /> : <Sparkles size={16} />}
          {t('pullRequestsPanel.aiReview')}
        </button>
      </div>
      {noticesEnabled && programComponentsMissing && (
        <aside className="program-review-component-notice" role="note">
          <div>
            <strong>
              {currentProgramStatus?.state === 'error'
                ? t('pullRequestsPanel.programReviewComponentsNeedToBeReinstalled')
                : t('pullRequestsPanel.programReviewComponentsAreNotInstalled')}
            </strong>
            <p>{t('pullRequestsPanel.thisRequestIncludesProgramFilesInstallTheComponentsTo')}</p>
          </div>
          <div className="program-review-notice-actions">
            {onOpenAiSettings && (
              <button
                className="button button-quiet small-button"
                onClick={() => {
                  requestProgramReviewSettings();
                  onOpenAiSettings();
                }}
              >
                {t('pullRequestsPanel.installComponents')}
                <ArrowRight size={15} />
              </button>
            )}
            <button className="text-link" onClick={onDisableNotices}>
              {t('pullRequestsPanel.neverShowThisReminder')}
            </button>
          </div>
        </aside>
      )}
      {filesTruncated && (
        <p className="ai-settings-note">{t('pullRequestsPanel.githubReturnedOnlyPartOfThisLargeChangeCheck')}</p>
      )}
      {files.map(
        (file) =>
          selected.head.sha && (
            <PullFileChanges
              key={`${selected.head.sha}:${file.filename}`}
              file={file}
              owner={owner}
              repo={repoName}
              number={selected.number}
              headSha={selected.head.sha}
              language={language}
              onOpenLink={onOpenLink}
              downloadControl={
                <button
                  className="button button-quiet small-button"
                  disabled={
                    file.status === 'removed' ||
                    !canDownload ||
                    !snapshotReady ||
                    !hasRevision ||
                    downloadingFile !== null ||
                    downloadBusy
                  }
                  onClick={() => onDownload(file)}
                  aria-label={t('pullRequestsPanel.downloadFileLabel', {
                    p0: t('releaseEditor.downloadFiles'),
                    p1: file.filename,
                  })}
                >
                  {downloadingFile === file.filename ? (
                    <RotateCw size={15} className="live-spin" />
                  ) : (
                    <Download size={15} />
                  )}
                  {file.status === 'removed' ? t('pullRequestsPanel.deleted') : t('pullRequestsPanel.download')}
                </button>
              }
            />
          ),
      )}
      {!busy && files.length === 0 && <p className="muted">{t('pullRequestsPanel.thereAreNoFileChangesToDisplay')}</p>}
    </div>
  );
}
