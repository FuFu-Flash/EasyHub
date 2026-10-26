import { useNoticeState } from '../useNoticeState';
import { FeedbackNotice } from './FeedbackNotice';
import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { createDraftKey } from '../draftStore';
import { useLocalDraft } from '../useLocalDraft';
import { usePageScroll } from '../usePageScroll';
import { useDiscussionSearchState } from './DiscussionSearch';
import { PullChecksPanel } from './PullChecksPanel';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import {
  isEmptyAddedPullFile,
  type GitHubComment,
  type GitHubIssue,
  type GitHubPullFile,
  type GitHubPullRequest,
  type GitHubRepo,
} from '@easyhub/github';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { isProgramFileName } from '../../../shared/programFiles';
import { useProgramReviewNotice } from '../programReviewNotice';
import { TranslatableContent } from './TranslatableContent';
import type { Language } from '../i18n';
import { usePageHistory } from '../usePageHistory';
import { useNestedNavigation } from '../nestedNavigation';
import { usePullAiReview, usePullProgramStatus } from './usePullAiReview';
import { PullRequestList, type PullListState } from './PullRequestList';
import { PullRequestFiles } from './PullRequestFiles';
import { PullAiReviewResult } from './PullAiReviewResult';
import { PullRequestConversation } from './PullRequestConversation';
import {
  CreatePullRequestDialog,
  PullAiConsentDialog,
  PullDecisionDialog,
  PullReviewActions,
  type PullDecision,
  type PullRequestDraft,
} from './PullRequestDialogs';

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
  const [listState, setListState] = useState<PullListState>('all');
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
  const [draft, setDraft] = useState<PullRequestDraft>({
    title: '',
    body: '',
    sourceOwner: currentUser,
    sourceBranch: '',
    base: repo.default_branch,
  });
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState<PullDecision | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [notice, setNotice] = useNoticeState(language);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const { noticesEnabled, setNoticesEnabled } = useProgramReviewNotice();
  const viewVersion = useRef(0);
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
  const { currentProgramStatus, programComponentsMissing, programStatusRequest, setProgramStatus } =
    usePullProgramStatus(programSnapshotKey);
  const {
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
  } = usePullAiReview({
    owner,
    repoName: repo.name,
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
  });
  const openLink = (url: string): void => {
    void easyHub?.openExternalLink(url).catch((cause: unknown) => setError(errorText(cause)));
  };
  const markdown = (value: string) => (
    <ReadmeMarkdown
      markdown={value}
      repository={{ owner, name: repo.name, branch: repo.default_branch }}
      onOpenLink={openLink}
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
    return () => {
      mounted.current = false;
      viewVersion.current += 1;
    };
  }, []);

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
    setDraft((current) => ({ ...current, sourceOwner: currentUser, base: repo.default_branch }));
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

  function openSearchResult(item: GitHubIssue): void {
    const version = viewVersion.current;
    void easyHub!
      .github<GitHubPullRequest>('pullRequest', owner, repo.name, item.number)
      .then((request) => {
        if (mounted.current && version === viewVersion.current) void open(request);
      })
      .catch((cause: unknown) => setError(errorText(cause)));
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
    const { title, body, sourceOwner, sourceBranch, base } = draft;
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
      setDraft((current) => ({ ...current, title: '', body: '', sourceBranch: '' }));
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
                onOpenLink={openLink}
              />
            )}
            {error && (
              <button className="text-link" disabled={busy || decisionBusy} onClick={() => void open(selected)}>
                <RotateCw size={15} />
                {t('pullRequestsPanel.refresh')}
              </button>
            )}
            <PullRequestFiles
              owner={owner}
              repoName={repo.name}
              language={language}
              selected={selected}
              files={files}
              filesTruncated={filesTruncated}
              busy={busy}
              snapshotReady={snapshotReady}
              hasRevision={hasRevision}
              aiPreparing={aiPreparing}
              aiRunning={aiProgress !== null}
              onPrepareAiReview={() => void prepareAiReview()}
              noticesEnabled={noticesEnabled}
              onDisableNotices={() => setNoticesEnabled(false)}
              programComponentsMissing={programComponentsMissing}
              currentProgramStatus={currentProgramStatus}
              onOpenAiSettings={onOpenAiSettings}
              onOpenLink={openLink}
              canDownload={Boolean(onDownloadFile)}
              downloadingFile={downloadingFile}
              downloadBusy={downloadBusy}
              onDownload={(file) => void download(file)}
            />
            {(aiProgress || aiReview || aiError) && (
              <PullAiReviewResult
                language={language}
                aiSettings={aiSettings}
                aiProgress={aiProgress}
                aiReview={aiReview}
                aiError={aiError}
                aiCanceling={aiCanceling}
                hasProgramFiles={hasProgramFiles}
                onCancel={cancelAiReview}
                onOpenAiSettings={onOpenAiSettings}
              />
            )}
            <PullRequestConversation
              repo={repo}
              language={language}
              selected={selected}
              comments={comments}
              busy={busy}
              pagingKey={`${replyKey}:${viewVersion.current}`}
              renderMarkdown={markdown}
              onMoreComments={(items) =>
                setComments((old) =>
                  [...old, ...items.filter((item) => !old.some((known) => known.id === item.id))].sort(
                    (a, b) => a.id - b.id,
                  ),
                )
              }
              reply={reply}
              onReplyChange={setReply}
              replySaving={replySaving}
              onSendReply={(event) => void sendReply(event)}
            />
            {canManage && selected.state === 'open' && !selected.merged && (
              <PullReviewActions
                language={language}
                selected={selected}
                disabled={busy || decisionBusy}
                hasDecisionRevision={hasDecisionRevision}
                onDecide={(next) => {
                  if (next === 'reject') setDecisionReason('');
                  setDecision(next);
                }}
              />
            )}
          </div>
        </>
      ) : (
        <PullRequestList
          repo={repo}
          language={language}
          showCreateButton={showCreateButton}
          error={error}
          listState={listState}
          onListStateChange={setListState}
          search={discussionSearch}
          onSearchChange={changeDiscussionSearch}
          items={items}
          busy={busy}
          hasMore={hasMore}
          onCreate={() => {
            setError('');
            setShowForm(true);
          }}
          onOpen={(item) => void open(item)}
          onOpenSearchResult={openSearchResult}
          onLoadMore={() => void loadMore()}
        />
      )}
      {showForm && (
        <CreatePullRequestDialog
          repo={repo}
          language={language}
          draft={draft}
          onDraftChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          saving={saving}
          error={error}
          onClose={() => setShowForm(false)}
          onSubmit={(event) => void create(event)}
        />
      )}
      {decision && selected && (
        <PullDecisionDialog
          repo={repo}
          language={language}
          selected={selected}
          decision={decision}
          reason={decisionReason}
          onReasonChange={setDecisionReason}
          busy={decisionBusy}
          onClose={() => setDecision(null)}
          onConfirm={() => void applyDecision()}
        />
      )}
      {aiConfirm && aiSettings && selected && (
        <PullAiConsentDialog
          repo={repo}
          language={language}
          aiSettings={aiSettings}
          hasProgramFiles={hasProgramFiles}
          programComponentsMissing={programComponentsMissing}
          onClose={() => setAiConfirm(false)}
          onStart={() => void startAiReview()}
        />
      )}
    </section>
  );
}
