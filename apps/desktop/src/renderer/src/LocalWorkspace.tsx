import { useNoticeState } from './useNoticeState';
import { FeedbackNotice } from './components/FeedbackNotice';
import { progressLabel } from './progressLabel';
import { useTranslation, useLanguage } from './localization';
import { DemoModeContext, useEasyHub } from './bridge';
import { ErrorMessage } from './components/ErrorMessage';
import { errorText, readAppError } from './errors';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import type {
  ChangedFile,
  FolderInspection,
  LocalOperationProgress,
  LocalProjectLink,
  LocalProjectStatus,
  LocalPublishSelection,
  SyncDecision,
  SyncPreview,
} from '@easyhub/types';
import { ArrowDownToLine, FileDiff, ArrowLeft, Download, FolderOpen, RotateCw, Send } from 'lucide-react';
import { LocalBranchBar } from './components/LocalBranchBar';
import { LocalChangeSelector } from './components/LocalChangeSelector';
import { LocalCreateForm } from './components/LocalCreateForm';
import { LocalSyncReview } from './components/LocalSyncReview';
import {
  LocalCloudProjects,
  LocalFolderError,
  LocalIntroduction,
  LocalPublishForm,
} from './components/LocalProjectParts';
import { LocalRemoveDialog, LocalSensitiveConfirmDialog } from './components/LocalWorkspaceDialogs';

import { useDialogFocus } from './components/useDialogFocus';
import { PageActivityContext } from './components/NavigationPages';

interface Props {
  mode: 'list' | 'create';
  repos: GitHubRepo[];
  selectedRepo: GitHubRepo | null;
  initialLocalId?: string | null;
  initialPublish?: boolean;
  onBack: () => void;
  onCreated: (repo?: GitHubRepo) => Promise<void>;
  onCreatedLocal?: (link: LocalProjectLink) => void;
  onDownloadProject: (repo: GitHubRepo) => Promise<void>;
  downloadBusy: boolean;
  initialSyncReview?: { id: string; preview: SyncPreview; message: string } | null;
  onSyncReviewOpened?: () => void;
}

export function LocalWorkspace({
  mode,
  repos,
  selectedRepo,
  initialLocalId,
  initialPublish = false,
  onBack,
  onCreated,
  onCreatedLocal,
  onDownloadProject,
  downloadBusy,
  initialSyncReview,
  onSyncReviewOpened,
}: Props) {
  const language = useLanguage();
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const demoMode = useContext(DemoModeContext);
  const [links, setLinks] = useState<LocalProjectLink[]>([]);
  const [linksReady, setLinksReady] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, LocalProjectStatus>>({});
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const refreshEpoch = useRef(0);
  const actionLock = useRef(false);
  const [removeTarget, setRemoveTarget] = useState<LocalProjectLink | null>(null);
  const removeDialog = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [introductions, setIntroductions] = useState<Record<string, { content: string; error: string }>>({});
  const [introductionRefresh, setIntroductionRefresh] = useState(0);
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const lastAutomaticName = useRef('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [publishId, setPublishId] = useState<string | null>(initialPublish ? (initialLocalId ?? null) : null);
  const [expandedRepoId, setExpandedRepoId] = useState<number | null>(selectedRepo?.id ?? null);
  const [syncReview, setSyncReview] = useState<{ id: string; preview: SyncPreview } | null>(null);
  const [syncChoices, setSyncChoices] = useState<Record<string, SyncDecision['choice']>>({});
  const [showDifferences, setShowDifferences] = useState<Record<string, boolean>>({});
  const [publishAfterSync, setPublishAfterSync] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState('');
  const [selections, setSelections] = useState<Record<string, LocalPublishSelection | null>>({});
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [sensitiveSelections, setSensitiveSelections] = useState<Record<string, ChangedFile[]>>({});
  const [sensitiveConfirm, setSensitiveConfirm] = useState<{
    item: LocalProjectLink;
    selection: LocalPublishSelection;
    message: string;
  } | null>(null);
  const confirmDialog = useRef<HTMLDivElement>(null);
  const publishInput = useRef<HTMLInputElement>(null);
  const focusedPublish = useRef<string | null>(null);
  const onSelection = useCallback(
    (id: string, selection: LocalPublishSelection | null, hasPending = false, sensitiveFiles: ChangedFile[] = []) => {
      setSelections((old) => ({ ...old, [id]: selection }));
      setPending((old) => ({ ...old, [id]: hasPending }));
      setSensitiveSelections((old) => ({ ...old, [id]: sensitiveFiles }));
    },
    [],
  );
  useDialogFocus(Boolean(sensitiveConfirm), confirmDialog, () => setSensitiveConfirm(null));
  useDialogFocus(
    Boolean(removeTarget),
    removeDialog,
    () => {
      if (!actionLock.current) setRemoveTarget(null);
    },
    { fallbackFocus: () => title.current },
  );

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LocalOperationProgress | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useNoticeState(language);
  const api = easyHub;
  const pageActive = useContext(PageActivityContext);
  const effectiveMode = createdId ? 'list' : mode;
  const activeLocalId = initialLocalId ?? createdId;
  const visibleLinks = useMemo(
    () =>
      effectiveMode === 'create'
        ? []
        : activeLocalId
          ? links.filter((item) => item.id === activeLocalId)
          : selectedRepo
            ? links.filter((item) => item.repositoryId === selectedRepo.id)
            : links,
    [effectiveMode, activeLocalId, links, selectedRepo],
  );
  const selectedLink = activeLocalId ? visibleLinks[0] : null;
  const singleProject = Boolean(activeLocalId || selectedRepo || effectiveMode === 'create');
  useEffect(() => {
    if (!publishId) {
      focusedPublish.current = null;
      return;
    }
    if (!statuses[publishId] || focusedPublish.current === publishId) return;
    const frame = requestAnimationFrame(() => {
      const input = publishInput.current;
      if (!input) return;
      focusedPublish.current = publishId;
      input.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
      input.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [publishId, statuses]);

  const refresh = useCallback(async () => {
    if (!api) return;
    const epoch = ++refreshEpoch.current;
    const items = await api.localList();
    if (epoch !== refreshEpoch.current) return;
    setLinks(items);
    setLinksReady(true);
    await Promise.allSettled(
      items.map(async (item) => {
        try {
          const status = await api.localStatus(item.id);
          if (epoch !== refreshEpoch.current) return;
          setStatuses((old) => ({ ...old, [item.id]: status }));
          setStatusErrors((old) => {
            const next = { ...old };
            delete next[item.id];
            return next;
          });
        } catch (cause) {
          if (epoch !== refreshEpoch.current) return;
          setStatusErrors((old) => ({ ...old, [item.id]: errorText(cause) }));
          setStatuses((old) => {
            const next = { ...old };
            delete next[item.id];
            return next;
          });
        }
      }),
    );
  }, [api]);

  useEffect(() => {
    if (!pageActive) return;
    const check = (): void => {
      if (!actionLock.current) void refresh().catch((cause) => setError(errorText(cause)));
    };
    check();
    window.addEventListener('focus', check);
    return () => {
      refreshEpoch.current += 1;
      window.removeEventListener('focus', check);
    };
  }, [pageActive, refresh]);
  useEffect(() => {
    if (!api || effectiveMode === 'create') return;
    let active = true;
    setIntroductions({});
    for (const item of visibleLinks) {
      void api
        .localReadIntroduction(item.id)
        .then((content) => {
          if (active) setIntroductions((old) => ({ ...old, [item.id]: { content, error: '' } }));
        })
        .catch((cause: unknown) => {
          if (active) setIntroductions((old) => ({ ...old, [item.id]: { content: '', error: errorText(cause) } }));
        });
    }
    return () => {
      active = false;
    };
  }, [api, effectiveMode, visibleLinks, introductionRefresh]);
  useEffect(() => {
    if (!initialSyncReview) return;
    setSyncReview({ id: initialSyncReview.id, preview: initialSyncReview.preview });
    setPublishAfterSync(initialSyncReview.message ? initialSyncReview.id : null);
    setPublishId(initialSyncReview.message ? initialSyncReview.id : null);
    setUpdateMessage(initialSyncReview.message);
    onSyncReviewOpened?.();
  }, [initialSyncReview, onSyncReviewOpened]);
  useEffect(() => {
    const stopProgress = api?.onLocalProgress(setProgress);
    const stopStatus = api?.onLocalStatus(({ id, status }) => setStatuses((old) => ({ ...old, [id]: status })));
    return () => {
      stopProgress?.();
      stopStatus?.();
    };
  }, [api]);

  async function task(work: () => Promise<void>): Promise<void> {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setProgress(null);
    try {
      await work();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      actionLock.current = false;
      setBusy(false);
      setProgress(null);
    }
  }

  async function relocate(item: LocalProjectLink): Promise<void> {
    if (!api) return;
    await task(async () => {
      const path = await api.chooseFolder();
      if (!path) return;
      await api.localRelocate(item.id, path);
      setPublishId(null);
      setSyncReview(null);
      setSelections((old) => ({ ...old, [item.id]: null }));
      setPreviewRefresh((value) => value + 1);
      setIntroductionRefresh((value) => value + 1);
      await refresh();
      await onCreated();
      setNotice(t('localWorkspace.localLocationUpdatedReviewTheFileChangesAgain'));
    });
  }

  async function remove(item: LocalProjectLink): Promise<void> {
    if (!api) return;
    await task(async () => {
      await api.localRemove(item.id);
      setRemoveTarget(null);
      setPublishId(null);
      setSyncReview(null);
      await refresh();
      await onCreated();
      setNotice(t('localWorkspace.removedFromThisComputerSProjectListYourFiles'));
    });
  }

  async function chooseFolder(): Promise<void> {
    if (!api) return;
    await task(async () => {
      const path = await api.chooseFolder();
      if (!path) return;
      const result = await api.localInspect(path);
      setInspection(result);
      if (!name.trim() || name === lastAutomaticName.current) {
        const suggestedName = result.name ?? path.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
        lastAutomaticName.current = suggestedName;
        setName(suggestedName);
      }
      if (result.state === 'github') {
        const link = await api.localConnect(path);
        setInspection(null);
        setNotice(t('localWorkspace.addedToMyProjects', { p0: link.name }));
        await refresh();
      }
    });
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!api || !name.trim() || (!inspection && effectiveMode !== 'create')) return;
    await task(async () => {
      if (!inspection) {
        const repo = await api.github<GitHubRepo>('createRepo', name.trim(), description.trim(), isPrivate);
        setName('');
        setDescription('');
        setIsPrivate(true);
        setNotice(t('localWorkspace.cloudProjectCreated'));
        await onCreated(repo);
        return;
      }
      const link = await api.localCreate(inspection.path, name.trim(), description.trim(), isPrivate);
      setInspection(null);
      setName('');
      setDescription('');
      setIsPrivate(true);
      setNotice(t('localWorkspace.projectCreatedReviewAndSelectTheFilesToPublish'));
      if (!onCreatedLocal) {
        setCreatedId(link.id);
        setExpandedRepoId(link.repositoryId);
        setPublishId(link.id);
        setUpdateMessage(t('localWorkspace.createProject'));
      }
      await refresh();
      await onCreated();
      onCreatedLocal?.(link);
    });
  }

  async function download(repo: GitHubRepo): Promise<void> {
    await onDownloadProject(repo);
    try {
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function publish(event: FormEvent, item: LocalProjectLink): Promise<void> {
    event.preventDefault();
    if (!api) return;
    const selection = selections[item.id];
    if (!selection || (!selection.paths.length && !pending[item.id])) {
      setError(t('localWorkspace.reviewAndSelectTheFilesToPublishFirst'));
      return;
    }
    if (sensitiveSelections[item.id]?.length && !pending[item.id]) {
      setSensitiveConfirm({ item, selection, message: updateMessage.trim() });
      return;
    }
    await publishSelection(item, selection, updateMessage.trim());
  }

  async function publishSelection(
    item: LocalProjectLink,
    selection: LocalPublishSelection,
    message: string,
  ): Promise<void> {
    if (!api) return;
    setSensitiveConfirm(null);
    await task(async () => {
      let result: { changed: number };
      try {
        result = await api.localPublish(item.id, message, selection);
      } catch (cause) {
        if (errorText(cause).includes('[SENSITIVE_FILES]')) {
          setExpandedRepoId(item.repositoryId);
          setPublishId(item.id);
          setPreviewRefresh((value) => value + 1);
        }
        throw cause;
      } finally {
        await refresh();
      }
      setPreviewRefresh((value) => value + 1);
      setPublishId(null);
      setUpdateMessage('');
      setNotice(
        demoMode
          ? t('localWorkspace.demoPublicationCompletedChangesToFilesAreSavedOnly', { p0: result.changed })
          : t('localWorkspace.publishedSuccessfullyFilesSavedToGithub', { p0: result.changed }),
      );
      await refresh();
      await onCreated();
    });
  }

  async function changeBranch(
    work: () => Promise<unknown>,
    notice: 'localWorkspace.switchedBranch' | 'localWorkspace.createdBranch',
    name: string,
  ): Promise<void> {
    if (!api) return;
    await task(async () => {
      try {
        await work();
        setNotice(t(notice, { p0: name }));
      } finally {
        setPreviewRefresh((value) => value + 1);
        await refresh();
      }
    });
  }

  async function pushBranch(item: LocalProjectLink): Promise<void> {
    if (!api) return;
    await task(async () => {
      try {
        const result = await api.localPushBranch(item.id);
        setNotice(
          result.state === 'current'
            ? t('localWorkspace.branchAlreadyCurrent', { p0: result.branch })
            : result.state === 'created'
              ? t('localWorkspace.branchCreated', { p0: result.branch })
              : t('localWorkspace.branchPushed', { p0: result.branch }),
        );
      } finally {
        await refresh();
      }
    });
  }

  async function checkLatest(item: LocalProjectLink): Promise<void> {
    if (!api) return;
    await task(async () => {
      const preview = await api.localCheckSync(item.id);
      if (preview.state === 'blocked') {
        setError(preview.message ?? t('localWorkspace.cannotSafelyGetTheLatestChangesRightNow'));
        return;
      }
      if (preview.state === 'current') {
        setNotice(t('localWorkspace.thisProjectIsUpToDate'));
        setSyncReview(null);
        return;
      }
      if (preview.state === 'review') {
        setSyncReview({ id: item.id, preview });
        setSyncChoices({});
        setShowDifferences({});
        setPublishAfterSync(null);
        return;
      }
      const result = await api.localSync(item.id, preview.remoteRevision, []);
      setPreviewRefresh((value) => value + 1);
      setNotice(t('localWorkspace.retrievedTheLatestChangesFromGithubAndUpdatedFiles', { p0: result.updated }));
      await refresh();
    });
  }

  async function confirmSync(item: LocalProjectLink): Promise<void> {
    if (!api || syncReview?.id !== item.id) return;
    const review = syncReview.preview;
    if (review.files.some((file) => !syncChoices[file.path])) {
      setError(t('localWorkspace.chooseAVersionForEachFileFirst'));
      return;
    }
    await task(async () => {
      const decisions = review.files.map((file) => ({ path: file.path, choice: syncChoices[file.path]! }));
      const result = await api.localSync(item.id, review.remoteRevision, decisions);
      setSyncReview(null);
      setSyncChoices({});
      if (publishAfterSync === item.id) {
        setPublishAfterSync(null);
        setNotice(t('localWorkspace.latestContentReceivedReviewAndSelectTheFilesTo'));
      } else setNotice(t('localWorkspace.retrievedTheLatestChangesAndUpdatedFiles', { p0: result.updated }));
      setPreviewRefresh((value) => value + 1);
      await refresh();
    });
  }

  const visibleRepos = selectedRepo
    ? [selectedRepo]
    : selectedLink
      ? repos.filter((repo) => repo.id === selectedLink.repositoryId)
      : repos;
  return (
    <div className="local-workspace">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={17} />
        {t('localWorkspace.back')}
      </button>
      <div className="page-header">
        <div>
          <h1 ref={title} tabIndex={-1}>
            {effectiveMode === 'create'
              ? t('localWorkspace.newProject')
              : (selectedLink?.name ?? selectedRepo?.name ?? t('localWorkspace.localProjects'))}
          </h1>
        </div>
      </div>
      {error && (
        <div className="live-error" role="alert">
          <ErrorMessage error={error} />
        </div>
      )}
      <FeedbackNotice message={notice} language={language} onClose={() => setNotice('')} />
      {busy && (
        <div className="live-loading" role="status">
          <RotateCw size={16} className="live-spin" />
          {progressLabel(progress, t)}
          {progress?.total ? ` ${Math.round((100 * (progress.loaded ?? 0)) / progress.total)}%` : ''}
          {progress?.cancelable !== false && !(effectiveMode === 'create' && !inspection) && (
            <button className="text-link" onClick={() => void api?.localCancel()}>
              {t('localWorkspace.cancel')}
            </button>
          )}
        </div>
      )}
      {effectiveMode === 'list' && !singleProject && (
        <section className="panel live-section">
          <div className="panel-heading">
            <h2>{t('localWorkspace.addExistingFolder')}</h2>
          </div>
          <p>{t('localWorkspace.easyhubWillInspectTheFolderAndAddExistingGithub')}</p>
          <button className="button button-quiet" disabled={busy} onClick={() => void chooseFolder()}>
            <FolderOpen size={17} />
            {t('localWorkspace.chooseFolder')}
          </button>
        </section>
      )}
      {(effectiveMode === 'create' || (inspection && inspection.state !== 'github')) && (
        <LocalCreateForm
          language={language}
          createMode={effectiveMode === 'create'}
          inspection={inspection}
          name={name}
          onNameChange={setName}
          description={description}
          onDescriptionChange={setDescription}
          isPrivate={isPrivate}
          onPrivateChange={setIsPrivate}
          busy={busy}
          onChooseFolder={() => void chooseFolder()}
          onClearFolder={() => setInspection(null)}
          onSubmit={(event) => void create(event)}
        />
      )}
      {effectiveMode === 'list' && activeLocalId && linksReady && visibleLinks.length === 0 && (
        <p className="live-empty">{t('localWorkspace.thisLocalLinkWasRemovedYouCanReturnTo')}</p>
      )}
      {effectiveMode === 'list' && selectedRepo && linksReady && visibleLinks.length === 0 && (
        <section className="panel live-section local-cloud-download">
          <h2>{t('localWorkspace.noLocalFolderYet')}</h2>
          <p>{t('localWorkspace.downloadTheProjectToReviewFilesAndPublishChanges')}</p>
          <button
            className="button button-primary"
            disabled={busy || downloadBusy}
            onClick={() => void download(selectedRepo)}
          >
            <Download size={17} />
            {t('localWorkspace.downloadProjectFromGithub')}
          </button>
        </section>
      )}
      {visibleLinks.map((item) => {
        const status = statuses[item.id];
        const statusError = statusErrors[item.id];
        const missing =
          statusError &&
          (readAppError(statusError).code === 'NOT_FOUND' || /ENOENT|ENOTDIR|找不到这个文件夹/.test(statusError));
        const introduction = introductions[item.id];
        const repo =
          selectedRepo?.id === item.repositoryId
            ? selectedRepo
            : repos.find((candidate) => candidate.id === item.repositoryId);
        return (
          <section className="panel live-section local-project-card" key={item.id}>
            <div className="panel-heading">
              {!singleProject && <h2>{item.name}</h2>}
              <span className="muted">
                {statusError
                  ? t('localWorkspace.checkLocalLocation')
                  : status
                    ? status.files.length
                      ? t('localWorkspace.filesNotPublished', { p0: status.files.length })
                      : status.pendingPublish
                        ? t('localWorkspace.savedLocalChangesAreWaitingToPublish')
                        : t('localWorkspace.saved')
                    : t('localWorkspace.checkingFiles')}
              </span>
            </div>
            <p className="muted">{item.localPath}</p>
            {!statusError && status?.branch && (
              <LocalBranchBar
                id={item.id}
                current={status.branch}
                busy={busy}
                onSwitch={(name) =>
                  changeBranch(() => api!.localSwitchBranch(item.id, name), 'localWorkspace.switchedBranch', name)
                }
                onCreate={(name) =>
                  changeBranch(() => api!.localCreateBranch(item.id, name), 'localWorkspace.createdBranch', name)
                }
              />
            )}
            {statusError ? (
              <LocalFolderError
                language={language}
                statusError={statusError}
                missing={Boolean(missing)}
                busy={busy}
                onRelocate={() => void relocate(item)}
                onRetry={() => void task(refresh)}
                onRemove={() => setRemoveTarget(item)}
              />
            ) : (
              <>
                <div className="local-actions">
                  <button
                    className="button button-quiet"
                    disabled={busy}
                    onClick={() =>
                      void task(async () => {
                        await api?.localOpenFolder(item.id);
                      })
                    }
                  >
                    <FolderOpen size={16} />
                    {t('localWorkspace.openFolder')}
                  </button>
                  <button
                    className="button button-quiet"
                    disabled={busy}
                    onClick={() => {
                      setExpandedRepoId(item.repositoryId);
                      setPreviewRefresh((value) => value + 1);
                      void task(async () => {
                        if (api) {
                          const next = await api.localStatus(item.id);
                          setStatuses((old) => ({ ...old, [item.id]: next }));
                        }
                      });
                    }}
                  >
                    <FileDiff size={16} />
                    {t('localWorkspace.viewChanges')}
                  </button>
                  <button className="button button-quiet" disabled={busy} onClick={() => void checkLatest(item)}>
                    <ArrowDownToLine size={16} />
                    {t('localWorkspace.getLatest')}
                  </button>
                  {status?.pushable && !status.files.length && !status.needsReview ? (
                    <button className="button button-quiet" disabled={busy} onClick={() => void pushBranch(item)}>
                      <Send size={16} />
                      {t('localWorkspace.pushBranch')}
                    </button>
                  ) : null}
                  {status && (status.files.length > 0 || status.pendingPublish) ? (
                    <button
                      className="button button-primary"
                      disabled={busy}
                      onClick={() => {
                        setExpandedRepoId(item.repositoryId);
                        setPublishId(item.id);
                        setUpdateMessage(
                          status.pendingMessage ??
                            (status.pendingPublish ? t('localWorkspace.publishSavedChanges') : ''),
                        );
                      }}
                    >
                      <Send size={16} />
                      {t('localWorkspace.publishSourceCode')}
                    </button>
                  ) : null}
                </div>
                {expandedRepoId === item.repositoryId && status && (
                  <LocalChangeSelector
                    id={item.id}
                    refreshKey={previewRefresh}
                    disabled={busy}
                    onSelection={onSelection}
                  />
                )}
                {status?.needsReview && (
                  <p className="live-error">{t('localWorkspace.anotherToolHasPreparedChangesInThisFolderFinish')}</p>
                )}
                {syncReview?.id === item.id && (
                  <LocalSyncReview
                    language={language}
                    preview={syncReview.preview}
                    choices={syncChoices}
                    showDifferences={showDifferences}
                    busy={busy}
                    onToggleDifference={(path) => setShowDifferences((old) => ({ ...old, [path]: !old[path] }))}
                    onChoose={(path, choice) => setSyncChoices((old) => ({ ...old, [path]: choice }))}
                    onDecideLater={() => {
                      setSyncReview(null);
                      setPublishAfterSync(null);
                    }}
                    onConfirm={() => void confirmSync(item)}
                  />
                )}
                {publishId === item.id && status && (
                  <LocalPublishForm
                    language={language}
                    status={status}
                    targetPrivate={repo?.private}
                    defaultBranch={repo?.default_branch}
                    message={updateMessage}
                    onMessageChange={setUpdateMessage}
                    inputRef={publishInput}
                    submitDisabled={
                      busy ||
                      status.needsReview ||
                      !updateMessage.trim() ||
                      !selections[item.id] ||
                      (!selections[item.id]?.paths.length && !pending[item.id])
                    }
                    onCancel={() => setPublishId(null)}
                    onSubmit={(event) => void publish(event, item)}
                  />
                )}
                {effectiveMode !== 'create' && (
                  <LocalIntroduction
                    language={language}
                    item={item}
                    branch={repo?.default_branch || 'main'}
                    introduction={introduction}
                    onRefresh={() => setIntroductionRefresh((value) => value + 1)}
                    onOpenLink={(url) => {
                      void api?.openExternalLink(url).catch((cause: unknown) => setError(errorText(cause)));
                    }}
                  />
                )}
              </>
            )}
          </section>
        );
      })}
      {effectiveMode !== 'create' && !singleProject && (
        <LocalCloudProjects
          language={language}
          repos={visibleRepos}
          links={links}
          disabled={busy || downloadBusy}
          onDownload={(repo) => void download(repo)}
        />
      )}
      {removeTarget && (
        <LocalRemoveDialog
          language={language}
          target={removeTarget}
          busy={busy}
          dialogRef={removeDialog}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => void remove(removeTarget)}
        />
      )}
      {sensitiveConfirm && (
        <LocalSensitiveConfirmDialog
          language={language}
          files={sensitiveSelections[sensitiveConfirm.item.id]}
          dialogRef={confirmDialog}
          onBack={() => setSensitiveConfirm(null)}
          onConfirm={() =>
            void publishSelection(
              sensitiveConfirm.item,
              { ...sensitiveConfirm.selection, sensitiveConfirmed: true },
              sensitiveConfirm.message,
            )
          }
        />
      )}
    </div>
  );
}
