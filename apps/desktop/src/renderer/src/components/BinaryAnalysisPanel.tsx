import { useNoticeState } from '../useNoticeState';
import { FeedbackNotice } from './FeedbackNotice';
import { progressLabel } from '../progressLabel';
import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText as errorMessage } from '../errors';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, FileSearch, FolderOpen, RotateCw, Sparkles, X } from 'lucide-react';
import type {
  AiReviewProgress,
  AiSettingsStatus,
  BinaryAiReviewResult,
  BinaryAnalysisProgress,
  BinaryAnalysisResult,
  BinaryAnalysisSettingsStatus,
  BinaryAnalysisSource,
} from '@easyhub/types';
import type { Language } from '../i18n';

interface BinaryAnalysisPanelProps {
  language: Language;
  source?: BinaryAnalysisSource;
  onOpenSettings?: () => void;
  disabled?: boolean;
  onStatusChanged?: (status: BinaryAnalysisSettingsStatus) => void;
}

type Operation = 'choose' | 'install' | 'prepare-ai' | 'review' | 'cancel' | 'check';
type ActiveRequest = { id: string; kind: 'binary' | 'ai'; completion?: Promise<unknown> };

function fileName(source: BinaryAnalysisSource): string {
  return source.kind === 'pull' ? source.path.split(/[\\/]/).at(-1) || source.path : source.name;
}

function sourceIdentity(source?: BinaryAnalysisSource): string {
  if (!source) return '';
  if (source.kind === 'local') return `local:${source.fileId}`;
  if (source.kind === 'pull')
    return `pull:${source.owner}/${source.repo}:${source.number}:${source.headSha}:${source.path}`;
  return `release:${source.owner}/${source.repo}:${source.assetId}`;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BinaryAnalysisEvidence({
  analysis,
  language,
  fileLabel = analysis.fileName,
}: {
  analysis: BinaryAnalysisResult;
  language: Language;
  fileLabel?: string;
}) {
  const t = useTranslation(language);

  return (
    <details className="binary-extracted-details">
      <summary>
        {t('binaryAnalysisPanel.extractedProgramEvidence')} · <span data-content-original>{fileLabel}</span>
      </summary>
      <div className="ai-review-report" data-content-original>
        <p>{analysis.summary}</p>
        <dl className="binary-file-metadata">
          <div>
            <dt>{t('binaryAnalysisPanel.file')}</dt>
            <dd>{analysis.fileName}</dd>
          </div>
          <div>
            <dt>{t('binaryAnalysisPanel.size')}</dt>
            <dd>{sizeLabel(analysis.size)}</dd>
          </div>
          <div>
            <dt>{t('binaryAnalysisPanel.format')}</dt>
            <dd>{analysis.format}</dd>
          </div>
          <div>
            <dt>{t('binaryAnalysisPanel.architecture')}</dt>
            <dd>{analysis.architecture}</dd>
          </div>
          <div>
            <dt>{t('binaryAnalysisPanel.functions')}</dt>
            <dd>{analysis.functionCount.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd>{analysis.sha256}</dd>
          </div>
        </dl>
        {analysis.functions.length > 0 && (
          <div className="binary-functions">
            <h4>{t('binaryAnalysisPanel.functionExcerpts')}</h4>
            {analysis.functions.map((fn, index) => (
              <details key={`${fn.address}:${index}`}>
                <summary>
                  <code>{fn.name}</code>
                  <span>{fn.address}</span>
                </summary>
                <pre>
                  <code>{fn.code}</code>
                </pre>
              </details>
            ))}
          </div>
        )}
        {analysis.imports.length > 0 && (
          <details>
            <summary>{t('binaryAnalysisPanel.imports', { p0: analysis.imports.length })}</summary>
            <ul className="binary-extracted-list">
              {analysis.imports.map((item, index) => (
                <li key={index}>
                  <code>{item}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
        {analysis.strings.length > 0 && (
          <details>
            <summary>{t('binaryAnalysisPanel.textExcerpts', { p0: analysis.strings.length })}</summary>
            <ul className="binary-extracted-list">
              {analysis.strings.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </details>
        )}
        {analysis.limitations.length > 0 && (
          <div className="ai-limitations">
            <strong>{t('binaryAnalysisPanel.extractionCoverage')}</strong>
            <ul>
              {analysis.limitations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

export function BinaryAnalysisPanel({
  language,
  source,
  onOpenSettings,
  disabled = false,
  onStatusChanged,
}: BinaryAnalysisPanelProps) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [status, setStatus] = useState<BinaryAnalysisSettingsStatus | null>(null);
  const [loading, setLoading] = useState(!disabled);
  const [selectedSource, setSelectedSource] = useState<BinaryAnalysisSource | null>(source ?? null);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [progress, setProgress] = useState<BinaryAnalysisProgress | null>(null);
  const [analysis, setAnalysis] = useState<BinaryAnalysisResult | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettingsStatus | null>(null);
  const [aiConfirm, setAiConfirm] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiReviewProgress | null>(null);
  const [review, setReview] = useState<BinaryAiReviewResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useNoticeState(language);
  const mounted = useRef(false);
  const operation = useRef(0);
  const activeRequest = useRef<ActiveRequest | null>(null);
  const pendingCancellation = useRef<{ request: ActiveRequest; completion: Promise<void> } | null>(null);
  const confirmDialog = useRef<HTMLDivElement>(null);
  const aiButton = useRef<HTMLButtonElement>(null);
  const consentTitleId = useId();
  const sourceKey = sourceIdentity(source);
  const previousSourceKey = useRef(sourceKey);

  function updateStatus(value: BinaryAnalysisSettingsStatus): void {
    setStatus(value);
    onStatusChanged?.(value);
  }

  function cancelRequest(request: ActiveRequest): Promise<void> | undefined {
    return request.kind === 'ai' ? easyHub?.aiCancelReview(request.id) : easyHub?.binaryAnalysisCancel(request.id);
  }

  function settleCancellation(request: ActiveRequest): Promise<void> {
    if (pendingCancellation.current?.request === request) return pendingCancellation.current.completion;
    const completion = (async () => {
      const results = await Promise.allSettled([cancelRequest(request), request.completion]);
      const canceled = results[0];
      if (canceled?.status === 'rejected') throw canceled.reason;
    })();
    const pending = { request, completion };
    pendingCancellation.current = pending;
    const clear = (): void => {
      if (pendingCancellation.current === pending) pendingCancellation.current = null;
    };
    void completion.then(clear, clear);
    return completion;
  }

  useEffect(() => {
    mounted.current = true;
    const unsubscribeBinary = easyHub?.onBinaryAnalysisProgress?.((value) => {
      if (activeRequest.current?.kind === 'binary' && activeRequest.current.id === value.requestId) setProgress(value);
    });
    const unsubscribeAi = easyHub?.onAiReviewProgress?.((value) => {
      if (activeRequest.current?.kind === 'ai' && activeRequest.current.id === value.requestId) setAiProgress(value);
    });
    return () => {
      mounted.current = false;
      operation.current += 1;
      unsubscribeBinary?.();
      unsubscribeAi?.();
      if (activeRequest.current) void cancelRequest(activeRequest.current)?.catch(() => undefined);
      activeRequest.current = null;
    };
  }, []);

  useEffect(() => {
    const request = activeRequest.current ?? pendingCancellation.current?.request;
    activeRequest.current = null;
    const id = ++operation.current;
    if (previousSourceKey.current !== sourceKey) {
      previousSourceKey.current = sourceKey;
      setSelectedSource(source ?? null);
    }
    setBusy(request ? 'cancel' : null);
    setProgress(null);
    setAnalysis(null);
    setAiConfirm(false);
    setAiProgress(null);
    setReview(null);
    setError('');
    setNotice('');
    if (request)
      void (async () => {
        await settleCancellation(request).catch(() => undefined);
        const value = await easyHub?.binaryAnalysisStatus().catch(() => null);
        if (mounted.current && operation.current === id) {
          if (value) updateStatus(value);
          setBusy(null);
        }
      })();
  }, [sourceKey, language]);

  useEffect(() => {
    if (disabled) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const bridge = easyHub;
    if (!bridge?.binaryAnalysisStatus) {
      setLoading(false);
      setError(t('binaryAnalysisPanel.couldNotLoadAnalysisComponentStatusReopenSettings'));
      return;
    }
    void bridge
      .binaryAnalysisStatus()
      .then((value) => {
        if (active) updateStatus(value);
      })
      .catch((cause) => {
        if (active)
          setError(errorMessage(cause, t('binaryAnalysisPanel.couldNotLoadAnalysisComponentStatusPleaseRetry')));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [disabled]);

  useEffect(() => {
    if (!aiConfirm) return;
    confirmDialog.current?.querySelector<HTMLButtonElement>('[data-cancel-binary-ai]')?.focus();
    return () => {
      aiButton.current?.focus();
    };
  }, [aiConfirm]);

  const externalBusy = status?.state === 'installing' || status?.state === 'analyzing';
  const locked =
    disabled ||
    loading ||
    busy !== null ||
    pendingCancellation.current !== null ||
    externalBusy ||
    !easyHub?.binaryAnalysisStatus;
  const current = (id: number): boolean => mounted.current && operation.current === id;

  async function checkStatus(): Promise<void> {
    if (!easyHub?.binaryAnalysisStatus || disabled || loading || busy) return;
    const id = ++operation.current;
    setBusy('check');
    setError('');
    setNotice('');
    try {
      const value = await easyHub.binaryAnalysisStatus();
      if (current(id)) updateStatus(value);
    } catch (cause) {
      if (current(id))
        setError(errorMessage(cause, t('binaryAnalysisPanel.couldNotCheckTheAnalysisComponentsPleaseRetry')));
    } finally {
      if (current(id)) setBusy(null);
    }
  }

  async function chooseFile(): Promise<void> {
    if (!easyHub || locked) return;
    const id = ++operation.current;
    setBusy('choose');
    setError('');
    setNotice('');
    try {
      const value = await easyHub.binaryAnalysisChooseFile();
      if (!current(id) || !value) return;
      setSelectedSource(value);
      setAnalysis(null);
      setReview(null);
      setAiConfirm(false);
    } catch (cause) {
      if (current(id)) setError(errorMessage(cause, t('binaryAnalysisPanel.couldNotSelectTheFilePleaseRetry')));
    } finally {
      if (current(id)) setBusy(null);
    }
  }

  async function install(): Promise<void> {
    if (!easyHub || locked) return;
    const id = ++operation.current;
    const requestId = crypto.randomUUID();
    activeRequest.current = { id: requestId, kind: 'binary' };
    setBusy('install');
    setError('');
    setNotice('');
    setProgress({ requestId, phase: 'installing', completed: 0, total: 0 });
    updateStatus({ ...status, installed: false, state: 'installing', engineVersion: status?.engineVersion ?? '' });
    try {
      const completion = easyHub.binaryAnalysisInstall(requestId);
      activeRequest.current = { id: requestId, kind: 'binary', completion };
      const value = await completion;
      if (!current(id)) return;
      updateStatus(value);
      setNotice(t('binaryAnalysisPanel.reviewComponentsInstalledSelectAFileToStartAi'));
    } catch (cause) {
      if (current(id)) {
        setError(errorMessage(cause, t('binaryAnalysisPanel.analysisComponentsCouldNotBeInstalledPleaseRetry')));
        const value = await easyHub.binaryAnalysisStatus().catch(() => null);
        if (current(id) && value) updateStatus(value);
      }
    } finally {
      if (current(id)) {
        activeRequest.current = null;
        setBusy(null);
        setProgress(null);
      }
    }
  }

  async function prepareAiReview(): Promise<void> {
    if (!easyHub || locked || !selectedSource || !status?.installed) return;
    const id = ++operation.current;
    setBusy('prepare-ai');
    setError('');
    setNotice('');
    try {
      const value = await easyHub.aiSettings();
      if (!current(id)) return;
      setAiSettings(value);
      if (!value.hasApiKey || !value.model) setError(t('binaryAnalysisPanel.connectYourAiServiceInSettingsFirst'));
      else setAiConfirm(true);
    } catch (cause) {
      if (current(id)) setError(errorMessage(cause, t('binaryAnalysisPanel.couldNotLoadAiSettingsPleaseRetry')));
    } finally {
      if (current(id)) setBusy(null);
    }
  }

  async function startAiReview(): Promise<void> {
    if (!easyHub || locked || !selectedSource || !status?.installed || !aiSettings || !aiConfirm) return;
    const id = ++operation.current;
    const requestId = crypto.randomUUID();
    activeRequest.current = { id: requestId, kind: 'binary' };
    setBusy('review');
    setAiConfirm(false);
    setError('');
    setNotice('');
    setAnalysis(null);
    setReview(null);
    setProgress({ requestId, phase: 'preparing', completed: 0, total: 0 });
    setAiProgress(null);
    updateStatus({ ...status, state: 'analyzing' });
    try {
      const extraction = easyHub.binaryAnalyze({ requestId, source: selectedSource, language });
      activeRequest.current = { id: requestId, kind: 'binary', completion: extraction };
      const evidence = await extraction;
      if (!current(id)) return;
      setAnalysis(evidence);
      setProgress(null);
      updateStatus({ ...status, state: 'ready' });
      setAiProgress({ requestId, phase: t('binaryAnalysisPanel.reviewingWithAi'), completed: 0, total: 1 });
      const completion = easyHub.binaryAiReview({
        requestId,
        analysisId: evidence.id,
        providerBaseUrl: aiSettings.baseUrl,
        consentToSend: true,
        language,
      });
      activeRequest.current = { id: requestId, kind: 'ai', completion };
      const value = await completion;
      if (!current(id)) return;
      if (value.analysisId !== evidence.id)
        throw new Error(t('binaryAnalysisPanel.theProgramContentHasChangedStartAiReviewAgain'));
      setReview(value);
    } catch (cause) {
      if (current(id)) setError(errorMessage(cause, t('binaryAnalysisPanel.aiReviewCouldNotBeCompletedCheckTheFile')));
    } finally {
      if (current(id)) {
        activeRequest.current = null;
        setProgress(null);
        setAiProgress(null);
        const value = await easyHub.binaryAnalysisStatus().catch(() => null);
        if (current(id)) {
          if (value) updateStatus(value);
          setBusy(null);
        }
      }
    }
  }

  async function cancel(): Promise<void> {
    const request = activeRequest.current;
    if (!request) return;
    const id = ++operation.current;
    activeRequest.current = null;
    setBusy('cancel');
    setProgress(null);
    setAiProgress(null);
    setError('');
    try {
      await settleCancellation(request);
      const value = await easyHub?.binaryAnalysisStatus();
      if (current(id)) {
        if (value) updateStatus(value);
        setNotice(t('binaryAnalysisPanel.canceled'));
      }
    } catch (cause) {
      if (current(id)) setError(errorMessage(cause, t('binaryAnalysisPanel.couldNotCancelCheckTheStatusAgain')));
    } finally {
      if (current(id)) setBusy(null);
    }
  }

  const statusText = disabled
    ? t('binaryAnalysisPanel.unavailableInDemo')
    : loading || busy === 'check'
      ? t('binaryAnalysisPanel.checkingComponents')
      : status?.state === 'installing'
        ? t('binaryAnalysisPanel.installingComponents')
        : status?.state === 'analyzing'
          ? t('binaryAnalysisPanel.analyzingFile')
          : status?.state === 'error'
            ? t('binaryAnalysisPanel.componentsNeedAttention')
            : status?.installed
              ? t('binaryAnalysisPanel.ready')
              : status
                ? t('binaryAnalysisPanel.notInstalled')
                : t('binaryAnalysisPanel.statusUnavailable');
  const progressText =
    progress?.phase === 'installing'
      ? t('binaryAnalysisPanel.downloadingAndInstallingAnalysisComponents')
      : progress?.phase === 'preparing'
        ? t('binaryAnalysisPanel.preparingTheSelectedFile')
        : progress?.phase === 'complete'
          ? t('binaryAnalysisPanel.programContentExtractedPreparingAiReview')
          : t('binaryAnalysisPanel.extractingProgramContent');
  const progressDetail =
    progress && progress.total > 0
      ? progress.unit === 'bytes'
        ? `${sizeLabel(progress.completed)} / ${sizeLabel(progress.total)}`
        : `${progress.completed} / ${progress.total}`
      : '';
  const shownError = error || (status?.state === 'error' ? (status.error ?? '') : '');
  const downloadBytes = status?.downloadBytes;
  const downloadNote =
    typeof downloadBytes === 'number' && Number.isFinite(downloadBytes) && downloadBytes >= 0
      ? downloadBytes === 0
        ? t('binaryAnalysisPanel.noAdditionalDownloadIsNeeded')
        : t('binaryAnalysisPanel.aboutWillBeDownloaded', { p0: sizeLabel(downloadBytes) })
      : t('binaryAnalysisPanel.analysisComponentsAreDownloadedOnFirstUse');

  return (
    <div className="binary-analysis-panel" aria-busy={loading || busy !== null}>
      <div className="binary-component-status">
        <span
          className={`binary-status ${status?.installed && status.state === 'ready' ? 'is-ready' : ''}`}
          role="status"
        >
          {loading || busy === 'check' || externalBusy ? (
            <RotateCw size={14} className="live-spin" />
          ) : status?.installed && status.state === 'ready' ? (
            <Check size={14} />
          ) : (
            <span className="binary-status-dot" />
          )}
          {statusText}
        </span>
        {!disabled && (
          <button
            type="button"
            className="text-link"
            disabled={loading || busy !== null}
            onClick={() => void checkStatus()}
          >
            <RotateCw size={14} />
            {t('binaryAnalysisPanel.checkComponents')}
          </button>
        )}
      </div>
      {disabled ? (
        <p className="ai-settings-note">{t('binaryAnalysisPanel.useTheFullEditionToConnectYourAiService')}</p>
      ) : (
        <>
          {!status?.installed && !loading && (
            <div className="binary-install-entry">
              <div>
                <strong>{t('binaryAnalysisPanel.installProgramReviewComponents')}</strong>
                <p>
                  {downloadNote}
                  {t('binaryAnalysisPanel.theComponentsExtractProgramContentLocallyBeforeAiReviews')}
                </p>
              </div>
              <button type="button" className="button button-primary" disabled={locked} onClick={() => void install()}>
                {t('binaryAnalysisPanel.installComponents')}
              </button>
            </div>
          )}
          <div className="binary-file-entry">
            {selectedSource ? (
              <div className="binary-selected-file">
                <FileSearch size={19} />
                <span>
                  <strong data-content-original>{fileName(selectedSource)}</strong>
                  <small>
                    {selectedSource.kind === 'local'
                      ? sizeLabel(selectedSource.size)
                      : selectedSource.kind === 'pull'
                        ? t('binaryAnalysisPanel.fromAPullRequest')
                        : t('binaryAnalysisPanel.fromARelease')}
                  </small>
                </span>
              </div>
            ) : (
              <p className="ai-settings-note">
                {t('binaryAnalysisPanel.selectAProgramFileAfterConfirmationItsContentIs')}
              </p>
            )}
            <div className="binary-file-actions">
              {!source && (
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={locked}
                  onClick={() => void chooseFile()}
                >
                  <FolderOpen size={16} />
                  {selectedSource ? t('binaryAnalysisPanel.changeFile') : t('binaryAnalysisPanel.selectLocalFile')}
                </button>
              )}
              {selectedSource && (
                <button
                  ref={aiButton}
                  type="button"
                  className="button button-primary"
                  disabled={locked || !status?.installed}
                  onClick={() => void prepareAiReview()}
                >
                  {busy === 'prepare-ai' ? <RotateCw size={16} className="live-spin" /> : <Sparkles size={16} />}
                  {review ? t('binaryAnalysisPanel.reviewAgain') : t('binaryAnalysisPanel.aiReview')}
                </button>
              )}
            </div>
            {selectedSource && (
              <p className="ai-settings-note">
                {t('binaryAnalysisPanel.theSelectedFileIsReadWithoutRunningTheProgram')}
              </p>
            )}
          </div>
        </>
      )}
      {(progress || aiProgress || busy === 'cancel') && (
        <div className="ai-review-progress binary-analysis-progress" role="status" aria-live="polite">
          <p>
            <RotateCw size={16} className="live-spin" />
            {busy === 'cancel'
              ? t('binaryAnalysisPanel.cancelingReview')
              : aiProgress
                ? progressLabel(aiProgress, t)
                : progressText}
            {progressDetail && <span>{progressDetail}</span>}
          </p>
          {progress && (
            <progress
              value={progress.total > 0 ? progress.completed : undefined}
              max={progress.total > 0 ? progress.total : undefined}
              aria-label={t('binaryAnalysisPanel.analysisProgress')}
            />
          )}
          {aiProgress && (
            <progress
              value={aiProgress.total > 0 ? aiProgress.completed : undefined}
              max={aiProgress.total > 0 ? aiProgress.total : undefined}
              aria-label={t('binaryAnalysisPanel.aiReviewProgress')}
            />
          )}
          {activeRequest.current && (
            <button type="button" className="button button-quiet" onClick={() => void cancel()}>
              {t('binaryAnalysisPanel.cancel')}
            </button>
          )}
        </div>
      )}
      {shownError && (
        <p className="live-error" role="alert">
          <ErrorMessage error={shownError} language={language} />
        </p>
      )}
      <FeedbackNotice message={notice} language={language} onClose={() => setNotice('')} />
      {onOpenSettings && ((aiSettings && (!aiSettings.hasApiKey || !aiSettings.model)) || !status?.installed) && (
        <button type="button" className="text-link" onClick={onOpenSettings}>
          {t('binaryAnalysisPanel.openAiSettings')}
        </button>
      )}
      {review && (
        <section
          className="ai-review-result binary-analysis-result"
          aria-label={t('binaryAnalysisPanel.aiReviewResults')}
        >
          <h3>{t('binaryAnalysisPanel.aiReviewResults')}</h3>
          <div className="ai-review-report" data-content-original>
            <p className="ai-review-summary">{review.summary}</p>
            <div className="ai-findings">
              {review.findings.map((finding, index) => (
                <article className="ai-finding" key={`${finding.address ?? ''}:${index}`}>
                  <div className="ai-finding-heading">
                    <span className={`ai-severity ai-severity-${finding.severity}`}>
                      {finding.severity === 'high'
                        ? t('binaryAnalysisPanel.highPriority')
                        : finding.severity === 'medium'
                          ? t('binaryAnalysisPanel.worthChecking')
                          : t('binaryAnalysisPanel.suggestion')}
                    </span>
                    {finding.address && <code>{finding.address}</code>}
                  </div>
                  <p>{finding.description}</p>
                  {finding.suggestion && <p className="ai-finding-suggestion">{finding.suggestion}</p>}
                </article>
              ))}
            </div>
            {review.findings.length === 0 && (
              <p className="ai-no-findings">{t('binaryAnalysisPanel.thisReviewDidNotReportSpecificIssues')}</p>
            )}
            {review.limitations.length > 0 && (
              <div className="ai-limitations">
                <strong>{t('binaryAnalysisPanel.reviewCoverage')}</strong>
                <ul>
                  {review.limitations.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {analysis && <BinaryAnalysisEvidence analysis={analysis} language={language} />}
        </section>
      )}
      {aiConfirm && aiSettings && selectedSource && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAiConfirm(false);
          }}
        >
          <div
            ref={confirmDialog}
            className="modal ai-consent-modal binary-consent-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={consentTitleId}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setAiConfirm(false);
              }
              if (event.key === 'Tab') {
                const buttons = confirmDialog.current?.querySelectorAll<HTMLButtonElement>('button');
                const first = buttons?.[0];
                const last = buttons?.[buttons.length - 1];
                if (first && last && event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (first && last && !event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label={t('binaryAnalysisPanel.close')}
              onClick={() => setAiConfirm(false)}
            >
              <X size={19} />
            </button>
            <div className="modal-symbol">
              <Sparkles size={25} />
            </div>
            <h2 id={consentTitleId}>{t('binaryAnalysisPanel.useAiToReviewThisProgramFile')}</h2>
            <p>{t('binaryAnalysisPanel.afterConfirmationProgramContentIsExtractedOnThisComputer')}</p>
            <dl className="ai-consent-service">
              <div>
                <dt>{t('binaryAnalysisPanel.serviceAddress')}</dt>
                <dd data-content-original>{aiSettings.baseUrl}</dd>
              </div>
              <div>
                <dt>{t('binaryAnalysisPanel.modelName')}</dt>
                <dd data-content-original>{aiSettings.model}</dd>
              </div>
              <div>
                <dt>{t('binaryAnalysisPanel.file')}</dt>
                <dd data-content-original>{fileName(selectedSource)}</dd>
              </div>
            </dl>
            <p>{t('binaryAnalysisPanel.confirmThatYouWantToShareThisExtractedContent')}</p>
            <div className="modal-actions">
              <button
                data-cancel-binary-ai
                type="button"
                className="button button-quiet"
                onClick={() => setAiConfirm(false)}
              >
                {t('binaryAnalysisPanel.cancel')}
              </button>
              <button type="button" className="button button-primary" onClick={() => void startAiReview()}>
                <Sparkles size={16} />
                {t('binaryAnalysisPanel.agreeAndStartReview')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
