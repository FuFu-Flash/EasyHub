import { useTranslation } from '../localization';
import { useEffect, useRef } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { NoticeTimer } from '../noticeTimer';
import type { Language } from '../i18n';
import { ErrorMessage } from './ErrorMessage';
export function FeedbackNotice({
  message,
  kind = 'success',
  onClose,
  language,
  floating = false,
}: {
  message: string;
  kind?: 'success' | 'error';
  onClose: () => void;
  language: Language;
  floating?: boolean;
}) {
  const t = useTranslation(language);
  const timer = useRef<NoticeTimer | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const hovered = useRef(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!message) {
      hovered.current = false;
      focused.current = false;
      return;
    }
    if (kind === 'error') return;
    const next = new NoticeTimer(() => close.current());
    timer.current = next;
    if (hovered.current) next.pause('hover');
    if (focused.current) next.pause('focus');
    return () => {
      next.dispose();
      timer.current = null;
    };
  }, [message, kind]);
  if (!message) return null;
  return (
    <div
      className={`feedback-notice ${floating ? 'toast' : kind === 'error' ? 'live-error' : 'live-notice'}${kind === 'error' ? ' is-error' : ''}`}
      role="status"
      aria-live="polite"
      tabIndex={0}
      onMouseEnter={() => {
        hovered.current = true;
        timer.current?.pause('hover');
      }}
      onMouseLeave={() => {
        hovered.current = false;
        timer.current?.release('hover');
      }}
      onFocus={() => {
        focused.current = true;
        timer.current?.pause('focus');
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focused.current = false;
          timer.current?.release('focus');
        }
      }}
    >
      {kind === 'success' && <CheckCircle2 size={17} />}
      <span>{kind === 'error' ? <ErrorMessage error={message} language={language} /> : message}</span>
      <button
        type="button"
        className="icon-button"
        onClick={onClose}
        aria-label={t('feedbackNotice.dismissNotification')}
      >
        <X size={15} />
      </button>
    </div>
  );
}
