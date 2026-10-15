import { useNoticeState } from '../useNoticeState';
import { FeedbackNotice } from './FeedbackNotice';
import { progressLabel } from '../progressLabel';
import { useLanguage, useTranslation } from '../localization';
import { useWorkspaceStorage } from '../bridge';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useRef, useState } from 'react';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import { ImagePlus, Link2, Plus, Trash2, X } from 'lucide-react';
import type { GitHubCreatedRelease, GitHubRelease, GitHubRepo } from '@easyhub/github';
import type { PickedReleaseFile, ReleaseProgress, ReleaseMutationFailure } from '@easyhub/types';

import { createDraftKey, readDraft, removeDraft, writeDraft } from '../draftStore';
import { parseReleaseDraft } from '../releaseDraft';

export function ReleaseEditPanel({
  repo,
  release,
  draftAccount,
  onUpdated,
  onClose,
  onOpenLink,
  onBusyChange,
}: {
  repo: GitHubRepo;
  draftAccount?: string;
  release: GitHubRelease;
  onUpdated: (value: GitHubCreatedRelease) => void;
  onClose: () => void;
  onOpenLink: (url: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useTranslation();
  const language = useLanguage();
  const workspaceStorage = useWorkspaceStorage();
  const easyHub = useEasyHub();
  const draftKey = draftAccount ? createDraftKey(draftAccount, repo.id, 'release-edit', release.id) : null;
  const [recovered] = useState(() => (draftKey ? parseReleaseDraft(readDraft(draftKey, workspaceStorage)) : null));
  const [title, setTitle] = useState(recovered?.title ?? release.name ?? release.tag_name);
  const [body, setBody] = useState(recovered?.body ?? release.body ?? '');
  const [prerelease, setPrerelease] = useState(recovered?.prerelease ?? release.prerelease);
  const [preview, setPreview] = useState(false);
  const [files, setFiles] = useState<PickedReleaseFile[]>([]);
  const [confirmAsset, setConfirmAsset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const operationActive = useRef(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useNoticeState();
  const [progress, setProgress] = useState<ReleaseProgress | null>(null);
  const [urlDialog, setUrlDialog] = useState<'link' | 'image' | null>(null);
  const [url, setUrl] = useState('');
  const [urlLabel, setUrlLabel] = useState('');

  useEffect(() => easyHub?.onReleaseProgress((value) => setProgress(value)), []);
  useEffect(() => {
    if (!draftKey) return;
    if (
      title === (release.name || release.tag_name) &&
      body === (release.body || '') &&
      prerelease === release.prerelease
    )
      removeDraft(draftKey, workspaceStorage);
    else writeDraft(draftKey, JSON.stringify({ title, body, prerelease }), workspaceStorage);
  }, [draftKey, title, body, prerelease, release.name, release.tag_name, release.body, release.prerelease]);

  const target = { owner: repo.owner.login, repo: repo.name, releaseId: release.id };
  const run = async (
    operation: () => Promise<GitHubCreatedRelease | ReleaseMutationFailure<GitHubCreatedRelease>>,
    success: string,
  ): Promise<GitHubCreatedRelease | null> => {
    if (operationActive.current) return null;
    operationActive.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    setNotice('');
    try {
      const updated = await operation();
      if ('status' in updated) {
        if (updated.release) onUpdated(updated.release);
        setFiles((current) => current.filter((file) => !updated.completedAssetIds.includes(file.id)));
        setUploadFailed(true);
        setError(updated.error);
        return null;
      }
      onUpdated(updated);
      setNotice(success);
      return updated;
    } catch (cause) {
      setError(errorText(cause));
      return null;
    } finally {
      operationActive.current = false;
      setBusy(false);
      onBusyChange?.(false);
      setProgress(null);
    }
  };

  const chooseFiles = async (): Promise<void> => {
    if (operationActive.current) return;
    operationActive.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const picked = await easyHub!.chooseReleaseFiles(false);
      if (picked.length) {
        setFiles((current) => [...current, ...picked]);
        setUploadFailed(false);
      }
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      operationActive.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const addFiles = async (): Promise<void> => {
    if (!files.length) return;
    if (
      await run(
        () => easyHub!.addReleaseAssets({ ...target, assetIds: files.map((file) => file.id) }),
        t('releaseEditPanel.filesAddedToThisRelease'),
      )
    ) {
      setFiles([]);
      setUploadFailed(false);
    }
  };

  const addImage = async (): Promise<void> => {
    if (operationActive.current) return;
    operationActive.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const [picked] = await easyHub!.chooseReleaseFiles(true);
      if (!picked) return;
      operationActive.current = false;
      const updated = await run(
        () => easyHub!.addReleaseAssets({ ...target, assetIds: [picked.id] }),
        t('releaseEditPanel.imageAddedSaveTheDescriptionToShowIt'),
      );
      if (!updated) {
        setFiles((current) => (current.some((file) => file.id === picked.id) ? current : [...current, picked]));
        return;
      }
      const uploaded = updated.assets.find((asset) => !release.assets.some((existing) => existing.id === asset.id));
      if (!uploaded) {
        setError(t('releaseEditPanel.theImageWasUploadedButItsLinkCouldNot'));
        return;
      }
      const link = `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/releases/download/${encodeURIComponent(updated.tag_name)}/${encodeURIComponent(uploaded.name)}`;
      setBody((current) =>
        `${current.trimEnd()}\n\n![${uploaded.name.replace(/[\[\]\\]/g, '\\$&')}](${link})\n`.trimStart(),
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      operationActive.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!title.trim()) {
      setError(t('releaseEditPanel.enterAReleaseName'));
      return;
    }
    if (
      await run(
        () => easyHub!.editRelease({ ...target, title, body, prerelease }),
        t('releaseEditPanel.releaseDetailsUpdated'),
      )
    ) {
      if (draftKey) removeDraft(draftKey, workspaceStorage);
    }
  };

  const remove = async (assetId: number): Promise<void> => {
    if (
      await run(
        () => easyHub!.removeReleaseAsset({ ...target, assetId }),
        t('releaseEditPanel.fileRemovedFromThisRelease'),
      )
    )
      setConfirmAsset(null);
  };

  const insertUrl = (): void => {
    let valid: URL;
    try {
      valid = new URL(url.trim());
    } catch {
      setError(t('releaseEditPanel.enterAValidLink'));
      return;
    }
    if (!['https:', 'http:'].includes(valid.protocol)) {
      setError(t('releaseEditPanel.enterAValidLink'));
      return;
    }
    const safeLabel = (
      urlLabel.trim() || (urlDialog === 'image' ? t('releaseEditPanel.image') : t('releaseEditPanel.link'))
    ).replace(/[\[\]\\]/g, '\\$&');
    setBody((current) =>
      `${current.trimEnd()}\n\n${urlDialog === 'image' ? '!' : ''}[${safeLabel}](${valid.toString()})\n`.trimStart(),
    );
    setUrlDialog(null);
    setUrl('');
    setUrlLabel('');
    setError('');
  };

  return (
    <div className="release-edit-panel" data-testid="release-edit-panel">
      <div className="release-edit-heading">
        <h3>
          {t('releaseEditPanel.editReleases')} · {release.tag_name}
        </h3>
        <button
          className="icon-button"
          disabled={busy}
          onClick={onClose}
          aria-label={t('releaseEditPanel.closeEditor')}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">{t('releaseEditPanel.theVersionTagStaysTheSameSoDownloadLinks')}</p>
      <label>
        {t('releaseEditPanel.releaseTitle')}
        <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
      </label>
      <label>
        {t('releaseEditPanel.releaseDescription')}
        <textarea
          rows={8}
          value={body}
          maxLength={262144}
          onChange={(event) => setBody(event.target.value)}
          disabled={busy}
        />
      </label>
      <div className="release-edit-actions">
        <button type="button" className="secondary-button" onClick={() => setUrlDialog('link')} disabled={busy}>
          <Link2 size={16} />
          {t('releaseEditPanel.insertLink')}
        </button>
        <button type="button" className="secondary-button" onClick={() => setUrlDialog('image')} disabled={busy}>
          <ImagePlus size={16} />
          {t('releaseEditPanel.insertImageLink')}
        </button>
        <button type="button" className="secondary-button" onClick={() => void addImage()} disabled={busy}>
          <ImagePlus size={16} />
          {t('releaseEditPanel.uploadImageAndInsert')}
        </button>
        <button type="button" className="secondary-button" onClick={() => setPreview((value) => !value)}>
          {preview ? t('releaseEditPanel.continueEditing') : t('releaseEditPanel.preview')}
        </button>
      </div>
      {urlDialog && (
        <div className="release-edit-url">
          <input
            value={urlLabel}
            onChange={(event) => setUrlLabel(event.target.value)}
            placeholder={t('releaseEditPanel.displayText')}
            aria-label={t('releaseEditPanel.displayText')}
          />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
            aria-label={t('releaseEditPanel.linkUrl')}
          />
          <button type="button" onClick={insertUrl}>
            {t('releaseEditPanel.insert')}
          </button>
          <button type="button" onClick={() => setUrlDialog(null)}>
            {t('releaseEditPanel.cancel')}
          </button>
        </div>
      )}
      {preview && (
        <div className="release-description release-edit-preview">
          <ReadmeMarkdown
            markdown={body || t('releaseEditPanel.thisReleaseHasNoDescriptionYet')}
            repository={{ owner: repo.owner.login, name: repo.name, branch: repo.default_branch }}
            onOpenLink={onOpenLink}
          />
        </div>
      )}
      <label className="release-edit-check">
        <input
          type="checkbox"
          checked={prerelease}
          onChange={(event) => setPrerelease(event.target.checked)}
          disabled={busy}
        />
        {t('releaseEditPanel.thisIsAPrerelease')}
      </label>
      <button type="button" className="primary-button" onClick={() => void save()} disabled={busy || !title.trim()}>
        {t('releaseEditPanel.saveReleaseDetails')}
      </button>

      <div className="release-edit-assets">
        <h3>{t('releaseEditPanel.manageUploadedFiles')}</h3>
        <p className="muted">{t('releaseEditPanel.removingAFileWillInvalidateItsDownloadLink')}</p>
        {release.assets.map((asset) => (
          <div className="release-edit-asset" key={asset.id}>
            <span>{asset.name}</span>
            {confirmAsset === asset.id ? (
              <div className="release-edit-actions">
                <span>{t('releaseEditPanel.removeThisFile')}</span>
                <button type="button" className="danger-button" disabled={busy} onClick={() => void remove(asset.id)}>
                  {t('releaseEditPanel.removeFile')}
                </button>
                <button type="button" onClick={() => setConfirmAsset(null)}>
                  {t('releaseEditPanel.cancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setConfirmAsset(asset.id)}
              >
                <Trash2 size={15} />
                {t('releaseEditPanel.remove')}
              </button>
            )}
          </div>
        ))}
        <div className="release-edit-actions">
          <button type="button" className="secondary-button" onClick={() => void chooseFiles()} disabled={busy}>
            <Plus size={16} />
            {t('releaseEditPanel.chooseFiles')}
          </button>
          {files.length > 0 && (
            <button type="button" className="primary-button" disabled={busy} onClick={() => void addFiles()}>
              {uploadFailed
                ? t('releaseEditPanel.retryUnfinishedFiles', { p0: files.length })
                : t('releaseEditPanel.uploadFiles', { p0: files.length })}
            </button>
          )}
        </div>
        {files.map((file) => (
          <div className="release-edit-asset" key={file.id}>
            <span>{file.name}</span>
            <button
              type="button"
              onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}
              disabled={busy}
            >
              {t('releaseEditPanel.deselect')}
            </button>
          </div>
        ))}
      </div>
      {progress && (
        <div className="release-edit-progress">
          <span>{progressLabel(progress, t)}</span>
          <progress max={Math.max(progress.total, 1)} value={Math.min(progress.loaded, Math.max(progress.total, 1))} />
          {progress.cancelable && (
            <button type="button" onClick={() => void easyHub?.cancelRelease()}>
              {t('releaseEditPanel.cancelUpload')}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="live-error" role="alert">
          <ErrorMessage error={error} />
        </p>
      )}
      <FeedbackNotice message={notice} language={language} onClose={() => setNotice('')} />
    </div>
  );
}
