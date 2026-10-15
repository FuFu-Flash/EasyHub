import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, X } from 'lucide-react';
import type { AiCommitExplanationResult, AiSettingsStatus } from '@easyhub/types';
import type { Language } from '../i18n';
import { aiProvider } from '../../../shared/aiProviders';
import { useDialogFocus } from './useDialogFocus';

export function CommitExplanation(props: {
  owner: string;
  repo: string;
  sha: string;
  language: Language;
  disabled: boolean;
}) {
  return (
    <CommitExplanationSession key={JSON.stringify([props.owner, props.repo, props.sha, props.language])} {...props} />
  );
}
function CommitExplanationSession({
  owner,
  repo,
  sha,
  language,
  disabled,
}: {
  owner: string;
  repo: string;
  sha: string;
  language: Language;
  disabled: boolean;
}) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<AiSettingsStatus | null>(null);
  const [result, setResult] = useState<AiCommitExplanationResult | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const request = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const id = useId();

  function stop(): void {
    generation.current++;
    if (request.current) void easyHub?.aiCancelReview(request.current).catch(() => undefined);
    request.current = null;
    setRunning(false);
    setLoading(false);
  }
  function close(): void {
    stop();
    setOpen(false);
  }
  useDialogFocus(open, dialog, close, { fallbackFocus: () => trigger.current });
  useEffect(
    () => () => {
      generation.current++;
      if (request.current) void easyHub?.aiCancelReview(request.current).catch(() => undefined);
    },
    [],
  );
  async function prepare(): Promise<void> {
    if (open || disabled) return;
    setOpen(true);
    if (result) return;
    const current = ++generation.current;
    setLoading(true);
    setSettings(null);
    setError('');
    try {
      const next = await easyHub!.aiSettings();
      if (current !== generation.current) return;
      if (!next.hasApiKey || !next.model) setError(t('commitExplanation.connectYourAiServiceInSettingsFirst'));
      else setSettings(next);
    } catch {
      if (current === generation.current) setError(t('commitExplanation.couldNotLoadAiSettingsPleaseRetry'));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  async function explain(): Promise<void> {
    if (!settings || running || loading) return;
    const current = ++generation.current;
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setRunning(true);
    setError('');
    try {
      const next = await easyHub!.aiExplainCommit({
        owner,
        repo,
        sha,
        language,
        requestId,
        providerBaseUrl: settings.baseUrl,
        consentToSend: true,
      });
      if (current === generation.current) setResult(next);
    } catch (cause) {
      if (current === generation.current)
        setError(errorText(cause, t('commitExplanation.couldNotExplainTheseChangesPleaseRetry')));
    } finally {
      if (current === generation.current) {
        request.current = null;
        setRunning(false);
      }
    }
  }
  return (
    <>
      <button
        ref={trigger}
        className="button button-quiet"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => void prepare()}
      >
        <Sparkles size={16} />
        {t('commitExplanation.explainChanges')}
      </button>
      {open &&
        createPortal(
          <div
            className="modal-backdrop code-explanation-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <div
              className="modal code-explanation-dialog"
              ref={dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby={id}
              tabIndex={-1}
            >
              <div className="code-explanation-heading">
                <h2 id={id}>
                  <Sparkles size={19} />
                  {t('commitExplanation.changeExplanation')}
                </h2>
                <button className="icon-button" aria-label={t('commitExplanation.closeExplanation')} onClick={close}>
                  <X size={19} />
                </button>
              </div>
              <p className="code-explanation-path" data-content-original>
                {owner}/{repo} · {sha.slice(0, 8)}
              </p>
              {loading && <p role="status">{t('commitExplanation.loadingAiSettings')}</p>}
              {settings && !result && (
                <p className="code-explanation-consent">
                  {t('commitExplanation.sendThisCommitSMessageFilenamesAndCodeDiffs')}{' '}
                  <strong data-content-original>
                    {aiProvider(settings.providerId)?.name ?? settings.baseUrl} · {settings.model}
                  </strong>
                  。{t('commitExplanation.largeCommitsIncludeOnlySomeChanges')}
                </p>
              )}
              {running && <p role="status">{t('commitExplanation.explainingTheseChanges')}</p>}
              {error && (
                <p className="live-error" role="alert">
                  <ErrorMessage error={error} language={language} />
                </p>
              )}
              {result && (
                <>
                  <div className="code-explanation-result" data-content-original>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      skipHtml
                      components={{
                        img: ({ alt }) => <span>{alt ?? ''}</span>,
                        a: ({ children }) => <span>{children}</span>,
                      }}
                    >
                      {result.explanation}
                    </ReactMarkdown>
                  </div>
                  {result.partial && (
                    <p className="pull-review-note">
                      {t('commitExplanation.thisExplanationCoversOnlySuppliedChangesSomeContentIs')}
                    </p>
                  )}
                </>
              )}
              <div className="modal-actions">
                {running ? (
                  <button className="button button-quiet" onClick={stop}>
                    {t('commitExplanation.cancelExplanation')}
                  </button>
                ) : (
                  settings &&
                  !result && (
                    <button className="button button-primary" disabled={loading} onClick={() => void explain()}>
                      {error ? t('commitExplanation.retry') : t('commitExplanation.explainChanges2')}
                    </button>
                  )
                )}
                <button className="button button-quiet" onClick={close}>
                  {t('commitExplanation.close')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
