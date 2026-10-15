import { useTranslation } from '../localization';
import { friendlyError, readAppError } from '../errors';
import React, { useContext, useEffect, useId, useState } from 'react';
import { LanguageContext, readLanguage, type Language } from '../i18n';
export function ErrorMessage({ error, language: explicitLanguage }: { error: unknown; language?: Language }) {
  const currentLanguage = useContext(LanguageContext);
  const language = explicitLanguage ?? currentLanguage ?? readLanguage();
  const t = useTranslation(language);
  const message = friendlyError(error, language);
  const { detail } = readAppError(error);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => setOpen(false), [detail]);
  return (
    <span className="friendly-error">
      <span>{message}</span>
      {detail !== message && (
        <>
          <button
            type="button"
            className="text-link error-details-toggle"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((value) => !value)}
          >
            {t('errorMessage.viewDetails')}
          </button>
          <span id={id} className="error-details" data-content-original hidden={!open}>
            {detail}
          </span>
        </>
      )}
    </span>
  );
}
