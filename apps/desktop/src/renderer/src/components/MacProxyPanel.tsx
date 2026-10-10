import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Globe2, RotateCw } from 'lucide-react';
import type { MacProxySnapshot } from '../global';
import type { Language } from '../i18n';

export function MacProxyPanel({ language }: { language: Language }) {
  const [snapshot, setSnapshot] = useState<MacProxySnapshot | null>(null);
  const [action, setAction] = useState<'toggle' | 'probe' | 'settings' | null>(null);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const connected = snapshot?.status === 'connected';
  const enabled = connected || snapshot?.status === 'connecting';
  const busy = action !== null || snapshot?.status === 'connecting' || snapshot?.status === 'disconnecting';

  useEffect(() => {
    const api = window.easyHub?.macProxy;
    if (!api) return;
    let active = true;
    const initialRevision = revision.current;
    const stop = api.onChanged((value) => { if (active) { revision.current += 1; setSnapshot(value); } });
    void api.status().then((value) => { if (active && revision.current === initialRevision) setSnapshot(value); })
      .catch(() => { if (active) setError(t('无法读取 GitHub 代理状态，请重新启动 EasyHub。', 'Could not read GitHub proxy status. Restart EasyHub.')); });
    return () => { active = false; stop(); };
  }, [language]);

  async function act(kind: 'toggle' | 'probe' | 'settings'): Promise<void> {
    const api = window.easyHub?.macProxy;
    if (!api || !snapshot || busy) return;
    setAction(kind);
    setError('');
    const initialRevision = revision.current;
    try {
      const next = kind === 'toggle' ? await api.setEnabled(!enabled)
        : kind === 'probe' ? await api.probe() : await api.openSettings();
      if (revision.current === initialRevision) setSnapshot(next);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /u, '') : '';
      setError(detail || t('代理操作失败，请重试。', 'The proxy operation failed. Try again.'));
      void api.status().then(setSnapshot).catch(() => undefined);
    } finally { setAction(null); }
  }

  function statusText(): string {
    switch (snapshot?.status) {
      case 'connected': return t('本地 GitHub 代理已连接', 'Local GitHub proxy connected');
      case 'connecting': return t('正在连接…', 'Connecting…');
      case 'disconnecting': return t('正在断开…', 'Disconnecting…');
      case 'unavailable': return t('本地代理暂不可用', 'Local proxy unavailable');
      case 'disconnected': return t('本地 GitHub 代理未连接', 'Local GitHub proxy disconnected');
      default: return t('正在读取代理状态…', 'Reading proxy status…');
    }
  }

  return <section className="panel settings-panel hosts-repair-panel" aria-label={t('GitHub 代理', 'GitHub proxy')}>
    <div className="settings-icon blue"><Globe2 size={22} /></div>
    <div className="settings-panel-content">
      <div className="hosts-repair-heading">
        <div><h2>{t('GitHub 代理', 'GitHub proxy')}</h2>
          <p>{t('基于 SteamTools 公开规则，在本机转发 GitHub 网络。', 'Route GitHub connections locally using public SteamTools rules.')}</p></div>
        <button type="button" role="switch" aria-label={t('GitHub 代理', 'GitHub proxy')} aria-checked={enabled}
          className={`easyhub-switch ${enabled ? 'is-on' : ''}`}
          disabled={busy || !snapshot || snapshot.status === 'unavailable'} onClick={() => void act('toggle')}><span /></button>
      </div>
      <p className="hosts-repair-explain">{t(
        '连接后，EasyHub 的 GitHub 请求自动使用本地代理。此开关不会修改系统网络设置；其他应用需要手动配置下方 PAC 地址。',
        'When connected, EasyHub routes its GitHub requests through the local proxy. This switch does not change system network settings; other apps need the PAC URL below configured manually.')}</p>
      {snapshot && <label className="field" htmlFor="mac-proxy-pac-url">
        <span>{t('系统自动代理 PAC 地址', 'System automatic proxy PAC URL')}</span>
        <input id="mac-proxy-pac-url" aria-label={t('PAC 地址', 'PAC URL')} readOnly value={snapshot.pacURL}
          onFocus={(event) => event.currentTarget.select()} />
      </label>}
      <p className="hosts-repair-explain">{t(
        '系统 PAC 仅对 Safari、WebKit 和遵循自动代理设置的应用生效。Git、SSH 和部分自行联网的应用可能忽略 PAC。地址只在本地代理连接期间可用；断开或退出前，请移除你手动设置的系统 PAC。',
        'System PAC applies to Safari, WebKit and apps that honor automatic proxy settings. Git, SSH and some apps may ignore PAC. The URL is available only while the local proxy is connected. Remove any manually configured system PAC before disconnecting or quitting.')}</p>
      <div className="hosts-repair-footer">
        <span className="hosts-repair-status" role="status">{statusText()}
          {snapshot?.domains !== undefined && ` · ${t(`${snapshot.domains} 条 GitHub 规则`, `${snapshot.domains} GitHub rules`)}`}
          {snapshot?.lastProbe && <><br />{snapshot.lastProbe}</>}
        </span>
        <div className="hosts-repair-actions">
          <button type="button" className="button button-quiet" disabled={!connected || busy} onClick={() => void act('probe')}>
            <RotateCw size={15} className={action === 'probe' ? 'live-spin' : undefined} />{t('检测 GitHub 连接', 'Check GitHub connection')}</button>
          <button type="button" className="button button-quiet" disabled={!connected || busy} onClick={() => void act('settings')}>
            {t('打开系统代理设置', 'Open system proxy settings')} <ExternalLink size={14} /></button>
        </div>
      </div>
      {(error || snapshot?.error) && <p className="hosts-repair-error" role="alert">{error || snapshot?.error}</p>}
    </div>
  </section>;
}
