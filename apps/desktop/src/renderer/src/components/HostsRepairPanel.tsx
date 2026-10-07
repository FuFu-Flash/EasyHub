import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Globe2, LoaderCircle, RotateCw, X } from 'lucide-react';
import type { GitHubProxyStatus } from '@easyhub/types';
import type { Language } from '../i18n';

type Operation = 'toggle' | 'refresh' | 'cleanup';

export function HostsRepairPanel({ language, disabled = false }: { language: Language; disabled?: boolean }) {
  const [status, setStatus] = useState<GitHubProxyStatus | null>(null);
  const [loading, setLoading] = useState(!disabled);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const operation = useRef(0);
  const mounted = useRef(true);
  const cleanupButton = useRef<HTMLButtonElement>(null);
  const cleanupDialog = useRef<HTMLDivElement>(null);
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current += 1; };
  }, []);

  useEffect(() => {
    if (disabled) return;
    let active = true;
    setLoading(true);
    setError('');
    const bridge = window.easyHub;
    if (!bridge) {
      setLoading(false);
      setError(t('无法读取连接设置，请重试。', 'Could not load connection settings. Please retry.'));
      return;
    }
    void bridge.githubProxyStatus().then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setError(t('无法读取连接设置，请重试。', 'Could not load connection settings. Please retry.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [disabled, language]);

  // Show individual connection results as they become available.
  useEffect(() => {
    if ((!busy && status?.state !== 'checking') || busy === 'cleanup' || disabled || !window.easyHub) return;
    let active = true;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void window.easyHub?.githubProxyStatus().then((value) => { if (active && value) setStatus(value); })
        .catch(() => undefined).finally(() => { pending = false; });
    }, 600);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy, disabled, status?.state]);

  useEffect(() => {
    if (!confirmCleanup) return;
    cleanupDialog.current?.querySelector<HTMLButtonElement>('[data-cancel-cleanup]')?.focus();
    return () => { cleanupButton.current?.focus(); };
  }, [confirmCleanup]);

  async function reload(): Promise<void> {
    if (disabled || loading || busy || !window.easyHub) return;
    setLoading(true);
    setError('');
    const id = ++operation.current;
    try {
      const value = await window.easyHub.githubProxyStatus();
      if (mounted.current && operation.current === id) setStatus(value);
    } catch {
      if (mounted.current && operation.current === id) setError(t('无法读取连接设置，请重试。', 'Could not load connection settings. Please retry.'));
    } finally {
      if (mounted.current && operation.current === id) setLoading(false);
    }
  }

  async function act(kind: Operation): Promise<void> {
    const bridge = window.easyHub;
    if (disabled || !bridge || !status || busy || loading) return;
    const id = ++operation.current;
    setBusy(kind);
    setError('');
    setConfirmCleanup(false);
    try {
      let value: GitHubProxyStatus;
      if (kind === 'cleanup') {
        await bridge.hostsSetEnabled(false);
        value = await bridge.githubProxyStatus();
      } else if (kind === 'refresh') {
        value = await bridge.githubProxyRefresh();
      } else {
        value = await bridge.githubProxySetEnabled(!status.enabled);
      }
      if (mounted.current && operation.current === id) setStatus(value);
    } catch {
      if (mounted.current && operation.current === id) setError(kind === 'cleanup'
        ? t('旧版修复未能移除，请允许 Windows 授权后重试。', 'Could not remove the previous repair. Allow Windows approval and try again.')
        : t('暂时无法连接 GitHub，请检查网络后重试。', 'Could not connect to GitHub. Check your connection and try again.'));
    } finally {
      if (mounted.current && operation.current === id) setBusy(null);
    }
  }

  async function cancel(): Promise<void> {
    const bridge = window.easyHub;
    if (!bridge || (!busy && status?.state !== 'checking') || busy === 'cleanup') return;
    const id = ++operation.current;
    setBusy(null);
    setError('');
    try {
      await bridge.githubProxyCancel();
      const value = await bridge.githubProxyStatus();
      if (mounted.current && operation.current === id) setStatus(value);
    } catch {
      if (mounted.current && operation.current === id) setError(t('无法读取连接状态，请重试。', 'Could not read connection status. Please retry.'));
    }
  }

  const checking = loading || Boolean(busy && busy !== 'cleanup') || status?.state === 'checking';
  const stateText = disabled ? t('演示版不可用', 'Unavailable in demo')
    : busy === 'cleanup' ? t('正在移除旧版修复…', 'Removing the previous repair…')
    : checking ? t('正在检查连接…', 'Checking connection…')
    : !status ? t('连接状态暂不可用', 'Connection status unavailable')
    : status.state === 'error' ? t('连接未成功', 'Connection unsuccessful')
    : status.enabled && status.state === 'ready' ? t('已开启，连接正常', 'On · Connected')
    : status.enabled ? t('已开启', 'On') : t('已关闭', 'Off');
  const connectionError = error || (status?.state === 'error'
    ? t('暂时无法连接 GitHub，请检查网络后重试。', 'Could not connect to GitHub. Check your connection and try again.') : '');
  const targets = [
    { target: 'login', label: t('登录', 'Sign in') },
    { target: 'api', label: t('项目', 'Projects') },
    { target: 'download', label: t('下载', 'Downloads') },
  ] as const;

  return <section className="panel settings-panel github-proxy-panel" aria-busy={checking || busy === 'cleanup'}>
    <div className="settings-icon blue"><Globe2 size={22} /></div>
    <div className="settings-panel-content">
      <div className="github-proxy-heading">
        <div><h2>{t('GitHub 代理', 'GitHub proxy')}</h2>
          <p>{t('帮助 EasyHub 连接 GitHub，浏览项目和下载文件。', 'Help EasyHub connect to GitHub to browse projects and download files.')}</p></div>
        <button type="button" role="switch" aria-label={t('GitHub 代理', 'GitHub proxy')} aria-checked={status?.enabled ?? false}
          className={`easyhub-switch ${status?.enabled ? 'is-on' : ''}`} disabled={disabled || Boolean(busy) || loading || !status}
          onClick={() => void act('toggle')}><span /></button>
      </div>
      <p className="github-proxy-explain">{t('仅用于 EasyHub，不改变电脑中其他应用的网络设置。', 'Only applies to EasyHub. Other apps keep their network settings.')}</p>
      <div className="github-proxy-connection">
        <span className={`github-proxy-status ${!checking && status?.state === 'ready' ? 'is-ready' : ''}`} role="status" aria-live="polite">
          {checking ? <LoaderCircle size={15} className="live-spin" /> : <span className="github-proxy-status-dot" />}{stateText}
        </span>
        {!disabled && status && (checking || status.checks.length > 0) && <ul className="github-proxy-checks" aria-label={t('连接检查', 'Connection checks')}>
          {targets.map(({ target, label }) => {
            const result = status.checks.find((value) => value.target === target);
            return <li key={target} className={result ? result.ok ? 'is-ok' : 'is-failed' : ''}>
              {result ? result.ok ? <Check size={13} /> : <X size={13} /> : <Circle size={10} />}
              <span>{label}</span><span className="github-proxy-check-accessible">{result ? result.ok ? t('连接正常', 'Connected') : t('未连接', 'Not connected') : t('等待检查', 'Waiting')}</span>
            </li>;
          })}
        </ul>}
      </div>
      {connectionError && <p className="github-proxy-error" role="alert">{connectionError}</p>}
      {!disabled && <div className="github-proxy-footer">
        <span className="github-proxy-last-check">{status?.checkedAt && !Number.isNaN(Date.parse(status.checkedAt))
          ? `${t('上次检查', 'Last checked')} ${new Date(status.checkedAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')}` : ''}</span>
        <div className="github-proxy-actions">
          {(busy && busy !== 'cleanup') || status?.state === 'checking' ? <button type="button" className="button button-quiet" onClick={() => void cancel()}>{t('取消', 'Cancel')}</button>
            : !status ? <button type="button" className="button button-quiet" disabled={loading} onClick={() => void reload()}><RotateCw size={15} />{t('重新读取', 'Retry')}</button>
            : <button type="button" className="button button-quiet" disabled={Boolean(busy) || loading} onClick={() => void act('refresh')}><RotateCw size={15} />{t('测试连接', 'Test connection')}</button>}
        </div>
      </div>}
      {!disabled && status?.legacyHosts && <div className="github-proxy-legacy">
        <div><strong>{t('检测到旧版连接修复', 'Previous connection repair found')}</strong>
          <p>{t('可以移除旧版修复，改用这里的连接设置。', 'Remove the previous repair to use these connection settings.')}</p></div>
        <button ref={cleanupButton} type="button" className="button button-quiet" disabled={Boolean(busy) || loading} onClick={() => setConfirmCleanup(true)}>{t('移除旧版修复', 'Remove previous repair')}</button>
      </div>}
    </div>
    {confirmCleanup && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmCleanup(false); }}>
      <div ref={cleanupDialog} className="modal github-proxy-cleanup-modal" role="alertdialog" aria-modal="true" aria-labelledby="github-proxy-cleanup-title" aria-describedby="github-proxy-cleanup-description"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); setConfirmCleanup(false); }
          if (event.key === 'Tab') {
            const buttons = cleanupDialog.current?.querySelectorAll<HTMLButtonElement>('button');
            if (!buttons?.length) return;
            const first = buttons[0]; const last = buttons[buttons.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <h2 id="github-proxy-cleanup-title">{t('移除旧版修复？', 'Remove the previous repair?')}</h2>
        <p id="github-proxy-cleanup-description">{t('需要 Windows 管理员授权。只移除 EasyHub 之前添加的系统连接设置，不影响你自己添加的内容。', 'Windows administrator approval is required. Only system connection settings previously added by EasyHub will be removed. Your own entries are kept.')}</p>
        <div className="modal-actions"><button data-cancel-cleanup type="button" className="button button-quiet" onClick={() => setConfirmCleanup(false)}>{t('取消', 'Cancel')}</button>
          <button type="button" className="button button-primary" onClick={() => void act('cleanup')}>{t('确认移除', 'Remove')}</button></div>
      </div>
    </div>}
  </section>;
}
