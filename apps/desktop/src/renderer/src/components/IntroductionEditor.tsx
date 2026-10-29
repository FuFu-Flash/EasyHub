import { useTranslation } from '../localization';
import { ErrorMessage } from './ErrorMessage';
import { SegmentedControl } from './SegmentedControl';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { ImagePlus, Link2, X } from 'lucide-react';
import { useDialogFocus } from './useDialogFocus';
import { ReadmeMarkdown, type ReadmeRepository } from './ReadmeMarkdown';

type Media = 'image' | 'link' | null;
type EditorMode = 'edit' | 'preview' | 'split';

function webUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function label(value: string): string {
  return value.trim().replace(/[\[\]\\]/gu, '\\$&');
}

export function IntroductionEditor({
  initialMarkdown,
  repository,
  saving = false,
  live = false,
  saveError = '',
  onSave,
  onCancel,
  onOpenLink,
}: {
  initialMarkdown: string;
  repository?: ReadmeRepository;
  saving?: boolean;
  live?: boolean;
  saveError?: string;
  onSave: (markdown: string) => void;
  onCancel: () => void;
  onOpenLink: (url: string) => void;
}) {
  const t = useTranslation();
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const dialog = useRef<HTMLDivElement>(null);
  // Escape never throws away typed text; use the close button or Cancel to discard it.
  useDialogFocus(true, dialog, () => {
    if (!saving && markdown === initialMarkdown) onCancel();
  });
  const previewMarkdown = useDeferredValue(markdown);
  const [mode, setMode] = useState<EditorMode>('edit');
  const [media, setMedia] = useState<Media>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const previewContent = useMemo(
    () =>
      previewMarkdown.trim() ? (
        <div data-content-original="true">
          <ReadmeMarkdown markdown={previewMarkdown} repository={repository} onOpenLink={onOpenLink} />
        </div>
      ) : (
        <p className="muted">{t('introductionEditor.thisProjectHasNoIntroductionYet')}</p>
      ),
    [previewMarkdown, repository, onOpenLink],
  );

  function insert(): void {
    const valid = webUrl(url);
    if (!valid) {
      setError(t('introductionEditor.enterAValidUrlBeginningWithHttpsOrHttp'));
      return;
    }
    const fragment =
      media === 'image'
        ? `![${label(title || t('introductionEditor.image'))}](${valid.replaceAll(')', '%29')})`
        : `[${label(title || t('introductionEditor.viewLink'))}](${valid.replaceAll(')', '%29')})`;
    setMarkdown((old) => `${old.trimEnd()}\n\n${fragment}\n`.trimStart());
    setMedia(null);
    setTitle('');
    setUrl('');
    setError('');
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className={`modal intro-modal${mode === 'split' ? ' intro-modal-split' : ''}`}
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intro-editor-title"
      >
        <button className="icon-button modal-close" aria-label={t('introductionEditor.close')} onClick={onCancel}>
          <X size={19} />
        </button>
        <div className="intro-editor-header">
          <h2 id="intro-editor-title">{t('introductionEditor.editProjectIntroduction')}</h2>
          <p>
            {live
              ? t('introductionEditor.savingReplacesTheLocalIntroductionPublishTheSourceTo')
              : t('introductionEditor.savingMarksTheSourceAsUnpublished')}
          </p>
          <SegmentedControl className="intro-editor-tabs">
            <button
              className={mode === 'edit' ? 'selected' : ''}
              aria-pressed={mode === 'edit'}
              onClick={() => setMode('edit')}
            >
              {t('introductionEditor.edit')}
            </button>
            <button
              className={mode === 'preview' ? 'selected' : ''}
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
            >
              {t('introductionEditor.preview')}
            </button>
            <button
              className={mode === 'split' ? 'selected' : ''}
              aria-pressed={mode === 'split'}
              onClick={() => setMode('split')}
            >
              {t('introductionEditor.livePreview')}
            </button>
          </SegmentedControl>
        </div>
        <div className="intro-editor-body">
          {mode === 'preview' ? (
            <div
              className="intro-editor-preview"
              role="region"
              aria-label={t('introductionEditor.projectIntroductionPreview')}
            >
              {previewContent}
            </div>
          ) : (
            <>
              <div className="release-body-toolbar intro-media-toolbar">
                <button
                  onClick={() => {
                    setMedia('image');
                    setError('');
                  }}
                >
                  <ImagePlus size={17} />
                  {t('introductionEditor.addImage')}
                </button>
                <button
                  onClick={() => {
                    setMedia('link');
                    setError('');
                  }}
                >
                  <Link2 size={17} />
                  {t('introductionEditor.addLink')}
                </button>
              </div>
              {media && (
                <div className="intro-media-form">
                  <strong>
                    {media === 'image' ? t('introductionEditor.insertWebImage') : t('introductionEditor.insertWebLink')}
                  </strong>
                  <label className="field">
                    <span>
                      {media === 'image'
                        ? t('introductionEditor.imageDescription')
                        : t('introductionEditor.displayText')}
                    </span>
                    <input
                      aria-label={
                        media === 'image'
                          ? t('introductionEditor.imageDescription')
                          : t('introductionEditor.displayText')
                      }
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={
                        media === 'image'
                          ? t('introductionEditor.forExampleAppScreen')
                          : t('introductionEditor.forExampleUserGuide')
                      }
                    />
                  </label>
                  <label className="field">
                    <span>
                      {media === 'image' ? t('introductionEditor.imageUrl') : t('introductionEditor.linkUrl')}
                    </span>
                    <input
                      aria-label={
                        media === 'image' ? t('introductionEditor.imageUrl') : t('introductionEditor.linkUrl')
                      }
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://example.com"
                    />
                  </label>
                  <div className="local-actions">
                    <button className="button button-quiet" onClick={() => setMedia(null)}>
                      {t('introductionEditor.cancelInsertion')}
                    </button>
                    <button className="button button-primary" onClick={insert}>
                      {t('introductionEditor.insert')}
                    </button>
                  </div>
                </div>
              )}
              <div className={`intro-editor-layout${mode === 'split' ? ' is-split' : ''}`}>
                <label className="field intro-editor-source">
                  <span>{t('introductionEditor.introductionContent')}</span>
                  <textarea
                    aria-label={t('introductionEditor.introductionContent')}
                    value={markdown}
                    onChange={(event) => setMarkdown(event.target.value)}
                    rows={13}
                    placeholder={t('introductionEditor.myProjectDescribeYourProjectInAFewSentences')}
                    autoFocus
                  />
                </label>
                {mode === 'split' && (
                  <div className="intro-editor-live-preview">
                    <span>{t('introductionEditor.preview')}</span>
                    <div
                      className="intro-editor-preview"
                      role="region"
                      aria-label={t('introductionEditor.projectIntroductionPreview')}
                    >
                      {previewContent}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="intro-editor-footer">
          {live && (
            <label className="intro-overwrite-confirm">
              <input
                type="checkbox"
                checked={confirmOverwrite}
                onChange={(event) => setConfirmOverwrite(event.target.checked)}
              />
              {t('introductionEditor.iConfirmReplacingThisProjectSLocalIntroductionFile')}
            </label>
          )}
          {(error || saveError) && (
            <div className="live-error" role="alert">
              <ErrorMessage error={error || saveError} />
            </div>
          )}
          <div className="modal-actions">
            <button className="button button-quiet" onClick={onCancel}>
              {t('introductionEditor.cancel')}
            </button>
            <button
              className="button button-primary"
              disabled={saving || (live && !confirmOverwrite)}
              onClick={() => onSave(markdown)}
            >
              {t('introductionEditor.saveIntroduction')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
