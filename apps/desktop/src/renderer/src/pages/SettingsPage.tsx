import { WindowControlStyleOptions } from '../components/WindowControlStyleOptions';
import { useTranslation } from '../localization';
import type { TranslationTargetLanguage } from '@easyhub/types';
import { ArrowRight, Globe2, Info, Languages, Square } from 'lucide-react';
import { useState } from 'react';
import { AiSettingsPanel } from '../components/AiSettingsPanel';
import { AppUpdatePanel } from '../components/AppUpdatePanel';
import { HostsRepairPanel } from '../components/HostsRepairPanel';
import { LayoutSettingsPanel } from '../components/LayoutSettingsPanel';
import { StyledDropdown } from '../components/StyledDropdown';
import { errorText as message } from '../errors';
import { usePageFeedback } from '../workspace/pageFeedback';

import { useWorkspace } from '../workspace/WorkspaceContext';

export function SettingsPage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { setError } = usePageFeedback();
  const {
    user,
    language,
    translationTarget,
    translationNames,
    translationNamesText,
    windowStyle,
    demo,
    onLogout,
    layout,
    easyHub,
  } = w;
  const setWindowStyle = (value: 'windows' | 'reference') => w.set('windowStyle', value);
  const setTranslationTarget = (value: TranslationTargetLanguage) => w.set('translationTarget', value);
  const setTranslationNamesText = (value: string) => w.set('translationNamesText', value);

  const [busy, setBusy] = useState(false);
  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await onLogout();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">{t('settingsPage.personalize')}</div>
          <h1>{t('settingsPage.settings')}</h1>
          <p>{t('settingsPage.adjustEasyhubSAppearanceAndManageTheGithubConnection')}</p>
        </div>
      </div>
      <div className="settings-stack">
        <section className="panel settings-panel">
          <div className="settings-icon">
            <Globe2 size={22} />
          </div>
          <div>
            <h2>{t('settingsPage.accountConnection')}</h2>
            {demo ? (
              <>
                <p>{t('settingsPage.youAreExploringTheWorkspaceWithADemoAccount')}</p>
                {!demo.only && (
                  <button className="button button-primary" onClick={demo.onLogin}>
                    {t('settingsPage.signInToGithub')}
                  </button>
                )}
              </>
            ) : (
              <>
                <p>
                  {t('settingsPage.connectedToGithub')}
                  {user.login}
                  {t('settingsPage.yourProjectsRemainOnGithub')}
                </p>
                <button className="button button-quiet" disabled={busy} onClick={() => void signOut()}>
                  {t('settingsPage.signOut')}
                </button>
              </>
            )}
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="settings-icon blue">
            <Square size={22} />
          </div>
          <div className="settings-panel-content">
            <h2>{t('settingsPage.windowControls')}</h2>
            <p>{t('settingsPage.chooseTheStyleOfTheWindowButtonsChangesTake')}</p>
            <WindowControlStyleOptions value={windowStyle} onChange={setWindowStyle} />
          </div>
        </section>
        <LayoutSettingsPanel
          language={language}
          preference={layout.preference}
          density={layout.density}
          onChange={layout.setPreference}
        />
        <AiSettingsPanel language={language} />
        <section className="panel settings-panel">
          <div className="settings-icon blue">
            <Languages size={22} />
          </div>
          <div className="translation-settings">
            <div>
              <h2>{t('settingsPage.contentTranslation')}</h2>
              <p>{t('settingsPage.useTheTranslationSwitchInTheTopBarTo')}</p>
            </div>
            <div className="translation-target-row">
              <span>{t('settingsPage.targetLanguage')}</span>
              <StyledDropdown
                label={t('settingsPage.translationTargetLanguage')}
                value={translationTarget}
                options={[
                  { value: 'zh-CN', label: t('settingsPage.simplifiedChinese') },
                  { value: 'en', label: 'English' },
                ]}
                onChange={(value) => setTranslationTarget(value as TranslationTargetLanguage)}
              />
            </div>
            <label className="translation-names-label" htmlFor="translation-names">
              {t('settingsPage.namesToKeepUnchanged')}
            </label>
            <p className="translation-names-help">
              {t('settingsPage.theCurrentProjectAuthorsAndGithubProjectsLinkedIn')}
            </p>
            <textarea
              id="translation-names"
              aria-label={t('settingsPage.namesToKeepUnchanged')}
              rows={4}
              maxLength={8000}
              value={translationNamesText}
              onChange={(event) => setTranslationNamesText(event.target.value)}
              placeholder={t('settingsPage.enterOneNameToKeepPerLine')}
            />
            <small className="muted">
              {t('settingsPage.saved')} {translationNames.length} {t('settingsPage.namesSavedOnThisComputerOnly')}
            </small>
          </div>
        </section>
        <HostsRepairPanel language={language} />
        <section className="panel settings-panel">
          <div className="settings-icon amber">
            <Info size={22} />
          </div>
          <div>
            <h2>{t('settingsPage.aboutEasyhub')}</h2>
            <p>
              {demo
                ? t('settingsPage.desktopEdition')
                : t(
                    easyHub.platform === 'darwin'
                      ? 'mac.desktopConnected'
                      : 'settingsPage.windowsDesktopConnectedToGithub',
                  )}
            </p>
            <span className="settings-version">{t('settingsPage.version130')}</span>
            <AppUpdatePanel language={language} />
            <div className="license-details">
              <strong>Apache 2.0</strong>
              <span>{t('settingsPage.thisApplicationIsLicensedUnderApacheLicense20')}</span>
              <button className="text-link" onClick={() => void easyHub?.openLicense()}>
                {t('settingsPage.viewLicense')} <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
