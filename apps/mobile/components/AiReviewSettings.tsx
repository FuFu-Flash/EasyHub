import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from './AppAlert';
import { usePreferences } from '@/features/preferences/provider';
import { AI_PROVIDERS, testAiConnection, type AiProviderId } from '@/features/ai/review';
import { clearAiSettings, loadAiSettings, saveAiSettings } from '@/features/ai/settings';
import { Action, Card, palette } from './elements';

export function AiReviewSettings() {
  const { t } = usePreferences();
  const [providerId, setProviderId] = useState<AiProviderId>('openai');
  const [model, setModel] = useState<string>(AI_PROVIDERS[0].defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [savedProvider, setSavedProvider] = useState<AiProviderId | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void loadAiSettings().then((saved) => {
      if (!active || !saved) return;
      setProviderId(saved.providerId); setSavedProvider(saved.providerId); setModel(saved.model); setHasKey(true);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const previous = await loadAiSettings();
      const key = apiKey.trim() || (previous?.providerId === providerId ? previous.apiKey : '');
      await saveAiSettings({ providerId, model: model.trim(), apiKey: key });
      setSavedProvider(providerId); setHasKey(true); setApiKey('');
      Alert.alert(t('AI 设置已保存', 'AI settings saved'));
    } catch (reason) { Alert.alert(t('保存失败', 'Could not save settings'), reason instanceof Error ? reason.message : t('请稍后重试。', 'Please try again.')); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await loadAiSettings();
      if (!saved) throw new Error(t('请先保存 AI 设置。', 'Save AI settings first.'));
      await testAiConnection(saved);
      Alert.alert(t('连接成功，可以开始 AI 审查。', 'Connected. AI review is ready.'));
    } catch (reason) { Alert.alert(t('连接失败', 'Connection failed'), reason instanceof Error && reason.name !== 'AbortError' ? reason.message : t('连接超时，请稍后重试。', 'Connection timed out. Please try again.')); }
    finally { setBusy(false); }
  };
  const forget = () => Alert.alert(t('移除 AI 授权？', 'Remove AI authorization?'), t('这台设备上保存的 API Key 将被清除。', 'The API key saved on this device will be removed.'), [
    { text: t('取消', 'Cancel'), style: 'cancel' },
    { text: t('移除', 'Remove'), style: 'destructive', onPress: () => { void clearAiSettings().then(() => { setHasKey(false); setSavedProvider(null); setApiKey(''); }).catch(() => Alert.alert(t('移除失败', 'Could not remove authorization'))); } },
  ]);
  return <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('AI 审查', 'AI review')}</Text>
    <Text style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>{t('使用你自己的 AI 服务授权审查改进请求。授权仅保存在这台设备上。', 'Use your own AI service credentials to review proposed changes. Credentials stay on this device.')}</Text>
    <Text style={{ color: palette.ink, fontWeight: '700', marginTop: 16, marginBottom: 9 }}>{t('AI 服务商', 'AI provider')}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{AI_PROVIDERS.map((provider) => <Pressable key={provider.id} accessibilityRole="radio" accessibilityState={{ checked: providerId === provider.id }} onPress={() => { setProviderId(provider.id); setModel(provider.defaultModel); setApiKey(''); }} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: providerId === provider.id ? palette.blue : palette.border, backgroundColor: providerId === provider.id ? '#e7f0ff' : '#fff' }}><Text style={{ color: providerId === provider.id ? palette.blue : palette.ink, fontWeight: '700' }}>{provider.name}</Text></Pressable>)}</View>
    <Text style={{ color: palette.ink, fontWeight: '700', marginTop: 17, marginBottom: 7 }}>{t('模型名称', 'Model name')}</Text>
    <TextInput value={model} onChangeText={setModel} maxLength={200} autoCapitalize="none" style={{ borderWidth: 1, borderColor: palette.border, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: palette.ink }} />
    <Text style={{ color: palette.ink, fontWeight: '700', marginTop: 17, marginBottom: 7 }}>API Key</Text>
    <TextInput value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder={hasKey && savedProvider === providerId ? t('已保存；留空则保持原值', 'Saved; leave blank to keep it') : t('输入你自己的 API Key', 'Enter your own API key')} style={{ borderWidth: 1, borderColor: palette.border, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: palette.ink }} />
    <View style={{ marginTop: 15, gap: 8 }}><Action title={busy ? t('正在处理…', 'Working…') : t('保存 AI 设置', 'Save AI settings')} disabled={busy || !model.trim() || (!apiKey.trim() && !(hasKey && savedProvider === providerId))} onPress={() => { void save(); }} />
      <Action title={t('测试连接', 'Test connection')} secondary disabled={busy || !hasKey} onPress={() => { void test(); }} />
      {hasKey && <Action title={t('移除已保存的 API Key', 'Remove saved API key')} secondary disabled={busy} onPress={forget} />}</View>
  </Card>;
}
