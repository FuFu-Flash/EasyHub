import { useEffect, useState } from 'react';
import type { LocalDiscoveryResult, LocalOperationProgress } from '@easyhub/types';
import { FolderSearch, Plus, RotateCw, X } from 'lucide-react';

interface Props { onAdded: () => Promise<void> }
let lastAutomaticScan = 0;

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /u, '') : '查找失败，请稍后重试。';
}

export function LocalDiscoveryPanel({ onAdded }: Props) {
  const [roots, setRoots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LocalOperationProgress | null>(null);
  const [result, setResult] = useState<LocalDiscoveryResult | null>(null);
  const [error, setError] = useState('');
  const api = window.easyHub;

  async function scan(): Promise<void> {
    if (!api) return;
    setBusy(true); setError(''); setProgress(null); setResult(null);
    try {
      const found = await api.localDiscoveryScan();
      setResult(found);
      await onAdded();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); setProgress(null); }
  }

  useEffect(() => {
    if (!api) return;
    let active = true;
    const stop = api.onLocalProgress((value) => { if (active) setProgress(value); });
    void api.localDiscoveryRoots().then((items) => {
      if (!active) return;
      setRoots(items);
      if (items.length > 0 && Date.now() - lastAutomaticScan > 10 * 60_000) {
        lastAutomaticScan = Date.now();
        void scan();
      }
    }).catch((cause) => { if (active) setError(errorText(cause)); });
    return () => { active = false; stop(); };
  }, []);

  async function chooseRoot(): Promise<void> {
    if (!api || busy) return;
    try {
      const path = await api.chooseFolder();
      if (!path) return;
      setRoots(await api.localDiscoveryAddRoot(path));
      lastAutomaticScan = Date.now();
      await scan();
    } catch (cause) { setError(errorText(cause)); }
  }

  async function removeRoot(path: string): Promise<void> {
    if (!api || busy) return;
    try { setRoots(await api.localDiscoveryRemoveRoot(path)); setResult(null); setError(''); }
    catch (cause) { setError(errorText(cause)); }
  }

  return <section className="panel local-discovery-panel">
    <div className="local-discovery-heading"><span className="local-discovery-icon"><FolderSearch size={21} /></span><div><h2>查找已有项目</h2><p>选择存放项目的文件夹。EasyHub 会识别属于你、且已连接 GitHub 的项目。</p></div><button className="button button-quiet" disabled={busy} onClick={() => void chooseRoot()}><Plus size={16} />添加查找位置</button></div>
    {roots.length > 0 && <div className="local-discovery-roots">{roots.map((root) => <span className="local-discovery-root" key={root} title={root}><span>{root}</span><button aria-label={`移除 ${root}`} title="移除查找位置" disabled={busy} onClick={() => void removeRoot(root)}><X size={14} /></button></span>)}</div>}
    <div className="local-discovery-footer">
      {busy ? <span className="muted"><RotateCw size={15} className="live-spin" />{progress?.phase ?? '正在查找已有项目…'}</span> : result ? <span className="muted">已添加 {result.added} 个项目；{result.alreadyAdded} 个此前已添加。{result.skipped > 0 ? `另外 ${result.skipped} 个未能确认，未自动加入。` : ''}{result.limited ? '查找范围较大，已达到本次检查上限。' : ''}</span> : <span className="muted">只检查你选择的位置，不修改项目文件。</span>}
      {busy ? <button className="text-link" onClick={() => void api?.localCancel()}>取消</button> : roots.length > 0 ? <button className="text-link" onClick={() => void scan()}>重新查找</button> : null}
    </div>
    {error && <p className="live-error" role="alert">{error}</p>}
  </section>;
}
