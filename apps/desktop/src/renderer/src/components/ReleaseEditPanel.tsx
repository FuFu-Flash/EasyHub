import { useEffect, useState } from 'react';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import { ImagePlus, Link2, Plus, Trash2, X } from 'lucide-react';
import type { GitHubCreatedRelease, GitHubRelease, GitHubRepo } from '@easyhub/github';
import type { PickedReleaseFile, ReleaseProgress } from '@easyhub/types';
import { readLanguage, translateText } from '../i18n';
import { createDraftKey, readDraft, removeDraft, writeDraft } from '../draftStore';
import { parseReleaseDraft } from '../releaseDraft';

const t = (value: string): string => translateText(value, readLanguage());
const errorText = (cause: unknown): string => cause instanceof Error ? cause.message : '操作失败，请重试。';

export function ReleaseEditPanel({ repo, release, draftAccount, onUpdated, onClose, onOpenLink }: {
  repo: GitHubRepo;
  draftAccount?: string;
  release: GitHubRelease;
  onUpdated: (value: GitHubCreatedRelease) => void;
  onClose: () => void;
  onOpenLink: (url: string) => void;
}) {
  const draftKey = draftAccount ? createDraftKey(draftAccount, repo.id, 'release-edit', release.id) : null;
  const [recovered] = useState(() => draftKey ? parseReleaseDraft(readDraft(draftKey)) : null);
  const [title, setTitle] = useState(recovered?.title ?? release.name ?? release.tag_name);
  const [body, setBody] = useState(recovered?.body ?? release.body ?? '');
  const [prerelease, setPrerelease] = useState(recovered?.prerelease ?? release.prerelease);
  const [preview, setPreview] = useState(false);
  const [files, setFiles] = useState<PickedReleaseFile[]>([]);
  const [confirmAsset, setConfirmAsset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<ReleaseProgress | null>(null);
  const [urlDialog, setUrlDialog] = useState<'link' | 'image' | null>(null);
  const [url, setUrl] = useState('');
  const [urlLabel, setUrlLabel] = useState('');

  useEffect(() => window.easyHub?.onReleaseProgress((value) => setProgress(value)), []);
  useEffect(() => {
    if (!draftKey) return;
    if (title === (release.name || release.tag_name) && body === (release.body || '') && prerelease === release.prerelease) removeDraft(draftKey);
    else writeDraft(draftKey, JSON.stringify({ title, body, prerelease }));
  }, [draftKey, title, body, prerelease, release.name, release.tag_name, release.body, release.prerelease]);

  const target = { owner: repo.owner.login, repo: repo.name, releaseId: release.id };
  const run = async (operation: () => Promise<GitHubCreatedRelease>, success: string): Promise<GitHubCreatedRelease | null> => {
    setBusy(true); setError(''); setNotice('');
    try { const updated = await operation(); onUpdated(updated); setNotice(success); return updated; }
    catch (cause) { setError(errorText(cause)); return null; }
    finally { setBusy(false); setProgress(null); }
  };

  const chooseFiles = async (): Promise<void> => {
    try {
      const picked = await window.easyHub!.chooseReleaseFiles(false);
      if (picked.length) setFiles((current) => [...current, ...picked]);
      setError('');
    } catch (cause) { setError(errorText(cause)); }
  };

  const addFiles = async (): Promise<void> => {
    if (!files.length) return;
    if (await run(() => window.easyHub!.addReleaseAssets({ ...target, assetIds: files.map((file) => file.id) }), '文件已添加到这个版本。')) setFiles([]);
  };

  const addImage = async (): Promise<void> => {
    try {
      const [picked] = await window.easyHub!.chooseReleaseFiles(true);
      if (!picked) return;
      const updated = await run(() => window.easyHub!.addReleaseAssets({ ...target, assetIds: [picked.id] }), '图片已添加到这个版本，请保存介绍。');
      if (!updated) return;
      const uploaded = updated.assets.find((asset) => !release.assets.some((existing) => existing.id === asset.id));
      if (!uploaded) { setError('图片已上传，但未能确认链接。请刷新版本列表后重试插入。'); return; }
      const link = `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/releases/download/${encodeURIComponent(updated.tag_name)}/${encodeURIComponent(uploaded.name)}`;
      setBody((current) => `${current.trimEnd()}\n\n![${uploaded.name.replace(/[\[\]\\]/g, '\\$&')}](${link})\n`.trimStart());
    } catch (cause) { setError(errorText(cause)); }
  };

  const save = async (): Promise<void> => {
    if (!title.trim()) { setError('请填写版本名称。'); return; }
    if (await run(() => window.easyHub!.editRelease({ ...target, title, body, prerelease }), '版本介绍已更新。')) { if (draftKey) removeDraft(draftKey); }
  };

  const remove = async (assetId: number): Promise<void> => {
    if (await run(() => window.easyHub!.removeReleaseAsset({ ...target, assetId }), '文件已从这个版本移除。')) setConfirmAsset(null);
  };

  const insertUrl = (): void => {
    let valid: URL;
    try { valid = new URL(url.trim()); } catch { setError('请输入有效链接。'); return; }
    if (!['https:', 'http:'].includes(valid.protocol)) { setError('请输入有效链接。'); return; }
    const safeLabel = (urlLabel.trim() || (urlDialog === 'image' ? '图片' : '链接')).replace(/[\[\]\\]/g, '\\$&');
    setBody((current) => `${current.trimEnd()}\n\n${urlDialog === 'image' ? '!' : ''}[${safeLabel}](${valid.toString()})\n`.trimStart());
    setUrlDialog(null); setUrl(''); setUrlLabel(''); setError('');
  };

  return <div className="release-edit-panel" data-testid="release-edit-panel">
    <div className="release-edit-heading"><h3>{t('编辑发行版')} · {release.tag_name}</h3><button className="icon-button" onClick={onClose} aria-label={t('关闭编辑')}><X size={18} /></button></div>
    <p className="muted">{t('版本号保持不变，下载链接继续有效。')}</p>
    <label>{t('版本名称')}<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></label>
    <label>{t('版本介绍')}<textarea rows={8} value={body} maxLength={262144} onChange={(event) => setBody(event.target.value)} disabled={busy} /></label>
    <div className="release-edit-actions"><button type="button" className="secondary-button" onClick={() => setUrlDialog('link')} disabled={busy}><Link2 size={16} />{t('插入链接')}</button><button type="button" className="secondary-button" onClick={() => setUrlDialog('image')} disabled={busy}><ImagePlus size={16} />{t('插入图片链接')}</button><button type="button" className="secondary-button" onClick={() => void addImage()} disabled={busy}><ImagePlus size={16} />{t('上传图片并插入')}</button><button type="button" className="secondary-button" onClick={() => setPreview((value) => !value)}>{t(preview ? '继续编辑' : '预览效果')}</button></div>
    {urlDialog && <div className="release-edit-url"><input value={urlLabel} onChange={(event) => setUrlLabel(event.target.value)} placeholder={t('显示文字')} aria-label={t('显示文字')} /><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" aria-label={t('链接地址')} /><button type="button" onClick={insertUrl}>{t('插入')}</button><button type="button" onClick={() => setUrlDialog(null)}>{t('取消')}</button></div>}
    {preview && <div className="release-description release-edit-preview"><ReadmeMarkdown markdown={body || t('这个版本还没有介绍。')} repository={{ owner: repo.owner.login, name: repo.name, branch: repo.default_branch }} onOpenLink={onOpenLink} /></div>}
    <label className="release-edit-check"><input type="checkbox" checked={prerelease} onChange={(event) => setPrerelease(event.target.checked)} disabled={busy} />{t('这是测试版')}</label>
    <button type="button" className="primary-button" onClick={() => void save()} disabled={busy || !title.trim()}>{t('保存版本介绍')}</button>

    <div className="release-edit-assets"><h3>{t('管理已上传文件')}</h3><p className="muted">{t('移除文件后，原下载链接将失效。')}</p>
      {release.assets.map((asset) => <div className="release-edit-asset" key={asset.id}><span>{asset.name}</span>{confirmAsset === asset.id ? <div className="release-edit-actions"><span>{t('确定移除这个文件？')}</span><button type="button" className="danger-button" disabled={busy} onClick={() => void remove(asset.id)}>{t('确认移除')}</button><button type="button" onClick={() => setConfirmAsset(null)}>{t('取消')}</button></div> : <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmAsset(asset.id)}><Trash2 size={15} />{t('移除')}</button>}</div>)}
      <div className="release-edit-actions"><button type="button" className="secondary-button" onClick={() => void chooseFiles()} disabled={busy}><Plus size={16} />{t('选择文件')}</button>{files.length > 0 && <button type="button" className="primary-button" disabled={busy} onClick={() => void addFiles()}>{readLanguage() === 'en' ? `Upload ${files.length} files` : `上传 ${files.length} 个文件`}</button>}</div>
      {files.map((file) => <div className="release-edit-asset" key={file.id}><span>{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))} disabled={busy}>{t('取消选择')}</button></div>)}
    </div>
    {progress && <div className="release-edit-progress"><span>{progress.phase}</span><progress max={Math.max(progress.total, 1)} value={Math.min(progress.loaded, Math.max(progress.total, 1))} />{progress.cancelable && <button type="button" onClick={() => void window.easyHub?.cancelRelease()}>{t('取消上传')}</button>}</div>}
    {error && <p className="live-error" role="alert">{error}</p>}{notice && <p className="release-edit-success" role="status">{t(notice)}</p>}
  </div>;
}
