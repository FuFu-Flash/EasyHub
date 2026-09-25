import { useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { X } from 'lucide-react';
import type { Language } from '../i18n';

type DangerAction = 'visibility' | 'protection' | 'transfer' | 'archive' | 'delete';

export function LiveProjectDangerZone({ repo, language, onUpdate, onTransferred, onNotice }: {
  repo: GitHubRepo;
  language: Language;
  onUpdate: (repo: GitHubRepo) => void;
  onTransferred: () => void;
  onNotice: (message: string) => void;
}) {
  const [action, setAction] = useState<DangerAction | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [targetOwner, setTargetOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const rows: { id: DangerAction; title: string; description: string; button: string; disabled?: boolean }[] = [
    { id: 'visibility', title: t('变更项目可见性', 'Change visibility'), description: repo.private ? t('这个项目目前只有你能看到。', 'Only you can currently see this project.') : t('这个项目目前是公开的。', 'This project is currently public.'), button: t('改变可见性', 'Change visibility'), disabled: repo.archived },
    { id: 'protection', title: t('分支保护规则', 'Branch protection rules'), description: t('在 GitHub 设置中查看或修改规则，避免覆盖已有保护。', 'Review or change rules on GitHub without overwriting existing protection.'), button: t('管理规则', 'Manage rules') },
    { id: 'transfer', title: t('所有权转移', 'Transfer ownership'), description: t('把这个项目转移给其他用户或组织。对方可能需要接受。', 'Transfer this project to another user or organization. They may need to accept.'), button: t('转会', 'Transfer'), disabled: repo.archived },
    { id: 'archive', title: repo.archived ? t('取消项目存档', 'Unarchive project') : t('存档此项目', 'Archive project'), description: repo.archived ? t('这个项目现在已存档，取消后可以继续修改。', 'This project is archived. Unarchive it to make changes.') : t('存档后项目会变为只读。', 'Archiving makes this project read-only.'), button: repo.archived ? t('取消存档', 'Unarchive') : t('存档此项目', 'Archive') },
    { id: 'delete', title: t('删除此项目', 'Delete project'), description: t('在 GitHub 设置中完成删除；EasyHub 不会替你直接删除项目。', 'Finish deletion in GitHub settings. EasyHub does not directly delete the project.'), button: t('前往删除', 'Open delete settings') },
  ];
  const chosen = rows.find((row) => row.id === action);
  const expected = action === 'delete' || action === 'transfer' ? repo.full_name : repo.name;

  function open(id: DangerAction): void { setAction(id); setConfirmation(''); setTargetOwner(''); setError(''); }

  async function apply(): Promise<void> {
    if (!action || confirmation !== expected || !window.easyHub) return;
    const api = window.easyHub;
    setBusy(true); setError('');
    try {
      if (action === 'visibility') {
        const updated = await api.github<GitHubRepo>('updateVisibility', repo.owner.login, repo.name, !repo.private);
        onUpdate(updated); onNotice(t('项目可见性已更新。', 'Project visibility updated.'));
      } else if (action === 'archive') {
        const updated = await api.github<GitHubRepo>('setArchived', repo.owner.login, repo.name, !repo.archived);
        onUpdate(updated); onNotice(updated.archived ? t('项目已存档。', 'Project archived.') : t('项目已取消存档。', 'Project unarchived.'));
      } else if (action === 'transfer') {
        if (!/^[A-Za-z0-9_.-]{1,100}$/.test(targetOwner) || targetOwner === repo.owner.login) throw new Error(t('请输入其他用户或组织的有效名称。', 'Enter a valid different user or organization.'));
        await api.github<GitHubRepo>('transferRepo', repo.owner.login, repo.name, targetOwner);
        onNotice(t('转移请求已提交。对方可能需要在 GitHub 接受。', 'Transfer requested. The new owner may need to accept on GitHub.'));
        onTransferred();
      } else {
        const path = action === 'protection' ? 'settings/branches' : 'settings#danger-zone';
        await api.openExternalLink(`https://github.com/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/${path}`);
      }
      setAction(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('操作失败，请稍后重试。', 'The action failed. Please try again.')); }
    finally { setBusy(false); }
  }

  return <section className="danger-zone" aria-label={t('危险区', 'Danger Zone')}>
    <div className="danger-zone-heading"><h2>{t('危险区', 'Danger Zone')}</h2><p>{t('以下操作会改变项目的访问或管理方式。请确认项目名称后继续。', 'These actions change project access or management. Confirm the project name before continuing.')}</p></div>
    <div className="danger-zone-list">{rows.map((row) => <div className="danger-zone-row" key={row.id}><div><strong>{row.title}</strong><p>{row.description}</p></div><button type="button" disabled={row.disabled || busy} onClick={() => open(row.id)}>{row.button}</button></div>)}</div>
    {action && chosen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setAction(null); }}><div className="modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="live-danger-title">
      <button className="icon-button modal-close" aria-label={t('关闭', 'Close')} disabled={busy} onClick={() => setAction(null)}><X size={19} /></button>
      <h2 id="live-danger-title">{chosen.title}</h2>
      <p>{action === 'visibility' ? repo.private ? t('确认后，所有人都能看到这个项目及其内容。', 'Everyone will be able to see this project and its contents.') : t('确认后，只有获授权的人能看到这个项目。', 'Only authorized people will be able to see this project.') : action === 'archive' ? repo.archived ? t('取消存档后可以继续修改项目。', 'You can modify this project after unarchiving it.') : t('存档后项目将变为只读。', 'The project will become read-only.') : action === 'transfer' ? t('GitHub 可能要求新的所有者接受转移。', 'GitHub may require the new owner to accept the transfer.') : action === 'delete' ? t('将打开 GitHub 的项目设置页面。删除需要在 GitHub 上再次确认。', 'GitHub project settings will open. Deletion requires another confirmation on GitHub.') : t('将打开 GitHub 的分支规则设置页面。', 'GitHub branch rule settings will open.')}</p>
      {action === 'transfer' && <label className="field"><span>{t('新所有者', 'New owner')}</span><input aria-label={t('新所有者', 'New owner')} value={targetOwner} onChange={(event) => setTargetOwner(event.target.value)} maxLength={100} autoComplete="off" /></label>}
      <label className="field"><span>{t('输入项目名称以确认', 'Type the project name to confirm')}：<b>{expected}</b></span><input aria-label={t('确认项目名称', 'Confirm project name')} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
      {error && <p className="live-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button button-quiet" disabled={busy} onClick={() => setAction(null)}>{t('取消', 'Cancel')}</button><button className="button danger-confirm" disabled={busy || confirmation !== expected || (action === 'transfer' && !targetOwner.trim())} onClick={() => void apply()}>{busy ? t('正在处理…', 'Working…') : chosen.button}</button></div>
    </div></div>}
  </section>;
}
