import { useEffect, useState } from 'react';
import type { Project } from '@easyhub/types';
import { X } from 'lucide-react';
import { translateText, type Language } from '../i18n';
import type { DangerAction } from '../stores/dangerStore';

export function ProjectDangerZone({ project, language, onApply }: {
  project: Project;
  language: Language;
  onApply: (action: DangerAction, targetOwner?: string) => void;
}) {
  const [action, setAction] = useState<DangerAction | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [targetOwner, setTargetOwner] = useState('');
  const [error, setError] = useState('');
  const en = language === 'en';
  const t = (zh: string, english: string): string => en ? english : zh;

  useEffect(() => {
    if (!action) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAction(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [action]);

  const rows: Array<{ id: DangerAction; title: string; description: string; button: string; disabled?: boolean }> = [
    {
      id: 'visibility',
      title: t('变更项目可见性', 'Change project visibility'),
      description: project.visibility === 'public'
        ? t('这个项目目前所有人都能看到。', 'Everyone can currently see this project.')
        : t('这个项目目前只有你能看到。', 'Only you can currently see this project.'),
      button: t('改变可见性', 'Change visibility'),
      disabled: project.archived,
    },
    {
      id: 'protection',
      title: t('分支保护规则', 'Branch protection rules'),
      description: project.branchProtectionEnabled
        ? t('已启用演示保护规则，防止意外改动。', 'A demo protection rule is enabled to prevent accidental changes.')
        : t('目前没有启用演示保护规则。', 'No demo protection rule is currently enabled.'),
      button: project.branchProtectionEnabled ? t('禁用分支保护规则', 'Disable protection') : t('启用分支保护规则', 'Enable protection'),
      disabled: project.archived,
    },
    {
      id: 'transfer',
      title: t('所有权转移', 'Transfer ownership'),
      description: t(`当前所有者：${project.owner}。转移后新的所有者将管理这个项目。`, `Current owner: ${project.owner === '你' ? 'You' : project.owner}. The new owner will manage this project.`),
      button: t('转交项目', 'Transfer'),
      disabled: project.archived,
    },
    {
      id: 'archive',
      title: project.archived ? t('取消项目存档', 'Unarchive project') : t('存档此项目', 'Archive this project'),
      description: project.archived
        ? t('这个项目现在是只读的。取消存档后可以继续修改。', 'This project is read-only. Unarchive it to make changes again.')
        : t('存档后项目会变为只读，之后仍可取消存档。', 'Archiving makes this project read-only. You can unarchive it later.'),
      button: project.archived ? t('取消存档', 'Unarchive') : t('存档此项目', 'Archive'),
    },
    {
      id: 'delete',
      title: t('删除此项目', 'Delete this project'),
      description: t('删除后，这个演示项目及其问题会从当前窗口消失。', 'This demo project and its issues will disappear from the current window.'),
      button: t('删除此项目', 'Delete project'),
    },
  ];
  const selected = rows.find((row) => row.id === action);

  function open(next: DangerAction): void {
    setAction(next);
    setConfirmation('');
    setTargetOwner('');
    setError('');
  }

  function apply(): void {
    if (!action) return;
    if (confirmation !== project.name) {
      setError(t('请输入完整的项目名称以确认', 'Enter the full project name to confirm'));
      return;
    }
    if (action === 'transfer' && !targetOwner.trim()) {
      setError(t('请输入新所有者的 GitHub 用户名或组织名', 'Enter the new owner’s GitHub username or organization name'));
      return;
    }
    try {
      onApply(action, targetOwner);
      setAction(null);
    } catch (caught) {
      setError(caught instanceof Error ? translateText(caught.message, language) : t('操作没有完成，请重试', 'The action could not be completed. Try again.'));
    }
  }

  return <section className="danger-zone" aria-label={t('危险区', 'Danger Zone')}>
    <div className="danger-zone-heading"><h2>{t('危险区', 'Danger Zone')}</h2><p>{t('以下操作会改变项目的访问或管理方式。当前为演示模式，不会修改 GitHub 或本地文件。', 'These actions change project access or management. Demo mode does not change GitHub or local files.')}</p></div>
    <div className="danger-zone-list">{rows.map((row) => <div className="danger-zone-row" key={row.id}>
      <div><strong>{row.title}</strong><p>{row.description}</p></div>
      <button type="button" disabled={row.disabled} onClick={() => open(row.id)}>{row.button}</button>
    </div>)}</div>
    {action && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAction(null); }}><div className="modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="danger-dialog-title">
      <button className="icon-button modal-close" aria-label={t('关闭', 'Close')} onClick={() => setAction(null)}><X size={19} /></button>
      <h2 id="danger-dialog-title">{selected.title}</h2>
      <p>{action === 'visibility'
        ? project.visibility === 'public' ? t('确认后，这个项目将只有你能看到。', 'After confirmation, only you will see this project.') : t('确认后，所有人都能看到这个项目及其内容。', 'After confirmation, everyone can see this project and its contents.')
        : action === 'protection' ? t('这会改变演示项目的分支保护状态。', 'This changes the demo branch protection state.')
          : action === 'transfer' ? t('输入新的所有者。真实转移还需 GitHub 接受，并可能改变你的管理权限。', 'Enter the new owner. A real transfer also requires GitHub acceptance and may change your permissions.')
            : action === 'archive' ? project.archived ? t('取消存档后可以继续修改项目。', 'You can make changes again after unarchiving.') : t('存档后，项目介绍、问题和发布会变为只读。', 'After archiving, the introduction, issues and publishing become read-only.')
              : t('删除只会移除当前窗口中的演示项目和问题。不会删除本地文件，也不会联系 GitHub。', 'Deletion only removes the demo project and issues from this window. It does not delete local files or contact GitHub.')}</p>
      {action === 'transfer' && <label className="field"><span>{t('新所有者', 'New owner')}</span><input aria-label={t('新所有者', 'New owner')} value={targetOwner} onChange={(event) => setTargetOwner(event.target.value)} placeholder={t('GitHub 用户名或组织名', 'GitHub username or organization')} maxLength={39} autoFocus /></label>}
      <label className="field"><span>{t('输入项目名称以确认', 'Enter project name to confirm')}：<b>{project.name}</b></span><input aria-label={t('确认项目名称', 'Confirm project name')} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus={action !== 'transfer'} autoComplete="off" /></label>
      {error && <div className="release-error" role="alert">{error}</div>}
      <div className="danger-demo-note">{t('演示操作只影响当前窗口，重新启动后恢复。', 'Demo actions affect only this window and reset on restart.')}</div>
      <div className="modal-actions"><button className="button button-quiet" onClick={() => setAction(null)}>{t('取消', 'Cancel')}</button><button className="button danger-confirm" disabled={confirmation !== project.name || (action === 'transfer' && !targetOwner.trim())} onClick={apply}>{selected.button}</button></div>
    </div></div>}
  </section>;
}
