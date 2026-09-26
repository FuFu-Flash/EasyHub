import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { X } from 'lucide-react';
import type { Language } from '../i18n';

type Action = 'visibility' | 'protection' | 'transfer' | 'archive' | 'delete';
interface Protection { branch: string; enabled: boolean; externalRules: boolean; reviewsRequired: number | null }
interface DeviceFlow { userCode: string; verificationUri: string; expiresAt: number; interval: number }

export function LiveProjectDangerZone({ repo, language, onUpdate, onTransferred, onNotice }: {
  repo: GitHubRepo; language: Language; onUpdate: (repo: GitHubRepo) => void;
  onTransferred: () => void; onNotice: (message: string) => void;
}) {
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const [action, setAction] = useState<Action | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [targetOwner, setTargetOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [protection, setProtection] = useState<Protection | null>(null);
  const [loadingProtection, setLoadingProtection] = useState(false);
  const [deleteScope, setDeleteScope] = useState(false);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [authMessage, setAuthMessage] = useState('');

  useEffect(() => {
    if (!flow) return;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      if (flow.expiresAt <= Date.now()) { setFlow(null); setError(t('授权已过期，请重新尝试。', 'Authorization expired. Try again.')); return; }
      polling = true;
      void window.easyHub!.authPoll().then((result) => {
        if (result.state === 'complete') {
          setFlow(null); setDeleteScope(true);
          setAuthMessage(t('授权成功。请再次点击“删除此项目”执行删除。', 'Authorization succeeded. Click “Delete project” again to delete it.'));
        }
      }).catch((cause: unknown) => {
        setFlow(null); setError(cause instanceof Error ? cause.message : t('授权未完成，请重试。', 'Authorization failed. Try again.'));
      }).finally(() => { polling = false; });
    }, Math.max(flow.interval, 5) * 1000);
    return () => window.clearInterval(timer);
  }, [flow, language]);

  const rows: { id: Action; title: string; description: string; button: string; disabled?: boolean }[] = [
    { id: 'visibility', title: t('变更项目可见性', 'Change visibility'), description: repo.private ? t('这个项目目前只有获得授权的人能看到。', 'Only authorized people can currently see this project.') : t('这个项目目前是公开的。', 'This project is currently public.'), button: t('改变可见性', 'Change visibility'), disabled: repo.archived },
    { id: 'protection', title: t('分支保护规则', 'Branch protection rules'), description: t('查看并管理默认分支的保护，不会覆盖其他规则。', 'Manage default branch protection without overwriting other rules.'), button: t('管理规则', 'Manage rules'), disabled: repo.archived },
    { id: 'transfer', title: t('所有权转移', 'Transfer ownership'), description: t('把这个项目转移给其他用户或组织。对方可能需要接受。', 'Transfer this project to another user or organization. They may need to accept.'), button: t('转移项目', 'Transfer project'), disabled: repo.archived },
    { id: 'archive', title: repo.archived ? t('取消项目存档', 'Unarchive project') : t('存档此项目', 'Archive project'), description: repo.archived ? t('取消存档后可以继续修改。', 'You can make changes after unarchiving.') : t('存档后项目会变为只读。', 'Archiving makes the project read-only.'), button: repo.archived ? t('取消存档', 'Unarchive') : t('存档此项目', 'Archive project') },
    { id: 'delete', title: t('删除此项目', 'Delete project'), description: t('永久删除 GitHub 上的项目。电脑上的文件不会被删除。', 'Permanently delete the project on GitHub. Files on this computer stay intact.'), button: t('删除此项目', 'Delete project') },
  ];
  const chosen = rows.find((row) => row.id === action);
  const expected = action === 'delete' || action === 'transfer' || action === 'protection' ? repo.full_name : repo.name;
  const actionButton = action === 'protection' ? protection?.enabled ? t('移除默认分支保护', 'Remove default branch protection') : t('开启默认分支保护', 'Protect default branch') : chosen?.button;

  function close(): void {
    if (busy) return;
    if (action === 'delete') void window.easyHub?.authCancel();
    setFlow(null); setDeleteScope(false); setAction(null);
  }
  function open(id: Action): void {
    setAction(id); setConfirmation(''); setTargetOwner(''); setError(''); setAuthMessage(''); setFlow(null);
    if (id === 'protection') {
      setProtection(null); setLoadingProtection(true);
      void window.easyHub?.github<Protection>('branchProtectionStatus', repo.owner.login, repo.name)
        .then(setProtection).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t('无法读取保护规则。', 'Could not load protection rules.')))
        .finally(() => setLoadingProtection(false));
    }
    if (id === 'delete') void window.easyHub?.github<boolean>('deleteRepoScope', repo.owner.login, repo.name, repo.id).then(setDeleteScope).catch(() => setDeleteScope(false));
  }
  async function apply(): Promise<void> {
    if (!action || confirmation !== expected || !window.easyHub || busy) return;
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
        if (!/^[A-Za-z0-9_.-]{1,100}$/.test(targetOwner) || targetOwner.toLowerCase() === repo.owner.login.toLowerCase()) throw new Error(t('请输入其他用户或组织的有效名称。', 'Enter a valid different user or organization.'));
        await api.github<GitHubRepo>('transferRepo', repo.owner.login, repo.name, targetOwner);
        onNotice(t('转移请求已提交。对方可能需要在 GitHub 接受。', 'Transfer requested. The new owner may need to accept on GitHub.'));
        onTransferred();
      } else if (action === 'protection') {
        if (!protection || protection.externalRules) throw new Error(t('无法修改当前保护规则。', 'These protection rules cannot be changed here.'));
        const updated = await api.github<Protection>('setDefaultBranchProtection', repo.owner.login, repo.name, {
          expectedBranch: protection.branch, expectedEnabled: protection.enabled, enable: !protection.enabled, confirmation: repo.full_name,
        });
        setProtection(updated);
        onNotice(updated.enabled ? t('默认分支保护已开启。', 'Default branch protection enabled.') : t('默认分支保护已移除。', 'Default branch protection removed.'));
      } else if (action === 'delete') {
        if (!deleteScope) {
          setFlow(await api.authStartDeletion(repo.owner.login, repo.name, repo.id));
          setAuthMessage(t('请在 GitHub 授权删除权限。授权后仍需再次确认删除。', 'Authorize deletion on GitHub. You must confirm deletion again afterward.'));
          return;
        }
        await api.github('deleteRepo', repo.owner.login, repo.name, repo.id, repo.full_name);
        onNotice(t('GitHub 上的项目已删除；电脑上的文件仍保留。', 'Project deleted from GitHub. Files on this computer remain.'));
        onTransferred();
      }
      setAction(null);
    } catch (cause) {
      if (action === 'delete') setDeleteScope(false);
      setError(cause instanceof Error ? cause.message : t('操作失败，请稍后重试。', 'The action failed. Try again.'));
    }
    finally { setBusy(false); }
  }

  return <section className="danger-zone" aria-label={t('危险区', 'Danger Zone')}>
    <div className="danger-zone-heading"><h2>{t('危险区', 'Danger Zone')}</h2><p>{t('以下操作会改变项目的访问或管理方式。请确认项目名称后继续。', 'These actions change project access or management. Confirm the project name before continuing.')}</p></div>
    <div className="danger-zone-list">{rows.map((row) => <div className="danger-zone-row" key={row.id}><div><strong>{row.title}</strong><p>{row.description}</p></div><button type="button" disabled={row.disabled || busy} onClick={() => open(row.id)}>{row.button}</button></div>)}</div>
    {action && chosen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="live-danger-title">
      <button className="icon-button modal-close" aria-label={t('关闭', 'Close')} disabled={busy} onClick={close}><X size={19} /></button>
      <h2 id="live-danger-title">{chosen.title}</h2>
      {action === 'protection' ? <div className="danger-rule-summary">{loadingProtection ? t('正在读取保护规则…', 'Loading protection rules…') : protection?.externalRules ? t('默认分支受到其他规则保护，EasyHub 不会覆盖这些规则。', 'Other rules protect the default branch. EasyHub will not overwrite them.') : protection?.enabled ? <><p>{t(`默认分支 ${protection.branch} 已启用保护。`, `The default branch ${protection.branch} is protected.`)}</p><p>{t('移除会撤销当前默认分支的旧版保护规则。', 'Removing protection revokes the current legacy rule for the default branch.')}</p></> : protection ? <p>{t(`默认分支 ${protection.branch} 还没有旧版保护规则。开启后，合入修改需要一人批准。`, `The default branch ${protection.branch} has no legacy rule. Enabling it requires one approval before merging.`)}</p> : null}</div>
        : <p>{action === 'visibility' ? repo.private ? t('确认后，所有人都能看到这个项目及其内容。', 'Everyone will be able to see this project and its contents.') : t('确认后，只有获得授权的人能看到这个项目。', 'Only authorized people will be able to see this project.') : action === 'archive' ? repo.archived ? t('取消存档后可以继续修改项目。', 'You can modify this project after unarchiving it.') : t('存档后项目将变为只读。', 'The project will become read-only.') : action === 'transfer' ? t('GitHub 可能要求新的所有者接受转移。', 'GitHub may require the new owner to accept the transfer.') : t('这会永久删除 GitHub 上的项目、历史版本和问题。电脑上的文件不会删除。', 'This permanently deletes the project, history and issues on GitHub. Files on this computer remain.')}</p>}
      {action === 'transfer' && <label className="field"><span>{t('新所有者', 'New owner')}</span><input aria-label={t('新所有者', 'New owner')} value={targetOwner} onChange={(event) => setTargetOwner(event.target.value)} maxLength={100} autoComplete="off" /></label>}
      <label className="field"><span>{t('输入项目名称以确认', 'Type the project name to confirm')}：<b>{expected}</b></span><input aria-label={t('确认项目名称', 'Confirm project name')} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
      {flow && <div className="danger-auth"><p>{t('前往 GitHub 输入以下验证码：', 'Enter this code on GitHub:')} <strong>{flow.userCode}</strong></p><button type="button" className="button button-quiet" onClick={() => void window.easyHub?.openExternalLink(flow.verificationUri)}>{t('打开 GitHub 授权页面', 'Open GitHub authorization')}</button><small>{t('正在等待授权结果…', 'Waiting for authorization…')}</small></div>}
      {authMessage && <p className="danger-auth-message" role="status">{authMessage}</p>}
      {error && <p className="live-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button button-quiet" disabled={busy} onClick={close}>{t('取消', 'Cancel')}</button><button className="button danger-confirm" disabled={busy || Boolean(flow) || confirmation !== expected || (action === 'transfer' && !targetOwner.trim()) || (action === 'protection' && (!protection || protection.externalRules || loadingProtection))} onClick={() => void apply()}>{busy ? t('正在处理…', 'Working…') : action === 'delete' && !deleteScope ? t('授权删除权限', 'Authorize deletion') : actionButton}</button></div>
    </div></div>}
  </section>;
}
