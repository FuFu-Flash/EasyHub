import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { isEmptyAddedPullFile, type GitHubPullFile, type GitHubPullRequest } from '@easyhub/github';
import type { AiReviewProgress, AiReviewResult, AiSettingsStatus, BinaryAnalysisSettingsStatus } from '@easyhub/types';
import { useEasyHub } from '../bridge';
import { errorText } from '../errors';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { PROGRAM_REVIEW_COMPONENT_STATUS_CHANGED_EVENT } from '../programReviewNotice';

export type ProgramStatusSnapshot = { key: string; status: BinaryAnalysisSettingsStatus };

/** Tracks whether the local program review components are ready for the request snapshot in view. */
export function usePullProgramStatus(programSnapshotKey: string | null) {
  const easyHub = useEasyHub();
  const [programStatus, setProgramStatus] = useState<ProgramStatusSnapshot | null>(null);
  const programStatusRequest = useRef(0);
  const currentProgramStatus = programStatus?.key === programSnapshotKey ? programStatus?.status : null;
  const programComponentsMissing =
    currentProgramStatus?.installed === false &&
    currentProgramStatus.state !== 'installing' &&
    currentProgramStatus.state !== 'analyzing';
  useEffect(() => {
    let active = true;
    setProgramStatus(null);
    if (!programSnapshotKey) return;
    const refreshStatus = async (): Promise<void> => {
      const request = ++programStatusRequest.current;
      try {
        const status = await easyHub!.binaryAnalysisStatus();
        if (active && request === programStatusRequest.current) setProgramStatus({ key: programSnapshotKey, status });
      } catch {
        if (active && request === programStatusRequest.current) setProgramStatus(null);
      }
    };
    const refresh = (): void => {
      void refreshStatus();
    };
    refresh();
    window.addEventListener(PROGRAM_REVIEW_COMPONENT_STATUS_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener(PROGRAM_REVIEW_COMPONENT_STATUS_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [programSnapshotKey]);
  return { currentProgramStatus, programComponentsMissing, programStatusRequest, setProgramStatus };
}

/** AI review of one pull request snapshot: consent, progress, cancellation and the result. */
export function usePullAiReview({
  owner,
  repoName,
  language,
  selected,
  snapshotReady,
  files,
  filesTruncated,
  hasProgramFiles,
  busy,
  programSnapshotKey,
  programStatusRequest,
  setProgramStatus,
  viewVersion,
  mounted,
  setNotice,
}: {
  owner: string;
  repoName: string;
  language: Language;
  selected: GitHubPullRequest | null;
  snapshotReady: boolean;
  files: GitHubPullFile[];
  filesTruncated: boolean;
  hasProgramFiles: boolean;
  busy: boolean;
  programSnapshotKey: string | null;
  programStatusRequest: MutableRefObject<number>;
  setProgramStatus: (value: ProgramStatusSnapshot | null) => void;
  viewVersion: MutableRefObject<number>;
  mounted: MutableRefObject<boolean>;
  setNotice: (message: string) => void;
}) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [aiSettings, setAiSettings] = useState<AiSettingsStatus | null>(null);
  const [aiConfirm, setAiConfirm] = useState(false);
  const [aiPreparing, setAiPreparing] = useState(false);
  const [aiCanceling, setAiCanceling] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiReviewProgress | null>(null);
  const [aiReview, setAiReview] = useState<AiReviewResult | null>(null);
  const [aiError, setAiError] = useState('');
  const aiRequestId = useRef<string | null>(null);
  const canceledAiRequestId = useRef<string | null>(null);
  const previousLanguage = useRef(language);
  const reviewVersion = useRef(0);

  useEffect(() => {
    const unsubscribe = easyHub?.onAiReviewProgress((value) => {
      if (value.requestId === aiRequestId.current && value.requestId !== canceledAiRequestId.current)
        setAiProgress(value);
    });
    return () => {
      unsubscribe?.();
      if (aiRequestId.current) void easyHub?.aiCancelReview(aiRequestId.current).catch(() => undefined);
      aiRequestId.current = null;
    };
  }, []);

  function resetReview(): void {
    reviewVersion.current += 1;
    const requestId = aiRequestId.current;
    if (requestId) {
      canceledAiRequestId.current = requestId;
      setAiCanceling(true);
      void easyHub?.aiCancelReview(requestId).catch(() => undefined);
    } else {
      setAiProgress(null);
      setAiCanceling(false);
      canceledAiRequestId.current = null;
    }
    setAiReview(null);
    setAiError('');
    setAiConfirm(false);
    setAiPreparing(false);
  }

  useEffect(() => {
    if (previousLanguage.current === language) return;
    previousLanguage.current = language;
    resetReview();
  }, [language]);

  async function prepareAiReview(): Promise<void> {
    if (!selected?.head.sha || !snapshotReady || aiRequestId.current || aiPreparing || busy) return;
    if (!filesTruncated && !hasProgramFiles && files.length > 0 && files.every((file) => !file.patch)) {
      const empty = files.filter(isEmptyAddedPullFile);
      const summary =
        empty.length === 1 && files.length === 1
          ? t('pullRequestsPanel.isANewlyAddedEmptyFileThereIsNo', { p0: empty[0]!.filename })
          : t('pullRequestsPanel.theseFilesHaveNoTextChangesAvailableForAi');
      setAiError('');
      setAiReview({
        headSha: selected.head.sha,
        summary,
        findings: [],
        limitations: [t('pullRequestsPanel.fileContentsWereNotReviewed')],
        reviewedFiles: 0,
        totalFiles: selected.changed_files ?? files.length,
      });
      return;
    }
    const version = viewVersion.current;
    const reviewGeneration = reviewVersion.current;
    setAiPreparing(true);
    setAiError('');
    try {
      const statusRequest = ++programStatusRequest.current;
      const [settings, status] = await Promise.all([
        easyHub!.aiSettings(),
        programSnapshotKey ? easyHub!.binaryAnalysisStatus().catch(() => null) : Promise.resolve(null),
      ]);
      if (!mounted.current || version !== viewVersion.current || reviewGeneration !== reviewVersion.current) return;
      if (statusRequest === programStatusRequest.current)
        setProgramStatus(status && programSnapshotKey ? { key: programSnapshotKey, status } : null);
      setAiSettings(settings);
      if (!settings.hasApiKey || !settings.model)
        setAiError(t('pullRequestsPanel.connectYourAiServiceInSettingsFirst'));
      else setAiConfirm(true);
    } catch (cause) {
      if (mounted.current && version === viewVersion.current && reviewGeneration === reviewVersion.current)
        setAiError(errorText(cause));
    } finally {
      if (mounted.current && version === viewVersion.current && reviewGeneration === reviewVersion.current)
        setAiPreparing(false);
    }
  }

  async function startAiReview(): Promise<void> {
    if (!selected?.head.sha || !snapshotReady || !aiSettings || !aiConfirm || aiRequestId.current) return;
    const requestId = crypto.randomUUID();
    const version = viewVersion.current;
    const reviewGeneration = reviewVersion.current;
    aiRequestId.current = requestId;
    canceledAiRequestId.current = null;
    setAiCanceling(false);
    setAiConfirm(false);
    setAiError('');
    setAiReview(null);
    setAiProgress({ requestId, phase: t('pullRequestsPanel.preparingReview'), completed: 0, total: 0 });
    try {
      const result = await easyHub!.aiReviewPull({
        owner,
        repo: repoName,
        number: selected.number,
        headSha: selected.head.sha,
        requestId,
        consentToSend: true,
        providerBaseUrl: aiSettings.baseUrl,
        language,
      });
      if (
        !mounted.current ||
        version !== viewVersion.current ||
        reviewGeneration !== reviewVersion.current ||
        aiRequestId.current !== requestId ||
        canceledAiRequestId.current === requestId
      )
        return;
      if (result.headSha !== selected.head.sha)
        throw new Error(t('pullRequestsPanel.theChangesHaveBeenUpdatedRefreshAndReviewThem'));
      setAiReview(result);
    } catch (cause) {
      if (
        mounted.current &&
        version === viewVersion.current &&
        reviewGeneration === reviewVersion.current &&
        aiRequestId.current === requestId &&
        canceledAiRequestId.current !== requestId
      )
        setAiError(errorText(cause));
    } finally {
      if (mounted.current && aiRequestId.current === requestId) {
        if (
          version === viewVersion.current &&
          reviewGeneration === reviewVersion.current &&
          canceledAiRequestId.current === requestId
        )
          setNotice(t('pullRequestsPanel.reviewCanceled'));
        aiRequestId.current = null;
        canceledAiRequestId.current = null;
        setAiProgress(null);
        setAiCanceling(false);
      }
    }
  }

  function cancelAiReview(): void {
    const requestId = aiRequestId.current;
    if (!requestId || aiCanceling) return;
    canceledAiRequestId.current = requestId;
    setAiCanceling(true);
    void easyHub!.aiCancelReview(requestId).catch((cause) => {
      if (mounted.current && aiRequestId.current === requestId) {
        canceledAiRequestId.current = null;
        setAiCanceling(false);
        setAiError(errorText(cause));
      }
    });
  }

  return {
    aiSettings,
    aiConfirm,
    setAiConfirm,
    aiPreparing,
    aiCanceling,
    aiProgress,
    aiReview,
    aiError,
    resetReview,
    prepareAiReview,
    startAiReview,
    cancelAiReview,
  };
}
