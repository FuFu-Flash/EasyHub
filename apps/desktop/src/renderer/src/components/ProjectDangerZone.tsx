import { useTranslation } from '../localization';
import { errorText } from '../errors';
import { ErrorMessage } from './ErrorMessage';
import { useEffect, useState } from 'react';
import type { Project } from '@easyhub/types';
import { X } from 'lucide-react';
import { type Language } from '../i18n';
import type { DangerAction } from '../stores/dangerStore';

export function ProjectDangerZone({ project, language, onApply }: {
  project: Project;
  language: Language;
  onApply: (action: DangerAction, targetOwner?: string) => void;
}) {
  const t = useTranslation(language);
  const [action, setAction] = useState<DangerAction | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [targetOwner, setTargetOwner] = useState('');
  const [error, setError] = useState('');
  

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
      title: t("projectDangerZone.changeProjectVisibility"),
      description: project.visibility === 'public'
        ? t("projectDangerZone.everyoneCanCurrentlySeeThisProject")
        : t("projectDangerZone.onlyYouCanCurrentlySeeThisProject"),
      button: t("projectDangerZone.changeVisibility"),
      disabled: project.archived,
    },
    {
      id: 'protection',
      title: t("projectDangerZone.branchProtectionRules"),
      description: project.branchProtectionEnabled
        ? t("projectDangerZone.aDemoProtectionRuleIsEnabledToPreventAccidental")
        : t("projectDangerZone.noDemoProtectionRuleIsCurrentlyEnabled"),
      button: project.branchProtectionEnabled ? t("projectDangerZone.disableProtection") : t("projectDangerZone.enableProtection"),
      disabled: project.archived,
    },
    {
      id: 'transfer',
      title: t("projectDangerZone.transferOwnership"),
      description: t("projectDangerZone.currentOwnerTheNewOwnerWillManageThisProject", { p0: project.owner }),
      button: t("projectDangerZone.transfer"),
      disabled: project.archived,
    },
    {
      id: 'archive',
      title: project.archived ? t("projectDangerZone.unarchiveProject") : t("projectDangerZone.archiveThisProject"),
      description: project.archived
        ? t("projectDangerZone.thisProjectIsReadOnlyUnarchiveItToMake")
        : t("projectDangerZone.archivingMakesThisProjectReadOnlyYouCanUnarchive"),
      button: project.archived ? t("projectDangerZone.unarchive") : t("projectDangerZone.archive"),
    },
    {
      id: 'delete',
      title: t("projectDangerZone.deleteThisProject"),
      description: t("projectDangerZone.thisDemoProjectAndItsIssuesWillDisappearFrom"),
      button: t("projectDangerZone.deleteProject"),
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
      setError(t("projectDangerZone.enterTheFullProjectNameToConfirm"));
      return;
    }
    if (action === 'transfer' && !targetOwner.trim()) {
      setError(t("projectDangerZone.enterTheNewOwnerSGithubUsernameOrOrganization"));
      return;
    }
    try {
      onApply(action, targetOwner);
      setAction(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return <section className="danger-zone" aria-label={t("projectDangerZone.dangerZone")}>
    <div className="danger-zone-heading"><h2>{t("projectDangerZone.dangerZone")}</h2><p>{t("projectDangerZone.theseActionsChangeProjectAccessOrManagementDemoMode")}</p></div>
    <div className="danger-zone-list">{rows.map((row) => <div className="danger-zone-row" key={row.id}>
      <div><strong>{row.title}</strong><p>{row.description}</p></div>
      <button type="button" disabled={row.disabled} onClick={() => open(row.id)}>{row.button}</button>
    </div>)}</div>
    {action && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAction(null); }}><div className="modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="danger-dialog-title">
      <button className="icon-button modal-close" aria-label={t("projectDangerZone.close")} onClick={() => setAction(null)}><X size={19} /></button>
      <h2 id="danger-dialog-title">{selected.title}</h2>
      <p>{action === 'visibility'
        ? project.visibility === 'public' ? t("projectDangerZone.afterConfirmationOnlyYouWillSeeThisProject") : t("projectDangerZone.afterConfirmationEveryoneCanSeeThisProjectAndIts")
        : action === 'protection' ? t("projectDangerZone.thisChangesTheDemoBranchProtectionState")
          : action === 'transfer' ? t("projectDangerZone.enterTheNewOwnerARealTransferAlsoRequires")
            : action === 'archive' ? project.archived ? t("projectDangerZone.youCanMakeChangesAgainAfterUnarchiving") : t("projectDangerZone.afterArchivingTheIntroductionIssuesAndPublishingBecomeRead")
              : t("projectDangerZone.deletionOnlyRemovesTheDemoProjectAndIssuesFrom")}</p>
      {action === 'transfer' && <label className="field"><span>{t("projectDangerZone.newOwner")}</span><input aria-label={t("projectDangerZone.newOwner")} value={targetOwner} onChange={(event) => setTargetOwner(event.target.value)} placeholder={t("projectDangerZone.githubUsernameOrOrganization")} maxLength={39} autoFocus /></label>}
      <label className="field"><span>{t("projectDangerZone.enterProjectNameToConfirm")}：<b>{project.name}</b></span><input aria-label={t("projectDangerZone.confirmProjectName")} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus={action !== 'transfer'} autoComplete="off" /></label>
      {error && <div className="release-error" role="alert"><ErrorMessage error={error} /></div>}
      <div className="danger-demo-note">{t("projectDangerZone.demoActionsAffectOnlyThisWindowAndResetOn")}</div>
      <div className="modal-actions"><button className="button button-quiet" onClick={() => setAction(null)}>{t("projectDangerZone.cancel")}</button><button className="button danger-confirm" disabled={confirmation !== project.name || (action === 'transfer' && !targetOwner.trim())} onClick={apply}>{selected.button}</button></div>
    </div></div>}
  </section>;
}
