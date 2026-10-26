import { useNoticeState } from '../useNoticeState';
import { FeedbackNotice } from './FeedbackNotice';
import { progressLabel } from '../progressLabel';
import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { formatDateTime } from '../format';
import { SegmentedControl } from './SegmentedControl';
import { createDraftKey } from '../draftStore';
import { useLocalDraft } from '../useLocalDraft';
import { usePageScroll } from '../usePageScroll';
import { PagedContinuation } from './PagedContinuation';
import { DiscussionSearch, useDiscussionSearchState } from './DiscussionSearch';
import { PullChecksPanel } from './PullChecksPanel';
import { PullFileChanges } from './PullFileChanges';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import {
  isEmptyAddedPullFile,
  type GitHubComment,
  type GitHubPullFile,
  type GitHubPullRequest,
  type GitHubRepo,
} from '@easyhub/github';
import type { AiReviewProgress, AiReviewResult, AiSettingsStatus, BinaryAnalysisSettingsStatus } from '@easyhub/types';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  GitPullRequest,
  Plus,
  RotateCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { BinaryAnalysisEvidence } from './BinaryAnalysisPanel';
import { isProgramFileName } from '../../../shared/programFiles';
import {
  PROGRAM_REVIEW_COMPONENT_STATUS_CHANGED_EVENT,
  requestProgramReviewSettings,
  useProgramReviewNotice,
} from '../programReviewNotice';
import { TranslatableContent } from './TranslatableContent';
import type { Language } from '../i18n';
import { usePageHistory } from '../usePageHistory';
import { useNestedNavigation } from '../nestedNavigation';

interface PullReviewSnapshot {
  repository: GitHubRepo;
  pullRequest: GitHubPullRequest;
  files: GitHubPullFile[];
  filesTruncated: boolean;
}

export function PullRequestsPanel({
  repo,
  currentUser,
  language,
  showCreateButton = true,
  refreshKey = 0,
  initialRequest,
  onActivityChanged,
  onDownloadFile,
  onOpenAiSettings,
  onBackChange,
  scrollArea: parentScrollArea,
  downloadBusy = false,
}: {
  repo: GitHubRepo;
  currentUser: string;
  language: Language;
  showCreateButton?: boolean;
  refreshKey?: number;
  initialRequest?: GitHubPullRequest | null;
  onActivityChanged?: () => void;
  onDownloadFile?: (requestNumber: number, path: string, headSha: string) => Promise<void>;
  onOpenAiSettings?: () => void;
  onBackChange?: (back: (() => void) | null, key: string, blocked: boolean) => void;
  scrollArea?: RefObject<HTMLDivElement | null>;
  downloadBusy?: boolean;
}) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [discussionSearch, changeDiscussionSearch] = useDiscussionSearchState(
    currentUser,
    `project:${repo.id}:${repo.full_name}:pr`,
  );
  const searchActive = Boolean(discussionSearch.query);
  const [listState, setListState] = useState<'open' | 'closed' | 'all'>('all');
  const [items, setItems] = useState<GitHubPullRequest[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<GitHubPullRequest | null>(null);
  const replyKey = createDraftKey(currentUser, repo.full_name, 'reply', selected?.number ?? 'none');
  const [reply, setReply, clearReply] = useLocalDraft(replyKey);
  const [replySaving, setReplySaving] = useState(false);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [files, setFiles] = useState<GitHubPullFile[]>([]);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [snapshotRepo, setSnapshotRepo] = useState<GitHubRepo | null>(null);
  const [filesTruncated, setFilesTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceOwner, setSourceOwner] = useState(currentUser);
  const [sourceBranch, setSourceBranch] = useState('');
  const [base, setBase] = useState(repo.default_branch);
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState<'accept' | 'reject' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [notice, setNotice] = useNoticeState(language);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettingsStatus | null>(null);
  const [aiConfirm, setAiConfirm] = useState(false);
  const [aiPreparing, setAiPreparing] = useState(false);
  const [aiCanceling, setAiCanceling] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiReviewProgress | null>(null);
  const [aiReview, setAiReview] = useState<AiReviewResult | null>(null);
  const [aiError, setAiError] = useState('');
  const { noticesEnabled, setNoticesEnabled } = useProgramReviewNotice();
  const [programStatus, setProgramStatus] = useState<{ key: string; status: BinaryAnalysisSettingsStatus } | null>(
    null,
  );
  const programStatusRequest = useRef(0);
  const aiRequestId = useRef<string | null>(null);
  const canceledAiRequestId = useRef<string | null>(null);
  const previousLanguage = useRef(language);
  const viewVersion = useRef(0);
  const reviewVersion = useRef(0);
  const mounted = useRef(false);
  const owner = repo.owner.login;

  const canManage =
    snapshotReady &&
    snapshotRepo !== null &&
    !snapshotRepo.archived &&
    (snapshotRepo.permissions?.admin === true ||
      snapshotRepo.permissions?.push === true ||
      snapshotRepo.owner.login.toLowerCase() === currentUser.toLowerCase());
  const hasRevision = Boolean(selected?.head.sha);
  const hasDecisionRevision = hasRevision && Boolean(selected?.base.ref && selected.base.sha);
  const hasProgramFiles = files.some(
    (file) =>
      file.status !== 'removed' && !file.patch && !isEmptyAddedPullFile(file) && isProgramFileName(file.filename),
  );
  const programSnapshotKey =
    selected && snapshotReady && hasProgramFiles
      ? `${owner}/${repo.name}#${selected.number}:${selected.head.sha}`
      : null;
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
  const markdown = (value: string) => (
    <ReadmeMarkdown
      markdown={value}
      repository={{ owner, name: repo.name, branch: repo.default_branch }}
      onOpenLink={(url) => {
        void easyHub?.openExternalLink(url).catch((cause: unknown) => setError(errorText(cause)));
      }}
    />
  );
  const panelRef = useRef<HTMLElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollArea.current = panelRef.current?.closest<HTMLDivElement>('.main-column') ?? null;
  }, []);
  const rememberPage = usePageScroll(
    `${repo.id}:${selected?.number ?? 'list'}:${listState}:${discussionSearch.query}`,
    parentScrollArea ?? scrollArea,
    () => panelRef.current?.isConnected === true,
  );
  const backChange = useRef(onBackChange);
  backChange.current = onBackChange;
  const requestHistory = usePageHistory(`${repo.id}:${selected?.number ?? 'list'}`, () => {
    setListState(listState);
    changeDiscussionSearch(discussionSearch);
    if (selected) void open(selected);
    else backToList();
  });
  const backInRequests = (): void => {
    if (!decisionBusy) {
      rememberPage();
      requestHistory.back(backToList);
    }
  };
  useNestedNavigation(
    panelRef,
    selected ? backInRequests : null,
    requestHistory.hasForward
      ? () => {
          rememberPage();
          requestHistory.forward();
        }
      : null,
    decisionBusy,
  );
  function backToList(): void {
    if (decisionBusy) return;
    rememberPage();
    viewVersion.current += 1;
    resetReview();
    setSelected(null);
    setError('');
    setBusy(false);
    setNotice('');
  }
  useLayoutEffect(() => {
    onBackChange?.(selected ? backInRequests : null, selected ? String(selected.number) : 'list', decisionBusy);
  });
  useEffect(() => () => backChange.current?.(null, 'list', false), []);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = easyHub?.onAiReviewProgress((value) => {
      if (value.requestId === aiRequestId.current && value.requestId !== canceledAiRequestId.current)
        setAiProgress(value);
    });
    return () => {
      mounted.current = false;
      viewVersion.current += 1;
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

  useEffect(() => {
    let active = true;
    viewVersion.current += 1;
    resetReview();
    setDecision(null);
    setNotice('');
    setSnapshotReady(false);
    setSnapshotRepo(null);
    setFilesTruncated(false);
    setItems([]);
    setSelected(null);
    setComments([]);
    setFiles([]);
    setPage(1);
    setHasMore(false);
    setError('');
    setSourceOwner(currentUser);
    setBase(repo.default_branch);
    setBusy(true);
    void easyHub!
      .github<GitHubPullRequest[]>(
        listState === 'all' ? 'pullRequests' : 'pullRequestsPage',
        owner,
        repo.name,
        ...(listState === 'all' ? [1] : [listState, 1]),
      )
      .then((result) => {
        if (!active) return;
        setItems(result);
        setHasMore(result.length === 100);
        if (initialRequest) void open(initialRequest);
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [owner, repo.name, repo.default_branch, currentUser, refreshKey, initialRequest, listState]);

  async function loadMore(): Promise<void> {
    if (!hasMore || busy) return;
    const generation = viewVersion.current;
    setBusy(true);
    setError('');
    try {
      const next = page + 1;
      const result = await easyHub!.github<GitHubPullRequest[]>(
        listState === 'all' ? 'pullRequests' : 'pullRequestsPage',
        owner,
        repo.name,
        ...(listState === 'all' ? [next] : [listState, next]),
      );
      if (!mounted.current || generation !== viewVersion.current) return;
      setItems((current) => [...current, ...result.filter((item) => !current.some((known) => known.id === item.id))]);
      setPage(next);
      setHasMore(result.length === 100);
    } catch (cause) {
      if (mounted.current && generation === viewVersion.current) setError(errorText(cause));
    } finally {
      if (mounted.current && generation === viewVersion.current) setBusy(false);
    }
  }

  async function open(item: GitHubPullRequest): Promise<void> {
    rememberPage();
    const version = ++viewVersion.current;
    resetReview();
    setDecision(null);
    setNotice('');
    setSnapshotReady(false);
    setSnapshotRepo(null);
    setFilesTruncated(false);
    setSelected(item);
    setComments([]);
    setFiles([]);
    setBusy(true);
    setError('');
    try {
      const detail = await easyHub!.github<GitHubPullRequest>('pullRequest', owner, repo.name, item.number);
      if (version !== viewVersion.current || !mounted.current) return;
      if (!detail.head.sha) throw new Error(t('pullRequestsPanel.theChangeVersionCouldNotBeVerifiedPleaseRefresh'));
      const [context, discussion] = await Promise.all([
        easyHub!.github<PullReviewSnapshot>('pullReviewContext', owner, repo.name, item.number, detail.head.sha),
        easyHub!.github<GitHubComment[]>('comments', owner, repo.name, item.number),
      ]);
      if (version !== viewVersion.current || !mounted.current) return;
      if (
        context.pullRequest.head.sha !== detail.head.sha ||
        context.pullRequest.base.ref !== detail.base.ref ||
        context.pullRequest.base.sha !== detail.base.sha
      )
        throw new Error(t('pullRequestsPanel.theseChangesHaveBeenUpdatedRefreshBeforeDeciding'));
      setSelected(context.pullRequest);
      setComments(discussion);
      setFiles(context.files);
      setSnapshotRepo(context.repository);
      setFilesTruncated(context.filesTruncated);
      setSnapshotReady(true);
      setItems((current) =>
        current.map((known) => (known.id === context.pullRequest.id ? context.pullRequest : known)),
      );
    } catch (cause) {
      if (version === viewVersion.current && mounted.current) setError(errorText(cause));
    } finally {
      if (version === viewVersion.current && mounted.current) setBusy(false);
    }
  }

  async function applyDecision(): Promise<void> {
    if (
      !selected ||
      !decision ||
      !selected.head.sha ||
      !selected.base.sha ||
      !selected.base.ref ||
      !canManage ||
      !snapshotReady ||
      decisionBusy
    )
      return;
    const version = viewVersion.current;
    const action = decision;
    setDecisionBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'accept') {
        const result = await easyHub!.github<{ merged: boolean; sha: string; message: string }>(
          'acceptPullRequest',
          owner,
          repo.name,
          selected.number,
          {
            expectedHeadSha: selected.head.sha,
            expectedBaseRef: selected.base.ref,
            expectedBaseSha: selected.base.sha,
          },
        );
        if (!result.merged) throw new Error(t('pullRequestsPanel.theseChangesCannotBeMergedYetRefreshToSee'));
      } else {
        await easyHub!.github<GitHubPullRequest>('rejectPullRequest', owner, repo.name, selected.number, {
          expectedHeadSha: selected.head.sha,
          expectedBaseRef: selected.base.ref,
          expectedBaseSha: selected.base.sha,
          ...(decisionReason.trim() ? { reason: decisionReason.trim() } : {}),
        });
      }
      if (version !== viewVersion.current || !mounted.current) return;
      setDecision(null);
      setDecisionReason('');
      setSnapshotReady(false);
      const updated = {
        ...selected,
        state: 'closed' as const,
        merged: action === 'accept',
        merged_at: action === 'accept' ? new Date().toISOString() : selected.merged_at,
      };
      setSelected(updated);
      setItems((current) => current.map((known) => (known.id === updated.id ? updated : known)));
      onActivityChanged?.();
      setNotice(
        action === 'accept'
          ? t('pullRequestsPanel.theChangesWereApprovedAndMergedIntoTheProject')
          : t('pullRequestsPanel.thePullRequestWasRejectedAndClosed'),
      );
      try {
        const [context, discussion] = await Promise.all([
          easyHub!.github<PullReviewSnapshot>(
            'pullReviewContext',
            owner,
            repo.name,
            selected.number,
            selected.head.sha,
          ),
          easyHub!.github<GitHubComment[]>('comments', owner, repo.name, selected.number),
        ]);
        if (version !== viewVersion.current || !mounted.current) return;
        setSelected(context.pullRequest);
        setComments(discussion);
        setFiles(context.files);
        setSnapshotRepo(context.repository);
        setFilesTruncated(context.filesTruncated);
        setSnapshotReady(true);
        setItems((current) =>
          current.map((known) => (known.id === context.pullRequest.id ? context.pullRequest : known)),
        );
      } catch {
        if (version === viewVersion.current && mounted.current)
          setError(t('pullRequestsPanel.theActionSucceededButTheLatestContentCouldNot'));
      }
    } catch (cause) {
      if (version === viewVersion.current && mounted.current) {
        setDecision(null);
        setSnapshotReady(false);
        setError(errorText(cause));
      }
    } finally {
      if (mounted.current) setDecisionBusy(false);
    }
  }

  async function download(file: GitHubPullFile): Promise<void> {
    if (
      !onDownloadFile ||
      !selected?.head.sha ||
      !snapshotReady ||
      file.status === 'removed' ||
      downloadingFile ||
      downloadBusy
    )
      return;
    const version = viewVersion.current;
    setDownloadingFile(file.filename);
    setError('');
    try {
      await onDownloadFile(selected.number, file.filename, selected.head.sha);
    } catch (cause) {
      if (mounted.current && version === viewVersion.current) setError(errorText(cause));
    } finally {
      if (mounted.current) setDownloadingFile(null);
    }
  }

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
        repo: repo.name,
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

  async function sendReply(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selected || !reply.trim() || replySaving) return;
    const version = viewVersion.current;
    const sent = reply;
    setReplySaving(true);
    setError('');
    try {
      const comment = await easyHub!.github<GitHubComment>(
        'createComment',
        owner,
        repo.name,
        selected.number,
        sent.trim(),
      );
      clearReply(sent);
      if (mounted.current && version === viewVersion.current) setComments((old) => [...old, comment]);
    } catch (cause) {
      if (mounted.current && version === viewVersion.current) setError(errorText(cause));
    } finally {
      if (mounted.current) setReplySaving(false);
    }
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || !sourceOwner.trim() || !sourceBranch.trim() || !base.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const created = await easyHub!.github<GitHubPullRequest>('createPullRequest', owner, repo.name, {
        title: title.trim(),
        body: body.trim(),
        head: `${sourceOwner.trim()}:${sourceBranch.trim()}`,
        base: base.trim(),
      });
      setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      onActivityChanged?.();
      setShowForm(false);
      setTitle('');
      setBody('');
      setSourceBranch('');
      await open(created);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section ref={panelRef} className="panel public-browser-content pull-requests-panel">
      {selected ? (
        <>
          {!onBackChange && (
            <button className="back-link" disabled={decisionBusy} onClick={backInRequests}>
              <ArrowLeft size={16} />
              {t('pullRequestsPanel.back')}
            </button>
          )}
          <div className="issue-detail public-issue-detail">
            <div className="issue-title">
              <span className={`issue-state ${selected.state === 'closed' ? 'closed' : ''}`}>
                {selected.merged
                  ? t('pullRequestsPanel.merged')
                  : selected.state === 'open'
                    ? selected.draft
                      ? t('pullRequestsPanel.draft')
                      : t('pullRequestsPanel.open')
                    : t('pullRequestsPanel.closed')}
              </span>
              {repo.private ? (
                <h1>{selected.title}</h1>
              ) : (
                <TranslatableContent text={selected.title} format="text" render={(value) => <h1>{value}</h1>} />
              )}
              <p>
                {selected.user?.login || t('pullRequestsPanel.githubUser')} ·{' '}
                {selected.head?.label || selected.head?.ref} → {selected.base?.ref}
              </p>
            </div>
            {busy && (
              <p className="live-loading">
                <RotateCw size={16} className="live-spin" />
                {t('pullRequestsPanel.loadingContent')}
              </p>
            )}
            {error && (
              <p className="live-error" role="alert">
                <ErrorMessage error={error} language={language} />
              </p>
            )}
            <FeedbackNotice message={notice} language={language} onClose={() => setNotice('')} />
            {snapshotReady && selected.head.sha && (
              <PullChecksPanel
                key={`${repo.id}:${selected.number}:${selected.head.sha}`}
                owner={owner}
                repo={repo.name}
                number={selected.number}
                headSha={selected.head.sha}
                language={language}
                onOpenLink={(url) => {
                  void easyHub?.openExternalLink(url).catch((cause: unknown) => setError(errorText(cause)));
                }}
              />
            )}
            {error && (
              <button className="text-link" disabled={busy || decisionBusy} onClick={() => void open(selected)}>
                <RotateCw size={15} />
                {t('pullRequestsPanel.refresh')}
              </button>
            )}
            <div className="pull-files">
              <div className="pull-files-heading">
                <h3>
                  {t('pullRequestsPanel.changedFiles')} {selected.changed_files ?? files.length}
                </h3>
                <button
                  className="button button-quiet"
                  disabled={busy || !snapshotReady || !hasRevision || aiPreparing || aiProgress !== null}
                  onClick={() => void prepareAiReview()}
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
                    <button className="text-link" onClick={() => setNoticesEnabled(false)}>
                      {t('pullRequestsPanel.neverShowThisReminder')}
                    </button>
                  </div>
                </aside>
              )}
              {filesTruncated && (
                <p className="ai-settings-note">
                  {t('pullRequestsPanel.githubReturnedOnlyPartOfThisLargeChangeCheck')}
                </p>
              )}
              {files.map(
                (file) =>
                  selected.head.sha && (
                    <PullFileChanges
                      key={`${selected.head.sha}:${file.filename}`}
                      file={file}
                      owner={owner}
                      repo={repo.name}
                      number={selected.number}
                      headSha={selected.head.sha}
                      language={language}
                      onOpenLink={(url) => {
                        void easyHub?.openExternalLink(url).catch((cause: unknown) => setError(errorText(cause)));
                      }}
                      downloadControl={
                        <button
                          className="button button-quiet small-button"
                          disabled={
                            file.status === 'removed' ||
                            !onDownloadFile ||
                            !snapshotReady ||
                            !hasRevision ||
                            downloadingFile !== null ||
                            downloadBusy
                          }
                          onClick={() => void download(file)}
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
              {!busy && files.length === 0 && (
                <p className="muted">{t('pullRequestsPanel.thereAreNoFileChangesToDisplay')}</p>
              )}
            </div>
            {(aiProgress || aiReview || aiError) && (
              <section className="ai-review-result" aria-label={t('pullRequestsPanel.aiReviewResults')}>
                <div className="pull-files-heading">
                  <h3>
                    <ShieldCheck size={18} />
                    {t('pullRequestsPanel.aiReview')}
                  </h3>
                  {aiProgress && (
                    <button
                      className="button button-quiet small-button"
                      disabled={aiCanceling}
                      onClick={cancelAiReview}
                    >
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
                              {finding.address
                                ? ` @ ${finding.address}`
                                : finding.line !== undefined
                                  ? `:${finding.line}`
                                  : ''}
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
                      <BinaryAnalysisEvidence
                        key={analysis.id}
                        analysis={analysis}
                        fileLabel={file}
                        language={language}
                      />
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
            )}
            <div className="conversation">
              <div className="message">
                <div className="avatar author-avatar">{(selected.user?.login || 'G').slice(0, 1).toUpperCase()}</div>
                <div className="message-box">
                  <div>
                    <strong>{selected.user?.login || t('pullRequestsPanel.githubUser')}</strong>
                    <small>{formatDateTime(selected.created_at, language)}</small>
                  </div>
                  {selected.body ? (
                    repo.private ? (
                      markdown(selected.body)
                    ) : (
                      <TranslatableContent text={selected.body} format="markdown" paragraphMode render={markdown} />
                    )
                  ) : (
                    <p className="muted">{t('pullRequestsPanel.noDetailsProvided')}</p>
                  )}
                </div>
              </div>
              {comments.map((comment) => (
                <div className="message" key={comment.id}>
                  <div className="avatar">{(comment.user?.login || 'G').slice(0, 1).toUpperCase()}</div>
                  <div className="message-box">
                    <div>
                      <strong>{comment.user?.login || t('pullRequestsPanel.githubUser')}</strong>
                      <small>{formatDateTime(comment.created_at, language)}</small>
                    </div>
                    {repo.private ? (
                      markdown(comment.body)
                    ) : (
                      <TranslatableContent text={comment.body} format="markdown" paragraphMode render={markdown} />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {!busy && (
              <PagedContinuation<GitHubComment>
                key={`${replyKey}:${viewVersion.current}`}
                action="commentsPage"
                args={[owner, repo.name, selected.number]}
                firstCount={comments.length}
                language={language}
                label={t('pullRequestsPanel.loadMoreReplies')}
                onItems={(items) =>
                  setComments((old) =>
                    [...old, ...items.filter((item) => !old.some((known) => known.id === item.id))].sort(
                      (a, b) => a.id - b.id,
                    ),
                  )
                }
              />
            )}
            <form className="reply-card" onSubmit={(event) => void sendReply(event)}>
              <label htmlFor="pull-reply">{t('pullRequestsPanel.writeAReply')}</label>
              <textarea
                id="pull-reply"
                rows={4}
                maxLength={65536}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder={t('pullRequestsPanel.shareYourThoughtsOrSuggestions')}
              />
              <div>
                <span />
                <button className="button button-primary" disabled={replySaving || busy || !reply.trim()} type="submit">
                  {t('pullRequestsPanel.sendReply')}
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
            {canManage && selected.state === 'open' && !selected.merged && (
              <div className="pull-review-actions">
                <div>
                  <strong>{t('pullRequestsPanel.reviewTheseChanges')}</strong>
                  <p>
                    {selected.draft
                      ? t('pullRequestsPanel.theAuthorIsStillPreparingTheseChangesTheyCan')
                      : t('pullRequestsPanel.approvalMergesTheChangesIntoYourProjectRejectionCloses')}
                  </p>
                </div>
                <div className="pull-review-buttons">
                  <button
                    className="button button-quiet pull-reject-button"
                    disabled={busy || decisionBusy || !hasDecisionRevision}
                    onClick={() => {
                      setDecisionReason('');
                      setDecision('reject');
                    }}
                  >
                    {t('pullRequestsPanel.reject')}
                  </button>
                  <button
                    className="button button-primary"
                    disabled={busy || decisionBusy || !hasDecisionRevision || selected.draft}
                    onClick={() => setDecision('accept')}
                  >
                    <Check size={16} />
                    {t('pullRequestsPanel.approveAndMerge')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="panel-heading">
            <div>
              <h2>{t('pullRequestsPanel.pullRequestReviews')}</h2>
            </div>
            {showCreateButton && (
              <button
                className="button button-primary"
                onClick={() => {
                  setError('');
                  setShowForm(true);
                }}
              >
                <Plus size={16} />
                {t('pullRequestsPanel.createPullRequest')}
              </button>
            )}
          </div>
          {error && (
            <p className="live-error" role="alert">
              <ErrorMessage error={error} language={language} />
            </p>
          )}
          <DiscussionSearch
            filters={
              <SegmentedControl className="public-issue-filter">
                {(['all', 'open', 'closed'] as const).map((state) => (
                  <button
                    key={state}
                    className={listState === state ? 'selected' : ''}
                    onClick={() => setListState(state)}
                  >
                    {state === 'all'
                      ? t('pullRequestsPanel.all')
                      : state === 'open'
                        ? t('pullRequestsPanel.open')
                        : t('pullRequestsPanel.closed')}
                  </button>
                ))}
              </SegmentedControl>
            }
            repositories={[repo]}
            kind="pr"
            state={listState}
            language={language}
            search={discussionSearch}
            onSearchChange={changeDiscussionSearch}
            onOpen={(item) => {
              const version = viewVersion.current;
              void easyHub!
                .github<GitHubPullRequest>('pullRequest', owner, repo.name, item.number)
                .then((request) => {
                  if (mounted.current && version === viewVersion.current) void open(request);
                })
                .catch((cause: unknown) => setError(errorText(cause)));
            }}
          />
          <div hidden={searchActive}>
            {items.map((item) => (
              <button className="public-list-row" key={item.id} onClick={() => void open(item)}>
                <GitPullRequest size={19} />
                <span>
                  {repo.private ? (
                    <strong>{item.title}</strong>
                  ) : (
                    <TranslatableContent text={item.title} format="text" render={(value) => <strong>{value}</strong>} />
                  )}
                  <small>
                    {item.merged_at
                      ? t('pullRequestsPanel.merged')
                      : item.state === 'open'
                        ? item.draft
                          ? t('pullRequestsPanel.draft')
                          : t('pullRequestsPanel.open')
                        : t('pullRequestsPanel.closed')}{' '}
                    · {item.user?.login || t('pullRequestsPanel.githubUser')}
                  </small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))}
            {!busy && !error && items.length === 0 && (
              <p className="muted">{t('pullRequestsPanel.thisProjectHasNoPullRequestsYet')}</p>
            )}
            {busy && (
              <p className="live-loading">
                <RotateCw size={16} className="live-spin" />
                {t('pullRequestsPanel.loadingPullRequests')}
              </p>
            )}
            {hasMore && (
              <button className="button button-quiet pull-more" disabled={busy} onClick={() => void loadMore()}>
                {t('pullRequestsPanel.loadMore')}
              </button>
            )}
          </div>
        </>
      )}
      {showForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setShowForm(false);
          }}
        >
          <form
            className="modal issue-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-pull-title"
            onSubmit={(event) => void create(event)}
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label={t('pullRequestsPanel.close')}
              disabled={saving}
              onClick={() => setShowForm(false)}
            >
              <X size={19} />
            </button>
            <h2 id="new-pull-title">{t('pullRequestsPanel.createPullRequest')}</h2>
            <p>{t('pullRequestsPanel.saveYourChangesToGithubFirstThenChooseThe')}</p>
            <label className="field">
              <span>{t('pullRequestsPanel.title')}</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={256}
                required
                placeholder={t('pullRequestsPanel.summarizeTheProposedChange')}
              />
            </label>
            <label className="field">
              <span>{t('pullRequestsPanel.details')}</span>
              <textarea
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={65536}
                placeholder={t('pullRequestsPanel.describeWhyAndHowItHelps')}
              />
            </label>
            <div className="pull-source-fields">
              <label className="field">
                <span>{t('pullRequestsPanel.sourceAccount')}</span>
                <input
                  value={sourceOwner}
                  onChange={(event) => setSourceOwner(event.target.value)}
                  required
                  placeholder={t('pullRequestsPanel.githubUsername')}
                />
              </label>
              <label className="field">
                <span>{t('pullRequestsPanel.sourceVersion')}</span>
                <input
                  value={sourceBranch}
                  onChange={(event) => setSourceBranch(event.target.value)}
                  required
                  placeholder={t('pullRequestsPanel.forExampleFixSearch')}
                />
              </label>
            </div>
            <label className="field">
              <span>{t('pullRequestsPanel.mergeInto')}</span>
              <input
                value={base}
                onChange={(event) => setBase(event.target.value)}
                required
                placeholder={repo.default_branch}
              />
            </label>
            <p className="muted">{t('pullRequestsPanel.theSourceMustAlreadyExistOnGithubForSomeone')}</p>
            {error && (
              <p className="live-error" role="alert">
                <ErrorMessage error={error} language={language} />
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                disabled={saving}
                onClick={() => setShowForm(false)}
              >
                {t('pullRequestsPanel.cancel')}
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={saving || !title.trim() || !sourceBranch.trim()}
              >
                {t('pullRequestsPanel.createPullRequest2')}
              </button>
            </div>
          </form>
        </div>
      )}
      {decision && selected && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !decisionBusy) setDecision(null);
          }}
        >
          <form
            className="modal pull-decision-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pull-decision-title"
            onSubmit={(event) => {
              event.preventDefault();
              void applyDecision();
            }}
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label={t('pullRequestsPanel.close')}
              disabled={decisionBusy}
              onClick={() => setDecision(null)}
            >
              <X size={19} />
            </button>
            <h2 id="pull-decision-title">
              {decision === 'accept'
                ? t('pullRequestsPanel.approveAndMergeTheseChanges')
                : t('pullRequestsPanel.rejectAndCloseThisRequest')}
            </h2>
            <p className="pull-confirm-title" data-content-original>
              {selected.title}
            </p>
            <dl className="ai-consent-service">
              <div>
                <dt>{t('pullRequestsPanel.targetVersion')}</dt>
                <dd data-content-original>
                  {repo.full_name} / {selected.base.ref}
                </dd>
              </div>
            </dl>
            <p>
              {decision === 'accept'
                ? t('pullRequestsPanel.theseChangesWillBeSavedToYourProjectOn')
                : t('pullRequestsPanel.thisPullRequestWillBeClosedAnyReasonYou')}
            </p>
            {decision === 'reject' && (
              <label className="field">
                <span>{t('pullRequestsPanel.reasonForRejectionOptional')}</span>
                <textarea
                  rows={4}
                  maxLength={65536}
                  value={decisionReason}
                  onChange={(event) => setDecisionReason(event.target.value)}
                  disabled={decisionBusy}
                  placeholder={t('pullRequestsPanel.explainWhyYouAreNotAcceptingTheseChanges')}
                />
              </label>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                disabled={decisionBusy}
                onClick={() => setDecision(null)}
              >
                {t('pullRequestsPanel.cancel')}
              </button>
              <button
                type="submit"
                className={`button ${decision === 'accept' ? 'button-primary' : 'danger-confirm'}`}
                disabled={decisionBusy}
              >
                {decisionBusy && <RotateCw size={16} className="live-spin" />}
                {decision === 'accept'
                  ? t('pullRequestsPanel.confirmApprovalAndMerge')
                  : t('pullRequestsPanel.confirmRejectionAndClose')}
              </button>
            </div>
          </form>
        </div>
      )}
      {aiConfirm && aiSettings && selected && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAiConfirm(false);
          }}
        >
          <div className="modal ai-consent-modal" role="dialog" aria-modal="true" aria-labelledby="ai-consent-title">
            <button
              type="button"
              className="icon-button modal-close"
              aria-label={t('pullRequestsPanel.close')}
              onClick={() => setAiConfirm(false)}
            >
              <X size={19} />
            </button>
            <div className="modal-symbol">
              <Sparkles size={25} />
            </div>
            <h2 id="ai-consent-title">{t('pullRequestsPanel.useAiToReviewTheseChanges')}</h2>
            <p>{t('pullRequestsPanel.theTitleDescriptionFileNamesAndChangesWillBe')}</p>
            {hasProgramFiles && (
              <p>
                {programComponentsMissing
                  ? t('pullRequestsPanel.programFilesCannotBeReviewedYetAvailableSourceChanges')
                  : t('pullRequestsPanel.programContentIsExtractedLocallyAndIncludedInThis')}
              </p>
            )}
            <dl className="ai-consent-service">
              <div>
                <dt>{t('pullRequestsPanel.serviceAddress')}</dt>
                <dd data-content-original>{aiSettings.baseUrl}</dd>
              </div>
              <div>
                <dt>{t('pullRequestsPanel.modelName')}</dt>
                <dd data-content-original>{aiSettings.model}</dd>
              </div>
              <div>
                <dt>{t('pullRequestsPanel.project')}</dt>
                <dd data-content-original>{repo.full_name}</dd>
              </div>
            </dl>
            {repo.private && (
              <p className="ai-private-notice">{t('pullRequestsPanel.thisProjectIsPrivateConfirmThatYouWantTo')}</p>
            )}
            <p>{t('pullRequestsPanel.yourProviderMayChargeForThisRequestTheReview')}</p>
            <div className="modal-actions">
              <button className="button button-quiet" onClick={() => setAiConfirm(false)}>
                {t('pullRequestsPanel.cancel')}
              </button>
              <button className="button button-primary" onClick={() => void startAiReview()}>
                <Sparkles size={16} />
                {t('pullRequestsPanel.agreeAndStartReview')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
