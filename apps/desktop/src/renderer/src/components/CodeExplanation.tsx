import { useNoticeState } from '../useNoticeState';
import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, X } from 'lucide-react';
import type { AiCodeExplanationRequest, AiCodeExplanationResult, AiSettingsStatus } from '@easyhub/types';
import type { Language } from '../i18n';
import { aiProvider } from '../../../shared/aiProviders';

/** Read only selected code text. Gutter numbers, signs and neighboring files are excluded. */
export function selectedCodeText(container: HTMLElement, selection: Selection | null): string {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return '';
  const range = selection.getRangeAt(0);
  // Native drags can start in a gutter, a section header or trailing whitespace.
  // Accept those endpoints within one diff, while extracting code elements only.
  const regionAt = (node: Node): Element | null => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest('[data-code-selection-region]') ?? null;
  const first = regionAt(range.startContainer); const last = regionAt(range.endContainer);
  if (!first || first !== last || !container.contains(first)) return '';
  const parts: string[] = [];
  for (const code of first.querySelectorAll('[data-explain-code]')) {
    if (!range.intersectsNode(code)) continue;
    const part = document.createRange(); part.selectNodeContents(code);
    if (code.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
    if (code.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
    parts.push(part.toString());
  }
  return parts.join('\n').trim();
}

interface Props { source: AiCodeExplanationRequest['source']; language: Language; children: ReactNode }
export function CodeExplanation(props: Props) {
  // File/revision/language changes dispose the old request and selected text together.
  return <CodeExplanationSession key={JSON.stringify([props.source, props.language])} {...props} />;
}

function CodeExplanationSession({ source, language, children }: Props) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const generation = useRef(0);
  const activeRequest = useRef<string | null>(null);
  const [selected, setSelected] = useState('');
  const [chosen, setChosen] = useState('');
  const [opened, setOpened] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<AiSettingsStatus | null>(null);
  const [result, setResult] = useState<AiCodeExplanationResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useNoticeState(language);
  

  useEffect(() => {
    const readSelection = (): void => { if (root.current) setSelected(selectedCodeText(root.current, window.getSelection())); };
    document.addEventListener('selectionchange', readSelection);
    return () => {
      document.removeEventListener('selectionchange', readSelection);
      generation.current++;
      if (activeRequest.current) void easyHub?.aiCancelReview(activeRequest.current).catch(() => undefined);
    };
  }, []);
  useEffect(() => { if (opened) dialog.current?.focus(); }, [opened]);

  function stop(): void {
    const requestId = activeRequest.current;
    generation.current++; activeRequest.current = null; setRunning(false);
    if (requestId) void easyHub?.aiCancelReview(requestId).catch(() => undefined);
  }
  function close(): void {
    stop(); setOpened(false); setPreparing(false);
    requestAnimationFrame(() => { (trigger.current ?? root.current)?.focus(); });
  }
  async function prepare(): Promise<void> {
    if (!selected || selected.length > 12_000 || preparing || running) return;
    const current = ++generation.current;
    setChosen(selected); setOpened(true); setPreparing(true); setResult(null); setError(''); setNotice(''); setSettings(null);
    try {
      const next = await easyHub!.aiSettings();
      if (current !== generation.current) return;
      if (!next.hasApiKey || !next.model) setError(t("codeExplanation.connectYourAiServiceInSettingsFirst"));
      else setSettings(next);
    } catch { if (current === generation.current) setError(t("codeExplanation.couldNotLoadAiSettingsPleaseTryAgain")); }
    finally { if (current === generation.current) setPreparing(false); }
  }
  async function explain(): Promise<void> {
    if (!settings || running || !chosen) return;
    const current = ++generation.current;
    const requestId = crypto.randomUUID(); activeRequest.current = requestId;
    setRunning(true); setResult(null); setError(''); setNotice('');
    try {
      const next = await easyHub!.aiExplainCode({ source, text: chosen, language, requestId, providerBaseUrl: settings.baseUrl, consentToSend: true });
      if (current === generation.current) setResult(next);
    } catch (cause) {
      if (current === generation.current) {
        const message = errorText(cause, '');
        setError(message || t("codeExplanation.couldNotExplainThisCodePleaseRetry"));
      }
    } finally { if (current === generation.current) { activeRequest.current = null; setRunning(false); } }
  }
  const provider = settings ? aiProvider(settings.providerId)?.name ?? settings.baseUrl : '';
  return <div ref={root} className="code-explanation" tabIndex={-1}>
    {children}
    {selected && <div className="code-explanation-tools"><span>{selected.length > 12_000 ? t("codeExplanation.selectASmallerCodeSnippet") : t("codeExplanation.codeSelected")}</span><button ref={trigger} type="button" className="button button-quiet" disabled={selected.length > 12_000 || opened} onMouseDown={(event) => event.preventDefault()} onClick={() => void prepare()}><Sparkles size={15} />{t("codeExplanation.explainWithAi")}</button></div>}
    {opened && createPortal(<div className="modal-backdrop code-explanation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} className="modal code-explanation-dialog" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
          const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')];
          const first = targets[0]; const last = targets.at(-1);
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
        <div className="code-explanation-heading"><h2 id={id}><Sparkles size={19} />{t("codeExplanation.aiCodeExplanation")}</h2><button type="button" className="icon-button" aria-label={t("codeExplanation.closeExplanation")} onClick={close}><X size={19} /></button></div>
        <p className="code-explanation-path" data-content-original>{source.path}</p>
        <details className="code-explanation-selection" open={!result}><summary>{t("codeExplanation.selectedCode")}</summary><pre data-content-original><code>{chosen}</code></pre></details>
        {preparing && <p role="status">{t("codeExplanation.loadingAiSettings")}</p>}
        {settings && !result && <p className="code-explanation-consent">{t("codeExplanation.onlyTheSelectedCodeAndFilenameWillBeSent")} <strong data-content-original>{provider} · {settings.model}</strong></p>}
        {running && <p role="status">{t("codeExplanation.explainingThisCode")}</p>}
        {notice && <p role="status">{notice}</p>}
        {error && <p className="live-error" role="alert"><ErrorMessage error={error} language={language} /></p>}
        {result && <div className="code-explanation-result" data-content-original><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
          img: ({ alt }) => <span>{alt ?? ''}</span>,
          a: ({ children: label }) => <span>{label}</span>,
        }}>{result.explanation}</ReactMarkdown></div>}
        <div className="modal-actions">{running ? <button type="button" className="button button-quiet" onClick={() => { stop(); setNotice(t("codeExplanation.explanationCancelled")); }}>{t("codeExplanation.cancelExplanation")}</button> : settings && !result && <button type="button" className="button button-primary" onClick={() => void explain()}>{error || notice ? t("codeExplanation.tryAgain") : t("codeExplanation.explainCode")}</button>}<button type="button" className="button button-quiet" onClick={close}>{t("codeExplanation.close")}</button></div>
      </div>
    </div>, document.body)}
  </div>;
}
