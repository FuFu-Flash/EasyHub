import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BinaryAnalysisSettingsStatus } from '@easyhub/types';
import { readLanguage, type Language } from '../i18n';
import { consumeProgramReviewSettingsRequest, PROGRAM_REVIEW_COMPONENT_STATUS_CHANGED_EVENT, PROGRAM_REVIEW_SETTINGS_REQUEST_EVENT, useProgramReviewNotice } from '../programReviewNotice';
import { BinaryAnalysisPanel } from './BinaryAnalysisPanel';
import './aiReview.css';
import './binaryAnalysis.css';

export function BinaryAnalysisSettings({ disabled = false, language = readLanguage() }: { disabled?: boolean; language?: Language }) {
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
    return () => { window.cancelAnimationFrame(firstFrame); window.cancelAnimationFrame(secondFrame); };
  }, [expanded, directRequest]);
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const stateText = disabled ? t('演示版不可用', 'Unavailable in demo')
    : status?.state === 'installing' ? t('正在安装组件…', 'Installing components…')
    : status?.state === 'analyzing' ? t('正在提取程序内容…', 'Extracting program content…')
    : status?.state === 'error' ? t('组件需要检查 · 点击查看', 'Components need attention · view details')
    : status?.installed ? t('已就绪 · 审查本地程序文件', 'Ready · review a local program file')
    : t('可选 · 安装程序文件审查组件', 'Optional · install program review components');

  return <section ref={section} className="binary-settings-panel" aria-labelledby={headingId}>
    <div className="binary-settings-content">
      <div className="ai-settings-summary"><button ref={toggle} type="button" className="ai-settings-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}><span><h3 id={headingId}>{t('程序文件审查', 'Program file review')}</h3><small>{stateText}</small></span><ChevronDown size={19} className={expanded ? 'expanded' : ''} /></button></div>
      <div id={detailsId} hidden={!expanded} className="binary-settings-details">
        <p className="ai-settings-note">{t('与合并请求使用同一个 AI 服务。确认后自动提取程序内容并完成审查，提取证据收在审查结果中。', 'Uses the same AI provider as pull requests. After confirmation, program content is extracted and reviewed, with the evidence included in the review results.')}</p>
        <label className="binary-install-prompts"><input type="checkbox" checked={noticesEnabled} disabled={disabled} onChange={(event) => setNoticesEnabled(event.target.checked)} />{t('显示组件安装提示', 'Show component installation prompts')}</label>
        <BinaryAnalysisPanel language={language} disabled={disabled} onStatusChanged={onStatusChanged} />
      </div>
    </div>
  </section>;
}
