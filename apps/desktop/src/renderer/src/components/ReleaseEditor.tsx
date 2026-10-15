import { progressLabel } from '../progressLabel';
import { useTranslation } from '../localization';
import { useWorkspaceStorage } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type {
  CreateReleaseInput,
  PickedReleaseFile,
  Project,
  ReleaseAsset,
  ReleaseChannel,
  ReleaseProgress,
  ReleaseMutationFailure,
} from '@easyhub/types';
import { ArrowLeft, ArrowRight, FilePlus2, ImagePlus, Info, Link2, Plus, Trash2 } from 'lucide-react';
import type { Language } from '../i18n';
import {
  MAX_RELEASE_ASSET_SIZE,
  MAX_RELEASE_ASSETS,
  nextReleaseTag,
  validateReleaseAssets,
  validateReleaseInput,
} from '../stores/releaseStore';
import { formatFileSize, ReleasePreview } from './ReleasePreview';
import { createDraftKey, readDraft, writeDraft } from '../draftStore';
import { parseReleaseDraft } from '../releaseDraft';

type MediaDialog = 'link' | 'image' | null;

function validWebUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function markdownLabel(value: string): string {
  return value.trim().replace(/[\[\]\\]/gu, '\\$&');
}

export function ReleaseEditor({
  project,
  draftAccount,
  draftRepository,
  language,
  busy,
  imageSources,
  onRegisterInlineImage,
  onChooseFiles,
  progress,
  failure,
  onPublish,
  onBack,
  onOpenUpdate,
  onOpenLink,
}: {
  project: Pick<Project, 'name' | 'health' | 'releases'>;
  draftAccount?: string;
  draftRepository?: string | number;
  language: Language;
  busy: boolean;
  imageSources: Record<string, string>;
  onRegisterInlineImage: (id: string, source: File | string) => void;
  onChooseFiles?: (inline: boolean) => Promise<PickedReleaseFile[]>;
  progress?: ReleaseProgress | null;
  failure?: ReleaseMutationFailure<unknown> | null;
  onPublish: (input: CreateReleaseInput) => void;
  onBack: () => void;
  onOpenUpdate: () => void;
  onOpenLink: (url: string) => void;
}) {
  const t = useTranslation(language);
  const workspaceStorage = useWorkspaceStorage();
  const firstTag = nextReleaseTag(project.releases, 'stable');
  const draftKey =
    draftAccount && draftRepository !== undefined ? createDraftKey(draftAccount, draftRepository, 'release') : null;
  const [recovered] = useState(() => (draftKey ? parseReleaseDraft(readDraft(draftKey, workspaceStorage)) : null));
  const [channel, setChannel] = useState<ReleaseChannel>(recovered?.channel ?? 'stable');
  const [tagName, setTagName] = useState(recovered?.tagName ?? firstTag);
  const [title, setTitle] = useState(recovered?.title ?? `${project.name} ${firstTag}`);
  const [body, setBody] = useState(recovered?.body ?? '');
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const [stage, setStage] = useState<'edit' | 'preview'>('edit');
  const [error, setError] = useState<string | null>(null);
  const [mediaDialog, setMediaDialog] = useState<MediaDialog>(null);
  const [mediaLabel, setMediaLabel] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const assetInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (
      draftKey &&
      (recovered || body || title !== `${project.name} ${firstTag}` || tagName !== firstTag || assets.length)
    ) {
      writeDraft(
        draftKey,
        JSON.stringify({ title, body, tagName, channel, attachments: assets.length > 0 || recovered?.attachments }),
        workspaceStorage,
      );
    }
  }, [draftKey, recovered, body, title, tagName, channel, assets.length, project.name, firstTag]);

  useLayoutEffect(() => {
    document.querySelector('.main-column')?.scrollTo(0, 0);
  }, [stage]);

  const draft: CreateReleaseInput = { tagName, title, body, channel, assets };
  const continuingDraft = failure?.residualDraft?.retainedForRetry === true;

  function chooseChannel(next: ReleaseChannel): void {
    if (continuingDraft || busy) return;
    const suggested = nextReleaseTag(project.releases, next);
    setChannel(next);
    setTagName(suggested);
    if (title === `${project.name} ${tagName}`) setTitle(`${project.name} ${suggested}`);
    setError(null);
  }

  function changeTag(next: string): void {
    if (continuingDraft || busy) return;
    if (title === `${project.name} ${tagName}`) setTitle(`${project.name} ${next}`);
    setTagName(next);
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>, inline: boolean): void {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    if (inline && files.some((file) => !file.type.startsWith('image/'))) {
      setError(t('releaseEditor.chooseAnImageFile'));
      return;
    }
    const added = files.map((file) => ({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      file,
    }));
    if (!acceptFiles(added.map(({ file: _file, ...asset }) => asset))) return;
    if (inline) {
      for (const item of added) {
        onRegisterInlineImage(item.id, item.file);
        const safeName = markdownLabel(item.name);
        setBody((current) => `${current.trimEnd()}\n\n![${safeName}](easyhub-image:${item.id})\n`.trimStart());
      }
      setMediaDialog(null);
    }
    setError(null);
  }

  function acceptFiles(items: ReleaseAsset[]): boolean {
    try {
      validateReleaseAssets([...assets, ...items]);
    } catch (caught) {
      setError(errorText(caught, t('releaseEditor.couldNotAddFiles')));
      return false;
    }
    setAssets((current) => [...current, ...items]);
    return true;
  }

  async function chooseFiles(inline: boolean): Promise<void> {
    if (!onChooseFiles) {
      (inline ? imageInput : assetInput).current?.click();
      return;
    }
    try {
      const picked = await onChooseFiles(inline);
      if (!picked.length) return;
      if (!acceptFiles(picked.map(({ previewDataUrl: _preview, ...asset }) => asset))) return;
      if (inline) {
        for (const item of picked) {
          if (item.previewDataUrl) onRegisterInlineImage(item.id, item.previewDataUrl);
          setBody((current) =>
            `${current.trimEnd()}\n\n![${markdownLabel(item.name)}](easyhub-image:${item.id})\n`.trimStart(),
          );
        }
        setMediaDialog(null);
      }
      setError(null);
    } catch (cause) {
      setError(errorText(cause, t('releaseEditor.cannotSelectFiles')));
    }
  }

  function removeAsset(id: string): void {
    if (busy || failure?.completedAssetIds.includes(id)) return;
    setAssets((current) => current.filter((asset) => asset.id !== id));
    setBody((current) =>
      current
        .split('\n')
        .filter((line) => !line.includes(`](easyhub-image:${id})`))
        .join('\n'),
    );
    setError(null);
  }

  function insertMedia(): void {
    const url = validWebUrl(mediaUrl);
    if (!url) {
      setError(t('releaseEditor.enterAValidHttpOrHttpsUrl'));
      return;
    }
    const safeUrl = url.replaceAll(')', '%29');
    const label = markdownLabel(
      mediaLabel || (mediaDialog === 'image' ? t('releaseEditor.image') : t('releaseEditor.viewLink')),
    );
    const fragment = mediaDialog === 'image' ? `![${label}](${safeUrl})` : `[${label}](${safeUrl})`;
    setBody((current) => `${current.trimEnd()}\n\n${fragment}\n`.trimStart());
    setMediaDialog(null);
    setMediaLabel('');
    setMediaUrl('');
    setError(null);
  }

  function showPreview(): void {
    try {
      validateReleaseInput(project.releases, draft);
      setError(null);
      setStage('preview');
    } catch (caught) {
      setError(errorText(caught, t('releaseEditor.checkTheReleaseDetails')));
    }
  }

  return (
    <div className="release-page">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={17} />
        {t('releaseEditor.backToProject')}
      </button>
      <div className="release-page-heading">
        <div className="eyebrow">{project.name}</div>
        <h1>{t('releaseEditor.publishNewRelease')}</h1>
        <p>{t('releaseEditor.prepareAVersionNumberDescriptionAndInstallerForDownloaders')}</p>
      </div>
      <div className="release-distinction">
        <Info size={20} />
        <div>
          <strong>{t('releaseEditor.twoWaysToPublish')}</strong>
          <p>
            <b>{t('releaseEditor.publishSourceCode')}</b>
            {t('releaseEditor.savesEverydayCodeChanges')}
            <b>{t('releaseEditor.publishNewRelease')}</b>
            {t('releaseEditor.createsAReleasePageWithAVersionNumberAnd')}
          </p>
        </div>
      </div>
      {recovered && (
        <p role="status" className="release-field-hint">
          {t('releaseEditor.textDraftRestored')}
          {recovered.attachments && t('releaseEditor.pleaseAddYourPreviousAttachmentsAndLocalImagesAgain')}
        </p>
      )}
      {project.health === 'changes' && (
        <div className="release-pending-changes">
          <Info size={18} />
          <span>{t('releaseEditor.thisProjectHasUnpublishedSourceChangesThisReleaseWill')}</span>
          <button className="text-link" onClick={onOpenUpdate}>
            {t('releaseEditor.publishSourceCodeFirst')} <ArrowRight size={15} />
          </button>
        </div>
      )}
      {stage === 'edit' ? (
        <div className="release-editor-stack">
          <section className="panel release-editor-card">
            <div className="release-section-heading">
              <span>1</span>
              <div>
                <h2>{t('releaseEditor.releaseDetails')}</h2>
                <p>{t('releaseEditor.easyhubSuggestsTheNextVersionForThisProjectYou')}</p>
              </div>
            </div>
            <div className="release-channel-options" role="group" aria-label={t('releaseEditor.releaseType')}>
              <button
                disabled={continuingDraft || busy}
                className={channel === 'stable' ? 'selected' : ''}
                aria-pressed={channel === 'stable'}
                onClick={() => chooseChannel('stable')}
              >
                {t('releaseEditor.stable')}
              </button>
              <button
                disabled={continuingDraft || busy}
                className={channel === 'alpha' ? 'selected' : ''}
                aria-pressed={channel === 'alpha'}
                onClick={() => chooseChannel('alpha')}
              >
                {t('releaseEditor.alphaPreview')}
              </button>
              <button
                disabled={continuingDraft || busy}
                className={channel === 'beta' ? 'selected' : ''}
                aria-pressed={channel === 'beta'}
                onClick={() => chooseChannel('beta')}
              >
                {t('releaseEditor.betaPreview')}
              </button>
            </div>
            <div className="release-fields">
              <label className="field">
                <span>
                  {t('releaseEditor.versionNumber')} <b>*</b>
                </span>
                <input
                  aria-label={t('releaseEditor.versionNumber')}
                  disabled={continuingDraft || busy}
                  value={tagName}
                  onChange={(event) => changeTag(event.target.value)}
                  maxLength={80}
                  placeholder="v0.01"
                />
                <small>
                  {t('releaseEditor.previousStableRelease')}
                  {project.releases.find((release) => release.channel === 'stable')?.tagName ??
                    t('releaseEditor.noneYet')}
                </small>
              </label>
              <label className="field">
                <span>
                  {t('releaseEditor.releaseTitle')} <b>*</b>
                </span>
                <input
                  aria-label={t('releaseEditor.releaseTitle')}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  placeholder={t('releaseEditor.myToolV001')}
                />
              </label>
            </div>
            {continuingDraft && (
              <p className="release-field-hint">{t('releaseEditor.uploadedFilesAndTheVersionNumberStayInThe')}</p>
            )}
          </section>
          <section className="panel release-editor-card">
            <div className="release-section-heading">
              <span>2</span>
              <div>
                <h2>{t('releaseEditor.releaseDescription')}</h2>
                <p>{t('releaseEditor.tellDownloadersWhatIsNewAndHowToUse')}</p>
              </div>
            </div>
            <div className="release-body-toolbar">
              <button
                onClick={() => {
                  setMediaDialog('image');
                  setError(null);
                }}
              >
                <ImagePlus size={17} />
                {t('releaseEditor.addImage')}
              </button>
              <button
                onClick={() => {
                  setMediaDialog('link');
                  setError(null);
                }}
              >
                <Link2 size={17} />
                {t('releaseEditor.addLink')}
              </button>
            </div>
            <textarea
              className="release-body-input"
              aria-label={t('releaseEditor.releaseDescription')}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t('releaseEditor.forExampleFixedWindowResizingAndAddedDarkMode')}
              rows={8}
            />
            <p className="release-field-hint">{t('releaseEditor.simpleFormattingIsSupportedAddImagesOrLinksAbove')}</p>
          </section>
          <section className="panel release-editor-card">
            <div className="release-section-heading">
              <span>3</span>
              <div>
                <h2>{t('releaseEditor.downloadFiles')}</h2>
                <p>{t('releaseEditor.chooseOneOrMoreInstallersArchivesOrOtherFiles')}</p>
              </div>
            </div>
            <input
              ref={assetInput}
              type="file"
              multiple
              className="release-hidden-input"
              aria-label={t('releaseEditor.chooseReleaseFiles')}
              onChange={(event) => addFiles(event, false)}
            />
            <input
              ref={imageInput}
              type="file"
              multiple
              accept="image/*"
              className="release-hidden-input"
              aria-label={t('releaseEditor.chooseDescriptionImages')}
              onChange={(event) => addFiles(event, true)}
            />
            <button className="release-add-files" onClick={() => void chooseFiles(false)}>
              <FilePlus2 size={22} />
              <strong>{t('releaseEditor.addFiles')}</strong>
              <span>{t('releaseEditor.clickToChooseOneOrMoreFiles')}</span>
            </button>
            {assets.length > 0 && (
              <div className="release-selected-files">
                {assets.map((asset) => (
                  <div key={asset.id} className="release-selected-file">
                    <FilePlus2 size={17} />
                    <span title={asset.name}>{asset.name}</span>
                    <small>{formatFileSize(asset.size)}</small>
                    <button
                      className="icon-button"
                      disabled={busy || failure?.completedAssetIds.includes(asset.id)}
                      aria-label={t('releaseEditor.remove', { p0: asset.name })}
                      onClick={() => removeAsset(asset.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="release-field-hint">
              {t('releaseEditor.currentGithubLimitsUpTo')} {MAX_RELEASE_ASSETS}{' '}
              {t('releaseEditor.filesEachSmallerThan')} {MAX_RELEASE_ASSET_SIZE / 1024 ** 3}{' '}
              {t('releaseEditor.gibFileNamesMustBeUniqueWithinARelease')}
            </p>
          </section>
          {error && (
            <div className="release-error" role="alert">
              <ErrorMessage error={error} />
            </div>
          )}
          <div className="release-editor-actions">
            <button className="button button-quiet" onClick={onBack}>
              {t('releaseEditor.cancel')}
            </button>
            <button className="button button-primary" onClick={showPreview}>
              {t('releaseEditor.previewRelease')} <ArrowRight size={17} />
            </button>
          </div>
        </div>
      ) : (
        <div className="release-preview-stage">
          <div className="release-preview-intro">
            <strong>{t('releaseEditor.thisIsWhatDownloadersWillSee')}</strong>
            <span>{t('releaseEditor.checkTheVersionNumberDescriptionImagesLinksAndFile')}</span>
          </div>
          <ReleasePreview release={draft} imageSources={imageSources} language={language} onOpenLink={onOpenLink} />
          {assets.length === 0 && (
            <div className="release-preview-warning">
              <Info size={17} />
              {t('releaseEditor.noInstallerAddedGithubWillStillProvideSourceArchives')}
            </div>
          )}
          {project.health === 'changes' && (
            <div className="release-preview-warning">
              <Info size={17} />
              {t('releaseEditor.unpublishedLocalChangesWillNotAppearInThisRelease')}
            </div>
          )}
          {progress && (
            <div className="release-upload-progress" role="status">
              <strong>{progressLabel(progress, t)}</strong>
              {progress.total > 0 && <progress value={progress.loaded} max={progress.total} />}
            </div>
          )}
          {failure && (
            <div className="release-error" role="alert" data-testid="release-recovery">
              <p>
                <ErrorMessage error={failure.error} />
              </p>
              {assets.length > 0 && (
                <p>
                  {t('releaseEditor.confirmedCompletedStillUnfinished', {
                    p0: failure.completedAssetIds.length,
                    p1: failure.remainingAssetIds.length,
                  })}
                </p>
              )}
              {failure.residualDraft && (
                <>
                  <p>
                    {failure.residualDraft.id
                      ? t('releaseEditor.unpublishedDraftOnGithub')
                      : t('releaseEditor.publicationDetailsToVerify')}
                    {failure.residualDraft.title} · {failure.residualDraft.tagName}
                  </p>
                  <button type="button" className="text-link" onClick={() => onOpenLink(failure.residualDraft!.url)}>
                    {t('releaseEditor.viewDraftOnGithub')}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="release-editor-actions">
            <button
              className="button button-quiet"
              disabled={busy && !progress?.cancelable}
              onClick={busy && progress?.cancelable ? onBack : () => setStage('edit')}
            >
              {busy ? (
                t('releaseEditor.cancelPublication')
              ) : (
                <>
                  <ArrowLeft size={16} />
                  {t('releaseEditor.backToEditing')}
                </>
              )}
            </button>
            <button
              className="button button-primary"
              disabled={busy || failure?.retryable === false}
              onClick={() => onPublish(draft)}
            >
              {busy
                ? t('releaseEditor.publishing')
                : failure?.retryable
                  ? t('releaseEditor.retryUnfinishedUploads')
                  : t('releaseEditor.confirmRelease')}{' '}
              <ArrowRight size={17} />
            </button>
          </div>
          {!onChooseFiles && (
            <p className="release-demo-note">{t('releaseEditor.demoModeConfirmingOnlyUpdatesDataInThisWindow')}</p>
          )}
        </div>
      )}
      {mediaDialog && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMediaDialog(null);
          }}
        >
          <div
            className="modal release-media-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-media-title"
          >
            <h2 id="release-media-title">
              {mediaDialog === 'image' ? t('releaseEditor.addImage') : t('releaseEditor.addLink')}
            </h2>
            <p>
              {mediaDialog === 'image'
                ? t('releaseEditor.pasteAnImageUrlOrChooseAnImageFrom')
                : t('releaseEditor.enterTheLinkUrlAndDisplayText')}
            </p>
            <label className="field">
              <span>
                {mediaDialog === 'image' ? t('releaseEditor.imageDescription') : t('releaseEditor.displayText')}
              </span>
              <input
                value={mediaLabel}
                onChange={(event) => setMediaLabel(event.target.value)}
                placeholder={
                  mediaDialog === 'image'
                    ? t('releaseEditor.forExampleAppScreen')
                    : t('releaseEditor.forExampleUserGuide')
                }
              />
            </label>
            <label className="field">
              <span>{mediaDialog === 'image' ? t('releaseEditor.imageUrl') : t('releaseEditor.linkUrl')}</span>
              <input
                value={mediaUrl}
                onChange={(event) => setMediaUrl(event.target.value)}
                placeholder="https://example.com"
              />
            </label>
            {error && (
              <div className="release-error" role="alert">
                <ErrorMessage error={error} />
              </div>
            )}
            <div className="modal-actions">
              <button className="button button-quiet" onClick={() => setMediaDialog(null)}>
                {t('releaseEditor.cancel')}
              </button>
              {mediaDialog === 'image' && (
                <button className="button button-quiet" onClick={() => void chooseFiles(true)}>
                  <ImagePlus size={16} />
                  {t('releaseEditor.chooseLocalImage')}
                </button>
              )}
              <button className="button button-primary" onClick={insertMedia}>
                <Plus size={16} />
                {t('releaseEditor.insert')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
