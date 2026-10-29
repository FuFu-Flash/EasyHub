import { ArrowRight, RotateCw, ShieldCheck } from 'lucide-react';
import type { AiReviewProgress, AiReviewResult, AiSettingsStatus } from '@easyhub/types';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { progressLabel } from '../progressLabel';
import { BinaryAnalysisEvidence } from './BinaryAnalysisPanel';
import { ErrorMessage } from './ErrorMessage';

/** Progress, error or findings of the AI review for the pull request in view. */
export function PullAiReviewResult({
  language,
  aiSettings,
  aiProgress,
  aiReview,
  aiError,
  aiCanceling,
  hasProgramFiles,
  onCancel,
  onOpenAiSettings,
}: {
  language: Language;
  aiSettings: AiSettingsStatus | null;
  aiProgress: AiReviewProgress | null;
  aiReview: AiReviewResult | null;
  aiError: string;
  aiCanceling: boolean;
  hasProgramFiles: boolean;
  onCancel: () => void;
  onOpenAiSettings?: () => void;
}) {
  const t = useTranslation(language);
  return (
    <section className="ai-review-result" aria-label={t('pullRequestsPanel.aiReviewResults')}>
      <div className="pull-files-heading">
        <h3>
          <ShieldCheck size={18} />
          {t('pullRequestsPanel.aiReview')}
        </h3>
        {aiProgress && (
          <button className="button button-quiet small-button" disabled={aiCanceling} onClick={onCancel}>
            {aiCanceling ? t('pullRequestsPanel.canceling') : t('pullRequestsPanel.cancelReview')}
          </button>
        )}
      </div>
      {aiProgress && (
        <div className="ai-review-progress" role="status" aria-live="polite">
          <p>
            <RotateCw size={16} className="live-spin" />
            {aiCanceling ? t('pullRequestsPanel.cancelingReview') : progressLabel(aiProgress, t)}
            {!aiCanceling && aiProgress.total > 0 && (
              <span>
                {aiProgress.completed} / {aiProgress.total}
              </span>
            )}
          </p>
          <progress
            value={!aiCanceling && aiProgress.total > 0 ? aiProgress.completed : undefined}
            max={!aiCanceling && aiProgress.total > 0 ? aiProgress.total : undefined}
            aria-label={t('pullRequestsPanel.reviewProgress')}
          />
        </div>
      )}
      {aiError && (
        <>
          <p className="live-error" role="alert">
            <ErrorMessage error={aiError} language={language} />
          </p>
          {(!aiSettings?.hasApiKey || !aiSettings.model) && onOpenAiSettings && (
            <button className="text-link" onClick={onOpenAiSettings}>
              {t('pullRequestsPanel.openAiSettings')}
              <ArrowRight size={15} />
            </button>
          )}
        </>
      )}
      {aiReview && (
        <div className="ai-review-report" data-content-original>
          <p className="ai-review-summary">{aiReview.summary}</p>
          <p className="ai-review-scope">
            {t('pullRequestsPanel.reviewedOfFilesUseTheseSuggestionsTogetherWithYour', {
              p0: aiReview.reviewedFiles,
              p1: aiReview.totalFiles,
            })}
          </p>
          <div className="ai-findings">
            {aiReview.findings.map((finding, index) => (
              <article className="ai-finding" key={`${finding.file}:${finding.line ?? 0}:${index}`}>
                <div className="ai-finding-heading">
                  <span className={`ai-severity ai-severity-${finding.severity}`}>
                    {finding.severity === 'high'
                      ? t('pullRequestsPanel.highRisk')
                      : finding.severity === 'medium'
                        ? t('pullRequestsPanel.needsAttention')
                        : t('pullRequestsPanel.suggestion')}
                  </span>
                  <code>
                    {finding.file}
                    {finding.address ? ` @ ${finding.address}` : finding.line !== undefined ? `:${finding.line}` : ''}
                  </code>
                  {finding.analysisId && (
                    <span className="ai-review-scope">{t('pullRequestsPanel.currentProgramContent')}</span>
                  )}
                </div>
                <p>{finding.description}</p>
                <p className="ai-finding-suggestion">
                  <strong>{t('pullRequestsPanel.suggestion2')}</strong>
                  {finding.suggestion}
                </p>
              </article>
            ))}
          </div>
          {aiReview.findings.length === 0 && (
            <p className="ai-no-findings">{t('pullRequestsPanel.thisReviewDidNotReportSpecificIssues')}</p>
          )}
          {aiReview.limitations.length > 0 && (
            <div className="ai-limitations">
              <strong>{t('pullRequestsPanel.reviewCoverage')}</strong>
              <ul>
                {aiReview.limitations.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {aiReview.binaryAnalyses?.map(({ file, analysis }) => (
            <BinaryAnalysisEvidence key={analysis.id} analysis={analysis} fileLabel={file} language={language} />
          ))}
          {hasProgramFiles && onOpenAiSettings && (
            <button className="text-link" onClick={onOpenAiSettings}>
              {t('pullRequestsPanel.manageProgramReviewComponents')}
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
