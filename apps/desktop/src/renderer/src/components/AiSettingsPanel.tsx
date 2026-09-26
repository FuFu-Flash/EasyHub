import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, KeyRound, RotateCw, Trash2 } from 'lucide-react';
import type { AiProviderId, AiSettingsStatus } from '@easyhub/types';
import { readLanguage } from '../i18n';
import type { Language } from '../i18n';
import { AI_PROVIDERS, aiProvider } from '../../../shared/aiProviders';
import './aiReview.css';

export function AiSettingsPanel({ disabled = false, language = readLanguage() }: { disabled?: boolean; language?: Language }) {
  const [providerId, setProviderId] = useState<AiProviderId | 'legacy'>('openai');
  const [model, setModel] = useState(AI_PROVIDERS[0]!.defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState<AiSettingsStatus | null>(null);
  const [loading, setLoading] = useState(!disabled);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const locked = disabled || loading || busy !== null;
  const edited = saved !== null && (providerId !== saved.providerId || model.trim() !== saved.model || apiKey.length > 0);
  const changedProvider = saved !== null && providerId !== saved.providerId;

  useEffect(() => {
    mounted.current = true;
    if (disabled || !window.easyHub) { setLoading(false); return () => { mounted.current = false; }; }
    let active = true;
    void window.easyHub.aiSettings().then((result) => {
      if (!active) return;
      setSaved(result); setProviderId(result.providerId); setModel(result.model || aiProvider(result.providerId)?.defaultModel || AI_PROVIDERS[0]!.defaultModel);
    }).catch(() => {
      if (active) setError(language === 'en' ? 'AI settings could not be loaded. Please reopen Settings.' : '暂时无法读取 AI 设置，请重新打开设置。');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [disabled, language]);

  async function act(action: 'save' | 'test' | 'remove'): Promise<void> {
    if (!window.easyHub || locked) return;
    setBusy(action); setError(''); setNotice('');
    try {
      if (action === 'save') {
        if (!model.trim()) throw new Error(t('请输入服务商提供的模型名称。', 'Enter the model name provided by your service.'));
        if (changedProvider && !apiKey.trim()) throw new Error(t('更换服务商后，请输入对应服务的 API Key。', 'Enter the new provider’s API key when changing providers.'));
        await window.easyHub.aiSaveSettings({ providerId, model: model.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
        if (mounted.current) setApiKey('');
      } else if (action === 'test') {
        await window.easyHub.aiTestConnection();
      } else {
        await window.easyHub.aiForgetKey();
        if (mounted.current) setApiKey('');
      }
      const result = await window.easyHub.aiSettings();
      if (!mounted.current) return;
      setSaved(result);
      if (action === 'save') { setProviderId(result.providerId); setModel(result.model); }
      setNotice(action === 'save' ? t('AI 设置已保存。', 'AI settings saved.') : action === 'test' ? t('连接成功，可以开始 AI 审查。', 'Connected. AI review is ready.') : t('已移除保存的 API Key。', 'Saved API key removed.'));
    } catch (cause) {
      if (!mounted.current) return;
      const message = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : '';
      setError(message || t('暂时无法完成操作，请稍后重试。', 'The action could not be completed. Please try again.'));
    } finally { if (mounted.current) setBusy(null); }
  }

  return <section className="panel settings-panel ai-settings-panel" aria-labelledby="ai-settings-heading">
    <div className="settings-icon blue"><KeyRound size={21} /></div>
    <div className="ai-settings-content">
      <h2 id="ai-settings-heading">{t('AI API 授权', 'AI API Access')}</h2>
      <p>{t('选择 AI 服务商，填写你自己的 API Key，即可审查改进请求。', 'Choose an AI provider and enter your own API key to review proposed changes.')}</p>
      {disabled ? <p className="ai-settings-note">{t('演示版中不保存密钥。请使用正式版连接你的 AI 服务。', 'The demo does not store keys. Use the full edition to connect your AI service.')}</p> : <p className="ai-settings-note">{t('密钥保存在这台电脑的安全存储中。每次审查前，你都可以确认将发送的内容和服务地址。', 'Your key is kept in this computer’s secure storage. Before each review, you can confirm the content and service address.')}</p>}
      <form onSubmit={(event) => { event.preventDefault(); void act('save'); }}>
        <label className="field"><span>{t('AI 服务商', 'AI provider')}</span><span className="ai-provider-select"><select aria-label={t('AI 服务商', 'AI provider')} value={providerId} onChange={(event) => { const next = event.target.value as AiProviderId | 'legacy'; setProviderId(next); setModel(aiProvider(next)?.defaultModel ?? saved?.model ?? ''); setApiKey(''); setNotice(''); }} disabled={locked}>{saved?.providerId === 'legacy' && <option value="legacy">{t('之前保存的服务', 'Previously saved provider')}</option>}{AI_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select><ChevronDown size={17} aria-hidden="true" /></span></label>
        <label className="field"><span>API Key <span className="ai-key-state">{saved?.hasApiKey && !changedProvider ? t('已安全保存', 'Stored securely') : t('尚未设置', 'Not set')}</span></span><input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setNotice(''); }} disabled={locked} autoComplete="new-password" spellCheck={false} maxLength={4096} placeholder={saved?.hasApiKey && !changedProvider ? t('留空保留当前密钥', 'Leave blank to keep the saved key') : t('输入你自己的 API Key', 'Enter your own API key')} /></label>
        <details className="ai-model-details"><summary>{t('更换模型（可选）', 'Change model (optional)')}</summary><label className="field"><span>{t('模型名称', 'Model name')}</span><input value={model} onChange={(event) => { setModel(event.target.value); setNotice(''); }} disabled={locked} autoComplete="off" maxLength={200} required /></label><p className="ai-settings-note">{t('已为所选服务商填入默认模型。仅在需要使用其他模型时修改。', 'A default model is selected for this provider. Change it only if you need another model.')}</p></details>
        {saved?.providerId === 'legacy' && <p className="ai-settings-note">{t('之前保存的服务仍可使用。选择新的服务商时需要填写对应的 API Key。', 'Your previously saved provider remains available. Enter a new API key when switching providers.')}</p>}
        {changedProvider && <p className="ai-settings-note">{t('更换服务商后，请填写该服务商的 API Key。', 'Enter the API key for the newly selected provider.')}</p>}
        {error && <p className="live-error" role="alert">{error}</p>}
        {notice && <p className="ai-success" role="status"><Check size={16} />{notice}</p>}
        <div className="ai-settings-actions">
          <button className="button button-primary" type="submit" disabled={locked || !model.trim() || (changedProvider && !apiKey.trim())}>{busy === 'save' && <RotateCw size={16} className="live-spin" />}{t('保存授权', 'Save settings')}</button>
          <button className="button button-quiet" type="button" disabled={locked || !saved?.hasApiKey || !saved.model || edited} onClick={() => void act('test')}>{busy === 'test' && <RotateCw size={16} className="live-spin" />}{t('测试连接', 'Test connection')}</button>
          <button className="button button-quiet ai-remove-key" type="button" disabled={locked || !saved?.hasApiKey} onClick={() => void act('remove')}><Trash2 size={15} />{t('移除密钥', 'Remove key')}</button>
        </div>
        <p className="ai-settings-note">{t('测试连接与审查可能产生服务商费用。', 'Connection tests and reviews may incur charges from your provider.')}</p>
        {edited && <p className="ai-settings-note">{t('保存修改后即可测试连接。', 'Save your changes before testing the connection.')}</p>}
      </form>
    </div>
  </section>;
}
