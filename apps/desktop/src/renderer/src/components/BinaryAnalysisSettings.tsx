import { useTranslation } from '../localization';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BinaryAnalysisSettingsStatus } from '@easyhub/types';
import { readLanguage, type Language } from '../i18n';
import {
  consumeProgramReviewSettingsRequest,
  PROGRAM_REVIEW_COMPONENT_STATUS_CHANGED_EVENT,
  PROGRAM_REVIEW_SETTINGS_REQUEST_EVENT,
  useProgramReviewNotice,
} from '../programReviewNotice';
import { BinaryAnalysisPanel } from './BinaryAnalysisPanel';

export function BinaryAnalysisSettings({
  disabled = false,
  language = readLanguage(),
}: {
  disabled?: boolean;
  language?: Language;
}) {
  const t = useTranslation(language);
  const [expanded, setExpanded] = useState(consumeProgramReviewSettingsRequest);
  const [directRequest, setDirectRequest] = useState(0);
  const directFocusPending = useRef(expanded);
  const section = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<BinaryAnalysisSettingsStatus | null>(null);
  const { noticesEnabled, setNoticesEnabled } = useProgramReviewNotice();
  const onStatusChanged = useCallback((value: BinaryAnalysisSettingsStatus): void => {
    setStatus(value);
    window.dispatchEvent(new Event(PROGRAM_REVIEW_COMPONENT_STATUS_CHANGED_EVENT));
  }, []);
  const headingId = useId();
  const detailsId = useId();
  useEffect(() => {
    const onRequest = (): void => {
      if (!consumeProgramReviewSettingsRequest()) return;
      directFocusPending.current = true;
      setExpanded(true);
      setDirectRequest((value) => value + 1);
    };
    window.addEventListener(PROGRAM_REVIEW_SETTINGS_REQUEST_EVENT, onRequest);
    onRequest();
    return () => window.removeEventListener(PROGRAM_REVIEW_SETTINGS_REQUEST_EVENT, onRequest);
  }, []);
  useEffect(() => {
    if (!expanded || !directFocusPending.current) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (!section.current?.getClientRects().length) return;
        section.current.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        toggle.current?.focus({ preventScroll: true });
        directFocusPending.current = false;
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [expanded, directRequest]);

  const stateText = disabled
    ? t('binaryAnalysisSettings.unavailableInDemo')
    : status?.state === 'installing'
      ? t('binaryAnalysisSettings.installingComponents')
      : status?.state === 'analyzing'
        ? t('binaryAnalysisSettings.extractingProgramContent')
        : status?.state === 'error'
          ? t('binaryAnalysisSettings.componentsNeedAttentionViewDetails')
          : status?.installed
            ? t('binaryAnalysisSettings.readyReviewALocalProgramFile')
            : t('binaryAnalysisSettings.optionalInstallProgramReviewComponents');

  return (
    <section ref={section} className="binary-settings-panel" aria-labelledby={headingId}>
      <div className="binary-settings-content">
        <div className="ai-settings-summary">
          <button
            ref={toggle}
            type="button"
            className="ai-settings-toggle"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((value) => !value)}
          >
            <span>
              <h3 id={headingId}>{t('binaryAnalysisSettings.programFileReview')}</h3>
              <small>{stateText}</small>
            </span>
            <ChevronDown size={19} className={expanded ? 'expanded' : ''} />
          </button>
        </div>
        <div id={detailsId} hidden={!expanded} className="binary-settings-details">
          <label className="binary-install-prompts">
            <input
              type="checkbox"
              checked={noticesEnabled}
              disabled={disabled}
              onChange={(event) => setNoticesEnabled(event.target.checked)}
            />
            {t('binaryAnalysisSettings.showComponentInstallationPrompts')}
          </label>
          <BinaryAnalysisPanel language={language} disabled={disabled} onStatusChanged={onStatusChanged} />
        </div>
      </div>
    </section>
  );
}
