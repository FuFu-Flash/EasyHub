import { Check, FolderOpen, Globe2, LockKeyhole, Plus, X } from 'lucide-react';
import type { FormEvent } from 'react';
import type { FolderInspection } from '@easyhub/types';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';

/** New project form, either cloud-only or created from a chosen local folder. */
export function LocalCreateForm({
  language,
  createMode,
  inspection,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  isPrivate,
  onPrivateChange,
  busy,
  onChooseFolder,
  onClearFolder,
  onSubmit,
}: {
  language: Language;
  createMode: boolean;
  inspection: FolderInspection | null;
  name: string;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  isPrivate: boolean;
  onPrivateChange: (value: boolean) => void;
  busy: boolean;
  onChooseFolder: () => void;
  onClearFolder: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const t = useTranslation(language);
  return (
    <form className="panel live-form live-create-form" onSubmit={onSubmit}>
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
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('localWorkspace.shortDescription')}</span>
        <input
          aria-label={t('localWorkspace.shortDescription')}
          value={description}
          disabled={busy}
          maxLength={350}
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </label>
      <div className="field">
        <span>{createMode ? t('localWorkspace.localFolderOptional') : t('localWorkspace.localFolder')}</span>
        <div className="folder-field">
          <FolderOpen size={19} />
          <span title={inspection?.path ?? ''}>{inspection?.path || t('localWorkspace.noFolderSelected')}</span>
          <button type="button" className="button button-quiet" disabled={busy} onClick={onChooseFolder}>
            {t('localWorkspace.chooseFolder')}
          </button>
          {createMode && inspection && (
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={t('localWorkspace.clearFolder')}
              title={t('localWorkspace.clearFolder')}
              onClick={onClearFolder}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <span>{t('localWorkspace.whoCanSeeIt')}</span>
        <div className="choice-grid" role="group" aria-label={t('localWorkspace.whoCanSeeIt')}>
          <button
            type="button"
            className={`choice ${isPrivate ? 'chosen' : ''}`}
            aria-pressed={isPrivate}
            disabled={busy}
            onClick={() => onPrivateChange(true)}
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
            onClick={() => onPrivateChange(false)}
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
        disabled={busy || !name.trim() || (!createMode && !inspection) || inspection?.state === 'github'}
        type="submit"
      >
        <Plus size={17} />
        {t('localWorkspace.createProject')}
      </button>
    </form>
  );
}
