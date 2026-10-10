import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BinaryAnalysisSettingsStatus } from '@easyhub/types';
import { readLanguage, type Language } from '../i18n';
import { BinaryAnalysisPanel } from './BinaryAnalysisPanel';
import './aiReview.css';
import './binaryAnalysis.css';

export function BinaryAnalysisSettings({ disabled = false, language = readLanguage() }: { disabled?: boolean; language?: Language }) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<BinaryAnalysisSettingsStatus | null>(null);
  const headingId = useId();
  const detailsId = useId();
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const stateText = disabled ? t('演示版不可用', 'Unavailable in demo')
    : status?.state === 'installing' ? t('正在安装组件…', 'Installing components…')
    : status?.state === 'analyzing' ? t('正在提取程序内容…', 'Extracting program content…')
    : status?.state === 'error' ? t('组件需要检查 · 点击查看', 'Components need attention · view details')
    : status?.installed ? t('已就绪 · 审查本地程序文件', 'Ready · review a local program file')
    : t('可选 · 安装程序文件审查组件', 'Optional · install program review components');

  return <section className="binary-settings-panel" aria-labelledby={headingId}>
    <div className="binary-settings-content">
      <div className="ai-settings-summary"><button type="button" className="ai-settings-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}><span><h3 id={headingId}>{t('程序文件审查', 'Program file review')}</h3><small>{stateText}</small></span><ChevronDown size={19} className={expanded ? 'expanded' : ''} /></button></div>
      <div id={detailsId} hidden={!expanded} className="binary-settings-details">
        <p className="ai-settings-note">{t('与合并请求使用同一个 AI 服务。确认后自动提取程序内容并完成审查，提取证据收在审查结果中。', 'Uses the same AI provider as pull requests. After confirmation, program content is extracted and reviewed, with the evidence included in the review results.')}</p>
        <BinaryAnalysisPanel language={language} disabled={disabled} onStatusChanged={setStatus} />
      </div>
    </div>
  </section>;
}
