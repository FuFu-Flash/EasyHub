import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { Language } from '../i18n';
import type { AppUpdateResult } from '../../../shared/appUpdate';

export function AppUpdatePanel({ language }: { language: Language }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AppUpdateResult | null>(null);
  const [error, setError] = useState('');
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  async function check(): Promise<void> {
    setBusy(true); setError(''); setResult(null);
    try {
      if (!window.easyHub) throw new Error('unavailable');
      setResult(await window.easyHub.github<AppUpdateResult>('appUpdate'));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(message.includes('没有发布可用的 macOS')
        ? t('暂时没有发布可用的 macOS 安装包，请使用项目提供的 Mac 下载路径。', 'No macOS installer has been published yet. Use the Mac download provided by the project.')
        : t('暂时无法检查更新，请稍后重试。', 'Unable to check for updates. Please try again later.'));
    }
    finally { setBusy(false); }
  }
  return <div className="app-update-panel">
    <button type="button" className="button button-quiet" disabled={busy} onClick={() => void check()}><RefreshCw size={15} />{busy ? t('正在检查…', 'Checking…') : t('检查更新', 'Check for updates')}</button>
    {result && <p role="status">{result.available ? t(`发现新版本 ${result.latestVersion}`, `Version ${result.latestVersion} is available`) : t('已是最新版本。', 'You are up to date.')}</p>}
    {result?.available && <button type="button" className="text-link" onClick={() => void window.easyHub?.openExternalLink(result.releaseUrl).catch(() => setError(t('无法打开下载页面。', 'Unable to open the download page.')))}><Download size={15} />{t('查看更新并下载', 'View update and download')}</button>}
    {error && <p className="live-error" role="alert">{error}</p>}
  </div>;
}
