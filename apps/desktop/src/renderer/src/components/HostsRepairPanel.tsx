import { useEffect, useState } from 'react';
import { ExternalLink, Globe2, RotateCw } from 'lucide-react';
import type { Language } from '../i18n';

interface Status { enabled: boolean; updatedAt: string | null; source: string }

export function HostsRepairPanel({ language, disabled = false }: { language: Language; disabled?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;

  useEffect(() => {
    if (disabled) return;
    let active = true;
    void window.easyHub?.hostsStatus().then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setError(t('无法读取系统 Hosts 状态。', 'Could not read system Hosts status.')); });
    return () => { active = false; };
  }, [disabled, language]);

  async function act(kind: 'toggle' | 'refresh'): Promise<void> {
    if (!window.easyHub || !status || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = kind === 'refresh' ? await window.easyHub.hostsRefresh() : await window.easyHub.hostsSetEnabled(!status.enabled);
      setStatus(next);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /u, '') : '';
      setError(detail || t('无法修改系统 Hosts，请稍后重试。', 'Could not update system Hosts. Please try again.'));
    } finally { setBusy(false); }
  }

  return <section className="panel settings-panel hosts-repair-panel">
    <div className="settings-icon blue"><Globe2 size={22} /></div>
    <div className="settings-panel-content">
      <div className="hosts-repair-heading">
        <div><h2>{t('Hosts 修复', 'Hosts repair')}</h2>
          <p>{t('访问不了 GitHub 时，可以试试打开这个开关。', 'If you cannot reach GitHub, try turning on this switch.')}</p></div>
        <button type="button" role="switch" aria-label={t('Hosts 修复', 'Hosts repair')} aria-checked={status?.enabled ?? false}
          className={`easyhub-switch ${status?.enabled ? 'is-on' : ''}`} disabled={disabled || busy || !status}
          onClick={() => void act('toggle')}><span /></button>
      </div>
      <p className="hosts-repair-explain">{t(
        '开启后，EasyHub 会更新这台电脑的 GitHub 访问地址。需要 Windows 管理员授权，且会影响整台电脑；关闭时只移除 EasyHub 添加的内容。',
        'EasyHub will update this computer’s GitHub addresses. Windows administrator approval is required, and the change affects the whole computer. Turning it off removes only entries added by EasyHub.')}</p>
      <div className="hosts-repair-footer">
        <span className="hosts-repair-status">{disabled ? t('演示版不可用', 'Unavailable in demo') : status?.enabled ? t('已开启', 'On') : t('已关闭', 'Off')}
          {status?.updatedAt && ` · ${t('上次更新', 'Last updated')} ${new Date(status.updatedAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')}`}</span>
        <div className="hosts-repair-actions">
          <button type="button" className="text-link" onClick={() => void window.easyHub?.openExternalLink('https://github.com/maxiaof/github-hosts')}>
            {t('查看地址来源', 'View address source')} <ExternalLink size={14} /></button>
          {status?.enabled && <button type="button" className="button button-quiet" disabled={busy} onClick={() => void act('refresh')}>
            <RotateCw size={15} className={busy ? 'live-spin' : ''} />{t('立即更新', 'Update now')}</button>}
        </div>
      </div>
      {error && <p className="hosts-repair-error" role="alert">{error}</p>}
    </div>
  </section>;
}
