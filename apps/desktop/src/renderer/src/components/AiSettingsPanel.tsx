import { useNoticeState } from '../useNoticeState';
import { FeedbackNotice } from './FeedbackNotice';
import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, RotateCw, Trash2 } from 'lucide-react';
import type { AiProviderId, AiSettingsStatus } from '@easyhub/types';
import { readLanguage } from '../i18n';
import type { Language } from '../i18n';
import { AI_PROVIDERS, aiProvider } from '../../../shared/aiProviders';
import { StyledDropdown } from './StyledDropdown';
import { BinaryAnalysisSettings } from './BinaryAnalysisSettings';

export function AiSettingsPanel({ disabled = false, language = readLanguage() }: { disabled?: boolean; language?: Language }) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [providerId, setProviderId] = useState<AiProviderId | 'legacy'>('openai');
  const [model, setModel] = useState(AI_PROVIDERS[0]!.defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState<AiSettingsStatus | null>(null);
  const [loading, setLoading] = useState(!disabled);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useNoticeState(language);
  const [expanded, setExpanded] = useState(false);
  const mounted = useRef(false);
  
  const locked = disabled || loading || busy !== null;
  const edited = saved !== null && (providerId !== saved.providerId || model.trim() !== saved.model || apiKey.length > 0);
  const changedProvider = saved !== null && providerId !== saved.providerId;
  const modelChoices = [...new Set([saved?.model, aiProvider(saved?.providerId)?.defaultModel].filter((value): value is string => Boolean(value)))];

  function toggleExpanded(): void {
    if (expanded && saved) { setProviderId(saved.providerId); setModel(saved.model); setApiKey(''); setError(''); setNotice(''); }
    setExpanded((value) => !value);
  }

  useEffect(() => {
    mounted.current = true;
    if (disabled || !easyHub) { setLoading(false); return () => { mounted.current = false; }; }
    let active = true;
    void easyHub.aiSettings().then((result) => {
      if (!active) return;
      setSaved(result); setProviderId(result.providerId); setModel(result.model || aiProvider(result.providerId)?.defaultModel || AI_PROVIDERS[0]!.defaultModel);
    }).catch(() => {
      if (active) setError(t("aiSettingsPanel.cannotReadAiSettingsPleaseReopenSettings"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [disabled, language]);

  async function act(action: 'save' | 'test' | 'remove', selectedModel = model): Promise<void> {
    if (!easyHub || locked) return;
    setBusy(action); setError(''); setNotice('');
    try {
      if (action === 'save') {
        if (!selectedModel.trim()) throw new Error(t("aiSettingsPanel.enterTheModelNameProvidedByYourService"));
        if (changedProvider && !apiKey.trim()) throw new Error(t("aiSettingsPanel.enterTheNewProviderSApiKeyWhenChanging"));
        await easyHub.aiSaveSettings({ providerId, model: selectedModel.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
        if (mounted.current) setApiKey('');
      } else if (action === 'test') {
        await easyHub.aiTestConnection();
      } else {
        await easyHub.aiForgetKey();
        if (mounted.current) setApiKey('');
      }
      const result = await easyHub.aiSettings();
      if (!mounted.current) return;
      setSaved(result);
      if (action === 'save') { setProviderId(result.providerId); setModel(result.model); setExpanded(false); }
      if (action === 'remove') setExpanded(false);
      setNotice(action === 'save' ? t("aiSettingsPanel.aiSettingsSaved") : action === 'test' ? t("aiSettingsPanel.connectedAiReviewIsReady") : t("aiSettingsPanel.savedApiKeyRemoved"));
    } catch (cause) {
      if (!mounted.current) return;
      const message = errorText(cause, '');
      setError(message || t("aiSettingsPanel.theActionCouldNotBeCompletedPleaseTryAgain"));
    } finally { if (mounted.current) setBusy(null); }
  }

  return <section className="panel settings-panel ai-settings-panel" aria-labelledby="ai-settings-heading">
    <div className="settings-icon blue"><KeyRound size={21} /></div>
    <div className="ai-settings-content">
      <div className="ai-settings-summary"><button type="button" className="ai-settings-toggle" aria-expanded={expanded} aria-controls="ai-settings-details" onClick={toggleExpanded}><span><h2 id="ai-settings-heading">{t("aiSettingsPanel.aiApiAccess")}</h2><small>{loading ? t("aiSettingsPanel.loadingSettings") : saved?.hasApiKey ? t("aiSettingsPanel.connectedManageAccess") : t("aiSettingsPanel.setUpAnAiProvider")}</small></span><ChevronDown size={19} className={expanded ? 'expanded' : ''} /></button>
        {!expanded && saved?.hasApiKey && <div className="ai-compact-model"><span>{t("aiSettingsPanel.model")}</span><StyledDropdown label={t("aiSettingsPanel.model")} value={saved.model} disabled={locked} options={modelChoices.map((choice) => ({ value: choice, label: choice }))} onChange={(choice) => { setModel(choice); void act('save', choice); }} /></div>}
      </div>
      {!expanded && error && <p className="live-error" role="alert"><ErrorMessage error={error} /></p>}
      <FeedbackNotice message={notice} language={language} onClose={() => setNotice('')} />
      <div id="ai-settings-details" hidden={!expanded}>
      <p>{t("aiSettingsPanel.chooseAnAiProviderAndEnterYourOwnApi")}</p>
      {disabled ? <p className="ai-settings-note">{t("aiSettingsPanel.theDemoDoesNotStoreKeysUseTheFull")}</p> : <p className="ai-settings-note">{t("aiSettingsPanel.yourKeyIsKeptInThisComputerSSecure")}</p>}
      <form onSubmit={(event) => { event.preventDefault(); void act('save'); }}>
        <div className="field"><span>{t("aiSettingsPanel.aiProvider")}</span><StyledDropdown label={t("aiSettingsPanel.aiProvider")} value={providerId} disabled={locked} options={[...(saved?.providerId === 'legacy' ? [{ value: 'legacy', label: t("aiSettingsPanel.previouslySavedProvider") }] : []), ...AI_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name }))]} onChange={(value) => { const next = value as AiProviderId | 'legacy'; setProviderId(next); setModel(aiProvider(next)?.defaultModel ?? saved?.model ?? ''); setApiKey(''); setNotice(''); }} /></div>
        <label className="field"><span>API Key <span className="ai-key-state">{saved?.hasApiKey && !changedProvider ? t("aiSettingsPanel.storedSecurely") : t("aiSettingsPanel.notSet")}</span></span><input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setNotice(''); }} disabled={locked} autoComplete="new-password" spellCheck={false} maxLength={4096} placeholder={saved?.hasApiKey && !changedProvider ? t("aiSettingsPanel.leaveBlankToKeepTheSavedKey") : t("aiSettingsPanel.enterYourOwnApiKey")} /></label>
        <details className="ai-model-details"><summary>{t("aiSettingsPanel.changeModelOptional")}</summary><label className="field"><span>{t("aiSettingsPanel.modelName")}</span><input value={model} onChange={(event) => { setModel(event.target.value); setNotice(''); }} disabled={locked} autoComplete="off" maxLength={200} required /></label><p className="ai-settings-note">{t("aiSettingsPanel.aDefaultModelIsSelectedForThisProviderChange")}</p></details>
        {saved?.providerId === 'legacy' && <p className="ai-settings-note">{t("aiSettingsPanel.yourPreviouslySavedProviderRemainsAvailableEnterANew")}</p>}
        {changedProvider && <p className="ai-settings-note">{t("aiSettingsPanel.enterTheApiKeyForTheNewlySelectedProvider")}</p>}
        {error && <p className="live-error" role="alert"><ErrorMessage error={error} /></p>}
        <div className="ai-settings-actions">
          <button className="button button-primary" type="submit" disabled={locked || !model.trim() || (changedProvider && !apiKey.trim())}>{busy === 'save' && <RotateCw size={16} className="live-spin" />}{t("aiSettingsPanel.saveSettings")}</button>
          <button className="button button-quiet" type="button" disabled={locked || !saved?.hasApiKey || !saved.model || edited} onClick={() => void act('test')}>{busy === 'test' && <RotateCw size={16} className="live-spin" />}{t("aiSettingsPanel.testConnection")}</button>
          <button className="button button-quiet ai-remove-key" type="button" disabled={locked || !saved?.hasApiKey} onClick={() => void act('remove')}><Trash2 size={15} />{t("aiSettingsPanel.removeKey")}</button>
        </div>
        <p className="ai-settings-note">{t("aiSettingsPanel.connectionTestsAndReviewsMayIncurChargesFromYour")}</p>
        {edited && <p className="ai-settings-note">{t("aiSettingsPanel.saveYourChangesBeforeTestingTheConnection")}</p>}
      </form>
      </div>
      <BinaryAnalysisSettings disabled={disabled} language={language} />
    </div>
  </section>;
}
