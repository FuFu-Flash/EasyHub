import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { PairingCode } from './PairingCode';
import { useDialogFocus } from './useDialogFocus';
import { errorText } from '../errors';
import { useEffect, useRef, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { X } from 'lucide-react';
import type { Language } from '../i18n';

type Action = 'visibility' | 'protection' | 'transfer' | 'archive' | 'delete';
interface Protection {
  branch: string;
  enabled: boolean;
  externalRules: boolean;
  reviewsRequired: number | null;
}
interface DeviceFlow {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
  codeCopied?: boolean;
}

export function LiveProjectDangerZone({
  repo,
  language,
  onUpdate,
  onTransferred,
  onNotice,
}: {
  repo: GitHubRepo;
  language: Language;
  onUpdate: (repo: GitHubRepo) => void;
  onTransferred: () => void;
  onNotice: (message: string) => void;
}) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();

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
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(Boolean(action), dialog, close);

  useEffect(() => {
    if (!flow) return;
    let polling = false;
    const timer = window.setInterval(
      () => {
        if (polling) return;
        if (flow.expiresAt <= Date.now()) {
          setFlow(null);
          setError(t('liveProjectDangerZone.authorizationExpiredTryAgain'));
          return;
        }
        polling = true;
        void easyHub!
          .authPoll()
          .then((result) => {
            if (result.state === 'complete') {
              setFlow(null);
              setDeleteScope(true);
              setAuthMessage(t('liveProjectDangerZone.authorizationSucceededClickDeleteProjectAgainToDeleteIt'));
            }
          })
          .catch((cause: unknown) => {
            setFlow(null);
            setError(errorText(cause, t('liveProjectDangerZone.authorizationFailedTryAgain')));
          })
          .finally(() => {
            polling = false;
          });
      },
      Math.max(flow.interval, 5) * 1000,
    );
    return () => window.clearInterval(timer);
  }, [flow, language]);

  const rows: { id: Action; title: string; description: string; button: string; disabled?: boolean }[] = [
    {
      id: 'visibility',
      title: t('liveProjectDangerZone.changeVisibility'),
      description: repo.private
        ? t('liveProjectDangerZone.onlyAuthorizedPeopleCanCurrentlySeeThisProject')
        : t('liveProjectDangerZone.thisProjectIsCurrentlyPublic'),
      button: t('liveProjectDangerZone.changeVisibility2'),
      disabled: repo.archived,
    },
    {
      id: 'protection',
      title: t('liveProjectDangerZone.branchProtectionRules'),
      description: t('liveProjectDangerZone.manageDefaultBranchProtectionWithoutOverwritingOtherRules'),
      button: t('liveProjectDangerZone.manageRules'),
      disabled: repo.archived,
    },
    {
      id: 'transfer',
      title: t('liveProjectDangerZone.transferOwnership'),
      description: t('liveProjectDangerZone.transferThisProjectToAnotherUserOrOrganizationThey'),
      button: t('liveProjectDangerZone.transferProject'),
      disabled: repo.archived,
    },
    {
      id: 'archive',
      title: repo.archived ? t('liveProjectDangerZone.unarchiveProject') : t('liveProjectDangerZone.archiveProject'),
      description: repo.archived
        ? t('liveProjectDangerZone.youCanMakeChangesAfterUnarchiving')
        : t('liveProjectDangerZone.archivingMakesTheProjectReadOnly'),
      button: repo.archived ? t('liveProjectDangerZone.unarchive') : t('liveProjectDangerZone.archiveProject'),
    },
    {
      id: 'delete',
      title: t('liveProjectDangerZone.deleteProject'),
      description: t('liveProjectDangerZone.permanentlyDeleteTheProjectOnGithubFilesOnThis'),
      button: t('liveProjectDangerZone.deleteProject'),
    },
  ];
  const chosen = rows.find((row) => row.id === action);
  const expected = action === 'delete' || action === 'transfer' || action === 'protection' ? repo.full_name : repo.name;
  const actionButton =
    action === 'protection'
      ? protection?.enabled
        ? t('liveProjectDangerZone.removeDefaultBranchProtection')
        : t('liveProjectDangerZone.protectDefaultBranch')
      : chosen?.button;

  function close(): void {
    if (busy) return;
    if (action === 'delete') void easyHub?.authCancel();
    setFlow(null);
    setDeleteScope(false);
    setAction(null);
  }
  function open(id: Action): void {
    setAction(id);
    setConfirmation('');
    setTargetOwner('');
    setError('');
    setAuthMessage('');
    setFlow(null);
    if (id === 'protection') {
      setProtection(null);
      setLoadingProtection(true);
      void easyHub
        ?.github<Protection>('branchProtectionStatus', repo.owner.login, repo.name)
        .then(setProtection)
        .catch((cause: unknown) => setError(errorText(cause, t('liveProjectDangerZone.couldNotLoadProtectionRules'))))
        .finally(() => setLoadingProtection(false));
    }
    if (id === 'delete')
      void easyHub
        ?.github<boolean>('deleteRepoScope', repo.owner.login, repo.name, repo.id)
        .then(setDeleteScope)
        .catch(() => setDeleteScope(false));
  }
  async function apply(): Promise<void> {
    if (!action || confirmation !== expected || !easyHub || busy) return;
    const api = easyHub;
    setBusy(true);
    setError('');
    try {
      if (action === 'visibility') {
        const updated = await api.github<GitHubRepo>('updateVisibility', repo.owner.login, repo.name, !repo.private);
        onUpdate(updated);
        onNotice(t('liveProjectDangerZone.projectVisibilityUpdated'));
      } else if (action === 'archive') {
        const updated = await api.github<GitHubRepo>('setArchived', repo.owner.login, repo.name, !repo.archived);
        onUpdate(updated);
        onNotice(
          updated.archived ? t('liveProjectDangerZone.projectArchived') : t('liveProjectDangerZone.projectUnarchived'),
        );
      } else if (action === 'transfer') {
        if (
          !/^[A-Za-z0-9_.-]{1,100}$/.test(targetOwner) ||
          targetOwner.toLowerCase() === repo.owner.login.toLowerCase()
        )
          throw new Error(t('liveProjectDangerZone.enterAValidDifferentUserOrOrganization'));
        await api.github<GitHubRepo>('transferRepo', repo.owner.login, repo.name, targetOwner);
        onNotice(t('liveProjectDangerZone.transferRequestedTheNewOwnerMayNeedToAccept'));
        onTransferred();
      } else if (action === 'protection') {
        if (!protection || protection.externalRules)
          throw new Error(t('liveProjectDangerZone.theseProtectionRulesCannotBeChangedHere'));
        const updated = await api.github<Protection>('setDefaultBranchProtection', repo.owner.login, repo.name, {
          expectedBranch: protection.branch,
          expectedEnabled: protection.enabled,
          enable: !protection.enabled,
          confirmation: repo.full_name,
        });
        setProtection(updated);
        onNotice(
          updated.enabled
            ? t('liveProjectDangerZone.defaultBranchProtectionEnabled')
            : t('liveProjectDangerZone.defaultBranchProtectionRemoved'),
        );
      } else if (action === 'delete') {
        if (!deleteScope) {
          setFlow(await api.authStartDeletion(repo.owner.login, repo.name, repo.id));
          setAuthMessage(t('liveProjectDangerZone.authorizeDeletionOnGithubYouMustConfirmDeletionAgain'));
          return;
        }
        await api.github('deleteRepo', repo.owner.login, repo.name, repo.id, repo.full_name);
        onNotice(t('liveProjectDangerZone.projectDeletedFromGithubFilesOnThisComputerRemain'));
        onTransferred();
      }
      setAction(null);
    } catch (cause) {
      if (action === 'delete') setDeleteScope(false);
      setError(errorText(cause, t('liveProjectDangerZone.theActionFailedTryAgain')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="danger-zone" aria-label={t('liveProjectDangerZone.dangerZone')}>
      <div className="danger-zone-heading">
        <h2>{t('liveProjectDangerZone.dangerZone')}</h2>
        <p>{t('liveProjectDangerZone.theseActionsChangeProjectAccessOrManagementConfirmThe')}</p>
      </div>
      <div className="danger-zone-list">
        {rows.map((row) => (
          <div className="danger-zone-row" key={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p>{row.description}</p>
            </div>
            <button type="button" disabled={row.disabled || busy} onClick={() => open(row.id)}>
              {row.button}
            </button>
          </div>
        ))}
      </div>
      {action && chosen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            className="modal danger-modal"
            ref={dialog}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-danger-title"
          >
            <button
              className="icon-button modal-close"
              aria-label={t('liveProjectDangerZone.close')}
              disabled={busy}
              onClick={close}
            >
              <X size={19} />
            </button>
            <h2 id="live-danger-title">{chosen.title}</h2>
            {action === 'protection' ? (
              <div className="danger-rule-summary">
                {loadingProtection ? (
                  t('liveProjectDangerZone.loadingProtectionRules')
                ) : protection?.externalRules ? (
                  t('liveProjectDangerZone.otherRulesProtectTheDefaultBranchEasyhubWillNot')
                ) : protection?.enabled ? (
                  <>
                    <p>{t('liveProjectDangerZone.theDefaultBranchIsProtected', { p0: protection.branch })}</p>
                    <p>{t('liveProjectDangerZone.removingProtectionRevokesTheCurrentLegacyRuleForThe')}</p>
                  </>
                ) : protection ? (
                  <p>
                    {t('liveProjectDangerZone.theDefaultBranchHasNoLegacyRuleEnablingIt', { p0: protection.branch })}
                  </p>
                ) : null}
              </div>
            ) : (
              <p>
                {action === 'visibility'
                  ? repo.private
                    ? t('liveProjectDangerZone.everyoneWillBeAbleToSeeThisProjectAnd')
                    : t('liveProjectDangerZone.onlyAuthorizedPeopleWillBeAbleToSeeThis')
                  : action === 'archive'
                    ? repo.archived
                      ? t('liveProjectDangerZone.youCanModifyThisProjectAfterUnarchivingIt')
                      : t('liveProjectDangerZone.theProjectWillBecomeReadOnly')
                    : action === 'transfer'
                      ? t('liveProjectDangerZone.githubMayRequireTheNewOwnerToAcceptThe')
                      : t('liveProjectDangerZone.thisPermanentlyDeletesTheProjectHistoryAndIssuesOn')}
              </p>
            )}
            {action === 'transfer' && (
              <label className="field">
                <span>{t('liveProjectDangerZone.newOwner')}</span>
                <input
                  aria-label={t('liveProjectDangerZone.newOwner')}
                  value={targetOwner}
                  onChange={(event) => setTargetOwner(event.target.value)}
                  maxLength={100}
                  autoComplete="off"
                />
              </label>
            )}
            <label className="field">
              <span>
                {t('liveProjectDangerZone.typeTheProjectNameToConfirm')}：<b>{expected}</b>
              </span>
              <input
                aria-label={t('liveProjectDangerZone.confirmProjectName')}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </label>
            {flow && (
              <div className="danger-auth">
                <p>{t('liveProjectDangerZone.enterThisCodeOnGithub')}</p>
                <PairingCode
                  key={`${flow.userCode}:${flow.expiresAt}`}
                  code={flow.userCode}
                  codeCopied={flow.codeCopied}
                  language={language}
                  pendingMessage={t('liveProjectDangerZone.waitingForAuthorization')}
                >
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => void easyHub?.openExternalLink(flow.verificationUri)}
                  >
                    {t('liveProjectDangerZone.openGithubAuthorization')}
                  </button>
                </PairingCode>
              </div>
            )}
            {authMessage && (
              <p className="danger-auth-message" role="status">
                {authMessage}
              </p>
            )}
            {error && (
              <p className="live-error" role="alert">
                <ErrorMessage error={error} />
              </p>
            )}
            <div className="modal-actions">
              <button className="button button-quiet" disabled={busy} onClick={close}>
                {t('liveProjectDangerZone.cancel')}
              </button>
              <button
                className="button danger-confirm"
                disabled={
                  busy ||
                  Boolean(flow) ||
                  confirmation !== expected ||
                  (action === 'transfer' && !targetOwner.trim()) ||
                  (action === 'protection' && (!protection || protection.externalRules || loadingProtection))
                }
                onClick={() => void apply()}
              >
                {busy
                  ? t('liveProjectDangerZone.working')
                  : action === 'delete' && !deleteScope
                    ? t('liveProjectDangerZone.authorizeDeletion')
                    : actionButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
