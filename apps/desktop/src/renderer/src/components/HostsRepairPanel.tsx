import { formatDateTime } from '../format';
import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Globe2, LoaderCircle, RotateCw, X } from 'lucide-react';
import type { GitHubProxyStatus } from '@easyhub/types';
import type { Language } from '../i18n';

type Operation = 'toggle' | 'refresh' | 'cleanup';

export function HostsRepairPanel({ language, disabled = false }: { language: Language; disabled?: boolean }) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [status, setStatus] = useState<GitHubProxyStatus | null>(null);
  const [loading, setLoading] = useState(!disabled);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const operation = useRef(0);
  const mounted = useRef(true);
  const cleanupButton = useRef<HTMLButtonElement>(null);
  const cleanupDialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current += 1;
    };
  }, []);

  useEffect(() => {
    if (disabled) return;
    let active = true;
    setLoading(true);
    setError('');
    const bridge = easyHub;
    if (!bridge) {
      setLoading(false);
      setError(t('hostsRepairPanel.couldNotLoadConnectionSettingsPleaseRetry'));
      return;
    }
    void bridge
      .githubProxyStatus()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active) setError(t('hostsRepairPanel.couldNotLoadConnectionSettingsPleaseRetry'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [disabled, language]);

  // Show connection results and notice when another app takes over the system proxy.
  useEffect(() => {
    if ((!busy && status?.state !== 'checking' && !status?.enabled) || busy === 'cleanup' || disabled || !easyHub)
      return;
    let active = true;
    let pending = false;
    const timer = window.setInterval(
      () => {
        if (pending) return;
        pending = true;
        void easyHub
          ?.githubProxyStatus()
          .then((value) => {
            if (active && value) setStatus(value);
          })
          .catch(() => undefined)
          .finally(() => {
            pending = false;
          });
      },
      busy || status?.state === 'checking' ? 600 : 5000,
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [busy, disabled, status?.enabled, status?.state]);

  useEffect(() => {
    if (!confirmCleanup) return;
    cleanupDialog.current?.querySelector<HTMLButtonElement>('[data-cancel-cleanup]')?.focus();
    return () => {
      cleanupButton.current?.focus();
    };
  }, [confirmCleanup]);

  async function reload(): Promise<void> {
    if (disabled || loading || busy || !easyHub) return;
    setLoading(true);
    setError('');
    const id = ++operation.current;
    try {
      const value = await easyHub.githubProxyStatus();
      if (mounted.current && operation.current === id) setStatus(value);
    } catch {
      if (mounted.current && operation.current === id)
        setError(t('hostsRepairPanel.couldNotLoadConnectionSettingsPleaseRetry'));
    } finally {
      if (mounted.current && operation.current === id) setLoading(false);
    }
  }

  async function act(kind: Operation): Promise<void> {
    const bridge = easyHub;
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
      if (!mounted.current || operation.current !== id) return;
      let latest: GitHubProxyStatus | null = null;
      try {
        latest = await bridge.githubProxyStatus();
        if (mounted.current && operation.current === id) setStatus(latest);
      } catch {
        /* Keep the last known state when reading the updated settings fails. */
      }
      if (mounted.current && operation.current === id)
        setError(
          kind === 'cleanup'
            ? t('hostsRepairPanel.couldNotRemoveThePreviousRepairAllowWindowsApproval')
            : kind === 'toggle'
              ? latest?.enabled && latest.system?.mode === 'unavailable'
                ? t('hostsRepairPanel.systemProxySettingsHaveNotBeenRestoredAndThe')
                : t('hostsRepairPanel.couldNotUpdateTheSystemProxyCheckYourSystem')
              : t('hostsRepairPanel.couldNotConnectToGithubCheckYourConnectionAnd'),
        );
    } finally {
      if (mounted.current && operation.current === id) setBusy(null);
    }
  }

  async function cancel(): Promise<void> {
    const bridge = easyHub;
    if (!bridge || (!busy && status?.state !== 'checking') || busy === 'cleanup') return;
    const id = ++operation.current;
    setBusy(null);
    setError('');
    try {
      await bridge.githubProxyCancel();
      const value = await bridge.githubProxyStatus();
      if (mounted.current && operation.current === id) setStatus(value);
    } catch {
      if (mounted.current && operation.current === id)
        setError(t('hostsRepairPanel.couldNotReadConnectionStatusPleaseRetry'));
    }
  }

  const checking = loading || Boolean(busy && busy !== 'cleanup') || status?.state === 'checking';
  const stateText = disabled
    ? t('hostsRepairPanel.unavailableInDemo')
    : busy === 'cleanup'
      ? t('hostsRepairPanel.removingThePreviousRepair')
      : checking
        ? t('hostsRepairPanel.checkingConnection')
        : !status
          ? t('hostsRepairPanel.connectionStatusUnavailable')
          : status.system?.mode === 'unavailable'
            ? t('hostsRepairPanel.systemProxyUnavailable')
            : status.enabled && status.system?.mode === 'existing'
              ? t('hostsRepairPanel.usingTheExistingSystemProxy')
              : status.enabled && status.system?.mode === 'external'
                ? t('hostsRepairPanel.anotherProxyHasTakenOver')
                : status.enabled && status.system?.mode === 'managed'
                  ? t('hostsRepairPanel.systemProxyEnabled')
                  : status.state === 'error'
                    ? t('hostsRepairPanel.connectionUnsuccessful')
                    : status.enabled && status.state === 'ready'
                      ? t('hostsRepairPanel.onConnected')
                      : status.enabled
                        ? t('hostsRepairPanel.on')
                        : t('hostsRepairPanel.off');
  const connectionError =
    error ||
    (status?.system?.error || status?.system?.mode === 'unavailable'
      ? t('hostsRepairPanel.couldNotUpdateTheSystemProxyCheckYourSystem')
      : status?.state === 'error'
        ? t('hostsRepairPanel.couldNotConnectToGithubCheckYourConnectionAnd')
        : '');
  const targets = [
    { target: 'login', label: t('hostsRepairPanel.signIn') },
    { target: 'api', label: t('hostsRepairPanel.projects') },
    { target: 'download', label: t('hostsRepairPanel.downloads') },
  ] as const;

  return (
    <section className="panel settings-panel github-proxy-panel" aria-busy={checking || busy === 'cleanup'}>
      <div className="settings-icon blue">
        <Globe2 size={22} />
      </div>
      <div className="settings-panel-content">
        <div className="github-proxy-heading">
          <div>
            <h2>{t('hostsRepairPanel.githubSystemProxy')}</h2>
            <p>
              {t(
                easyHub?.platform === 'darwin'
                  ? 'mac.systemProxyDescription'
                  : 'hostsRepairPanel.connectEasyhubAndBrowsersThatUseWindowsSystemProxy',
              )}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label={t('hostsRepairPanel.githubSystemProxy')}
            aria-checked={status?.enabled ?? false}
            className={`easyhub-switch ${status?.enabled ? 'is-on' : ''}`}
            disabled={disabled || Boolean(busy) || loading || !status}
            onClick={() => void act('toggle')}
          >
            <span />
          </button>
        </div>
        <div className="github-proxy-connection">
          <span
            className={`github-proxy-status ${!checking && status?.state === 'ready' && status.system?.mode !== 'unavailable' && status.system?.mode !== 'external' ? 'is-ready' : ''}`}
            role="status"
            aria-live="polite"
          >
            {checking ? <LoaderCircle size={15} className="live-spin" /> : <span className="github-proxy-status-dot" />}
            {stateText}
          </span>
          {!disabled && status && (checking || status.checks.length > 0) && (
            <ul className="github-proxy-checks" aria-label={t('hostsRepairPanel.connectionChecks')}>
              {targets.map(({ target, label }) => {
                const result = status.checks.find((value) => value.target === target);
                return (
                  <li key={target} className={result ? (result.ok ? 'is-ok' : 'is-failed') : ''}>
                    {result ? result.ok ? <Check size={13} /> : <X size={13} /> : <Circle size={10} />}
                    <span>{label}</span>
                    <span className="github-proxy-check-accessible">
                      {result
                        ? result.ok
                          ? t('hostsRepairPanel.connected')
                          : t('hostsRepairPanel.notConnected')
                        : t('hostsRepairPanel.waiting')}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {!disabled && (
        <div className="github-proxy-actions">
          {(busy && busy !== 'cleanup') || status?.state === 'checking' ? (
            <button type="button" className="button button-quiet" onClick={() => void cancel()}>
              {t('hostsRepairPanel.cancel')}
            </button>
          ) : !status ? (
            <button type="button" className="button button-quiet" disabled={loading} onClick={() => void reload()}>
              <RotateCw size={15} />
              {t('hostsRepairPanel.retry')}
            </button>
          ) : (
            <button
              type="button"
              className="button button-quiet"
              disabled={Boolean(busy) || loading}
              onClick={() => void act('refresh')}
            >
              <RotateCw size={15} />
              {t('hostsRepairPanel.testConnection')}
            </button>
          )}
        </div>
          )}
        </div>
        {connectionError && (
          <p className="github-proxy-error" role="alert">
            <ErrorMessage error={connectionError} />
          </p>
        )}
        {!disabled && status?.checkedAt && !Number.isNaN(Date.parse(status.checkedAt)) && (
          <p className="github-proxy-last-check">
            {t('hostsRepairPanel.checkedAt', {
              p0: t('hostsRepairPanel.lastChecked'),
              p1: formatDateTime(status.checkedAt, language),
            })}
          </p>
        )}
        {!disabled && status?.legacyHosts && (
          <div className="github-proxy-legacy">
            <div>
              <strong>{t('hostsRepairPanel.previousConnectionRepairFound')}</strong>
              <p>{t('hostsRepairPanel.removeThePreviousRepairToUseTheseConnectionSettings')}</p>
            </div>
            <button
              ref={cleanupButton}
              type="button"
              className="button button-quiet"
              disabled={Boolean(busy) || loading}
              onClick={() => setConfirmCleanup(true)}
            >
              {t('hostsRepairPanel.removePreviousRepair')}
            </button>
          </div>
        )}
      </div>
      {confirmCleanup && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmCleanup(false);
          }}
        >
          <div
            ref={cleanupDialog}
            className="modal github-proxy-cleanup-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="github-proxy-cleanup-title"
            aria-describedby="github-proxy-cleanup-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setConfirmCleanup(false);
              }
              if (event.key === 'Tab') {
                const buttons = cleanupDialog.current?.querySelectorAll<HTMLButtonElement>('button');
                if (!buttons?.length) return;
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (!first || !last) return;
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <h2 id="github-proxy-cleanup-title">{t('hostsRepairPanel.removeThePreviousRepair')}</h2>
            <p id="github-proxy-cleanup-description">
              {t('hostsRepairPanel.windowsAdministratorApprovalIsRequiredOnlySystemConnectionSettings')}
            </p>
            <div className="modal-actions">
              <button
                data-cancel-cleanup
                type="button"
                className="button button-quiet"
                onClick={() => setConfirmCleanup(false)}
              >
                {t('hostsRepairPanel.cancel')}
              </button>
              <button type="button" className="button button-primary" onClick={() => void act('cleanup')}>
                {t('hostsRepairPanel.remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
