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
import {
  ArrowDownToLine,
  FileDiff,
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FolderOpen,
  Globe2,
  LockKeyhole,
  Plus,
  RotateCw,
  Send,
  X,
} from 'lucide-react';
import { ReadmeMarkdown } from './components/ReadmeMarkdown';
import { LocalChangeSelector } from './components/LocalChangeSelector';

import { useDialogFocus } from './components/useDialogFocus';
import { sensitiveReasonText } from './sensitiveReasonText';
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
        <form className="panel live-form live-create-form" onSubmit={(event) => void create(event)}>
          <h2>
            {inspection?.state === 'existing'
              ? t('localWorkspace.createANewProjectFromThisFolder')
              : t('localWorkspace.createProject')}
          </h2>
          <label className="field">
            <span>{t('localWorkspace.projectName')}</span>
            <input
              aria-label={t('localWorkspace.projectName')}
              value={name}
              required
              disabled={busy}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('localWorkspace.shortDescription')}</span>
            <input
              aria-label={t('localWorkspace.shortDescription')}
              value={description}
              disabled={busy}
              maxLength={350}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="field">
            <span>
              {effectiveMode === 'create' ? t('localWorkspace.localFolderOptional') : t('localWorkspace.localFolder')}
            </span>
            <div className="folder-field">
              <FolderOpen size={19} />
              <span title={inspection?.path ?? ''}>{inspection?.path || t('localWorkspace.noFolderSelected')}</span>
              <button type="button" className="button button-quiet" disabled={busy} onClick={() => void chooseFolder()}>
                {t('localWorkspace.chooseFolder')}
              </button>
              {effectiveMode === 'create' && inspection && (
                <button
                  type="button"
                  className="icon-button"
                  disabled={busy}
                  aria-label={t('localWorkspace.clearFolder')}
                  title={t('localWorkspace.clearFolder')}
                  onClick={() => setInspection(null)}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            {effectiveMode === 'create' && <small className="muted">{t('localWorkspace.cloudOnlyHint')}</small>}
          </div>
          <div className="field">
            <span>{t('localWorkspace.whoCanSeeIt')}</span>
            <div className="choice-grid" role="group" aria-label={t('localWorkspace.whoCanSeeIt')}>
              <button
                type="button"
                className={`choice ${isPrivate ? 'chosen' : ''}`}
                aria-pressed={isPrivate}
                disabled={busy}
                onClick={() => setIsPrivate(true)}
              >
                <span className="choice-circle">{isPrivate && <Check size={13} />}</span>
                <LockKeyhole size={18} />
                <strong>{t('localWorkspace.onlyMe')}</strong>
                <small>{t('localWorkspace.visibleOnlyToYou')}</small>
              </button>
              <button
                type="button"
                className={`choice ${!isPrivate ? 'chosen' : ''}`}
                aria-pressed={!isPrivate}
                disabled={busy}
                onClick={() => setIsPrivate(false)}
              >
                <span className="choice-circle">{!isPrivate && <Check size={13} />}</span>
                <Globe2 size={18} />
                <strong>{t('localWorkspace.everyone')}</strong>
                <small>{t('localWorkspace.shareItWithOthers')}</small>
              </button>
            </div>
          </div>
          <button
            className="button button-primary submit-button"
            disabled={
              busy || !name.trim() || (effectiveMode !== 'create' && !inspection) || inspection?.state === 'github'
            }
            type="submit"
          >
            <Plus size={17} />
            {t('localWorkspace.createProject')}
          </button>
        </form>
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
            {statusError ? (
              <div className="local-folder-error" role="alert">
                <h3>
                  {missing
                    ? t('localWorkspace.cannotFindThisFolder')
                    : t('localWorkspace.cannotReadThisFolderRightNow')}
                </h3>
                <p>{t('localWorkspace.ifYouMovedTheFolderSelectItsNewLocation')}</p>
                {missing ? (
                  <details>
                    <summary>{t('localWorkspace.viewDetails')}</summary>
                    <pre data-content-original>{readAppError(statusError).detail}</pre>
                  </details>
                ) : (
                  <ErrorMessage error={statusError} />
                )}
                <div className="local-actions">
                  <button className="button button-primary" disabled={busy} onClick={() => void relocate(item)}>
                    {t('localWorkspace.chooseNewLocation')}
                  </button>
                  <button className="button button-quiet" disabled={busy} onClick={() => void task(refresh)}>
                    {t('localWorkspace.retry')}
                  </button>
                  <button className="button button-quiet" disabled={busy} onClick={() => setRemoveTarget(item)}>
                    {t('localWorkspace.remove')}
                  </button>
                </div>
              </div>
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
                  <div className="sync-review">
                    <h3>{t('localWorkspace.contentNeedsYourChoice')}</h3>
                    <p>{t('localWorkspace.theseFilesWereAlsoChangedOnAnotherComputerReview')}</p>
                    {syncReview.preview.files.map((file) => (
                      <div className="sync-review-file" key={file.path}>
                        <strong>{file.path}</strong>
                        <div className="local-actions">
                          <button
                            className="button button-quiet"
                            type="button"
                            onClick={() => setShowDifferences((old) => ({ ...old, [file.path]: !old[file.path] }))}
                          >
                            {showDifferences[file.path]
                              ? t('localWorkspace.hideComparison')
                              : t('localWorkspace.compareVersions')}
                          </button>
                          <button
                            className={`button ${syncChoices[file.path] === 'mine' ? 'button-primary' : 'button-quiet'}`}
                            type="button"
                            onClick={() => setSyncChoices((old) => ({ ...old, [file.path]: 'mine' }))}
                          >
                            {t('localWorkspace.keepMine')}
                          </button>
                          <button
                            className={`button ${syncChoices[file.path] === 'github' ? 'button-primary' : 'button-quiet'}`}
                            type="button"
                            onClick={() => setSyncChoices((old) => ({ ...old, [file.path]: 'github' }))}
                          >
                            {t('localWorkspace.useGithubVersion')}
                          </button>
                        </div>
                        {showDifferences[file.path] && (
                          <div className="sync-review-diff">
                            <div>
                              <span>{t('localWorkspace.yourVersion')}</span>
                              <pre>{file.mine ?? t('localWorkspace.thisVersionHasNoFile')}</pre>
                            </div>
                            <div>
                              <span>{t('localWorkspace.versionOnGithub')}</span>
                              <pre>{file.github ?? t('localWorkspace.thisVersionHasNoFile')}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="local-actions">
                      <button
                        className="button button-quiet"
                        type="button"
                        onClick={() => {
                          setSyncReview(null);
                          setPublishAfterSync(null);
                        }}
                      >
                        {t('localWorkspace.decideLater')}
                      </button>
                      <button
                        className="button button-primary"
                        type="button"
                        disabled={busy || syncReview.preview.files.some((file) => !syncChoices[file.path])}
                        onClick={() => void confirmSync(item)}
                      >
                        {t('localWorkspace.confirmAndGetLatest')}
                      </button>
                    </div>
                  </div>
                )}
                {publishId === item.id && status && (
                  <form className="local-publish" onSubmit={(event) => void publish(event, item)}>
                    <h3>{t('localWorkspace.publishSourceCode')}</h3>
                    <p className={repo?.private ? '' : 'local-sensitive-warning'}>
                      {repo?.private
                        ? t('localWorkspace.targetRepositoryPrivateVisibleToAuthorizedPeopleOnly')
                        : t('localWorkspace.targetRepositoryPublicAnyoneCanReadPublishedFilesDo')}
                    </p>
                    <div className="local-publish-row">
                      <label className="field">
                        <span>
                          {t('localWorkspace.whatChanged')}
                          <small>{t('localWorkspace.whatChangedRequired')}</small>
                        </span>
                        <input
                          ref={publishInput}
                          aria-label={t('localWorkspace.whatChanged')}
                          required
                          maxLength={200}
                          value={updateMessage}
                          onChange={(event) => setUpdateMessage(event.target.value)}
                          placeholder={t('localWorkspace.forExampleFixWindowResizing')}
                        />
                      </label>
                      <div className="local-actions">
                        <button className="button button-quiet" type="button" onClick={() => setPublishId(null)}>
                          {t('localWorkspace.cancel')}
                        </button>
                        <button
                          className="button button-primary"
                          disabled={
                            busy ||
                            status.needsReview ||
                            !updateMessage.trim() ||
                            !selections[item.id] ||
                            (!selections[item.id]?.paths.length && !pending[item.id])
                          }
                          type="submit"
                        >
                          {status.pendingPublish
                            ? t('localWorkspace.retryPublishing')
                            : t('localWorkspace.publishSelectedFiles')}
                        </button>
                      </div>
                    </div>
                  </form>
                )}
                {effectiveMode !== 'create' && (
                  <details
                    className="local-readme"
                    onToggle={(event) => {
                      if (event.currentTarget.open) setIntroductionRefresh((value) => value + 1);
                    }}
                  >
                    <summary>{t('localWorkspace.projectIntroduction')}</summary>
                    <section aria-label={t('localWorkspace.projectIntroduction')}>
                      <div className="panel-heading">
                        <h3>{t('localWorkspace.projectIntroduction')}</h3>
                      </div>
                      {!introduction ? (
                        <p className="muted" role="status">
                          {t('localWorkspace.loadingProjectIntroduction')}
                        </p>
                      ) : introduction.error ? (
                        <div>
                          <p className="live-error" role="alert">
                            <ErrorMessage error={introduction.error} />
                          </p>
                          <button className="text-link" onClick={() => setIntroductionRefresh((value) => value + 1)}>
                            {t('localWorkspace.readAgain')}
                          </button>
                        </div>
                      ) : introduction.content ? (
                        <ReadmeMarkdown
                          markdown={introduction.content}
                          repository={{ owner: item.owner, name: item.name, branch: repo?.default_branch || 'main' }}
                          onOpenLink={(url) => {
                            void api?.openExternalLink(url).catch((cause: unknown) => setError(errorText(cause)));
                          }}
                        />
                      ) : (
                        <p className="muted">{t('localWorkspace.thisProjectHasNoIntroductionYet')}</p>
                      )}
                    </section>
                  </details>
                )}
              </>
            )}
          </section>
        );
      })}
      {effectiveMode !== 'create' && !singleProject && (
        <section className="panel live-section">
          <div className="panel-heading">
            <h2>{t('localWorkspace.cloudProjects')}</h2>
          </div>
          {visibleRepos
            .filter((repo) => !links.some((item) => item.repositoryId === repo.id))
            .map((repo) => (
              <div className="live-repo-row local-cloud-row" key={repo.id}>
                <span>
                  <strong>{repo.name}</strong>
                  <small>{repo.description || t('localWorkspace.noDescriptionYet')}</small>
                </span>
                <button
                  className="button button-quiet"
                  disabled={busy || downloadBusy}
                  onClick={() => void download(repo)}
                >
                  <Download size={16} />
                  {t('localWorkspace.download')}
                </button>
              </div>
            ))}
          {visibleRepos.every((repo) => links.some((item) => item.repositoryId === repo.id)) && (
            <p className="muted">
              <CheckCircle2 size={16} />
              {t('localWorkspace.allCloudProjectsAreOnThisComputer')}
            </p>
          )}
        </section>
      )}
      {removeTarget && (
        <div className="modal-backdrop">
          <div
            className="modal"
            ref={removeDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-local-title"
          >
            <h2 id="remove-local-title">{t('localWorkspace.removeLocalProjectLink')}</h2>
            <p data-content-original>{removeTarget.name}</p>
            <p>{t('localWorkspace.thisOnlyRemovesTheLinkFromThisComputerS')}</p>
            <div className="modal-actions">
              <button className="button button-quiet" disabled={busy} onClick={() => setRemoveTarget(null)}>
                {t('localWorkspace.cancel')}
              </button>
              <button className="button danger-confirm" disabled={busy} onClick={() => void remove(removeTarget)}>
                {t('localWorkspace.confirmRemoval')}
              </button>
            </div>
          </div>
        </div>
      )}
      {sensitiveConfirm && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sensitive-confirm-title"
            ref={confirmDialog}
          >
            <h2 id="sensitive-confirm-title">{t('localWorkspace.theseFilesMayContainPasswordsOrKeys')}</h2>
            <p className="local-sensitive-warning">
              {t('localWorkspace.checkTheseFilesAnyoneWithAccessToThisRepository')}
            </p>
            <ul>
              {sensitiveSelections[sensitiveConfirm.item.id]?.map((file) => (
                <li key={file.path}>
                  <strong>{file.path}</strong>
                  <ul>
                    {file.sensitiveReasons?.map((reason) => (
                      <li key={reason}>{sensitiveReasonText(reason, language)}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="button button-quiet" onClick={() => setSensitiveConfirm(null)}>
                {t('localWorkspace.backToReview')}
              </button>
              <button
                className="button danger-confirm"
                onClick={() =>
                  void publishSelection(
                    sensitiveConfirm.item,
                    { ...sensitiveConfirm.selection, sensitiveConfirmed: true },
                    sensitiveConfirm.message,
                  )
                }
              >
                {t('localWorkspace.confirmPublicationOfTheseFiles')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
