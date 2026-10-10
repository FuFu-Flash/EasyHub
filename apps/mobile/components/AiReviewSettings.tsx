import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from './AppAlert';
import { usePreferences } from '@/features/preferences/provider';
import { AI_PROVIDERS, testAiConnection, type AiProviderId } from '@/features/ai/review';
import { clearAiSettings, loadAiSettings, saveAiSettings } from '@/features/ai/settings';
import { Action, Card, palette } from './elements';
import { MaterialArrow } from './MaterialArrow';

export function AiReviewSettings() {
  const { t } = usePreferences();
  const [providerId, setProviderId] = useState<AiProviderId>('openai');
  const [model, setModel] = useState<string>(AI_PROVIDERS[0].defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [savedProvider, setSavedProvider] = useState<AiProviderId | null>(null);
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [modelExpanded, setModelExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void loadAiSettings().then((saved) => {
      if (!active || !saved) return;
      setProviderId(saved.providerId); setSavedProvider(saved.providerId); setModel(saved.model); setSavedModel(saved.model); setHasKey(true);
    }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const locked = busy || loading;
  const edited = hasKey && (providerId !== savedProvider || model.trim() !== savedModel || apiKey.length > 0);
  const toggleExpanded = () => {
    if (locked) return;
    if (expanded) { setProviderId(savedProvider ?? 'openai'); setModel(savedModel ?? AI_PROVIDERS[0].defaultModel); setApiKey(''); setModelExpanded(false); }
    setExpanded((value) => !value);
  };
  const save = async (selectedModel = model) => {
    if (locked) return;
    setBusy(true);
    try {
      const previous = await loadAiSettings();
      const key = apiKey.trim() || (previous?.providerId === providerId ? previous.apiKey : '');
      await saveAiSettings({ providerId, model: selectedModel.trim(), apiKey: key });
      setSavedProvider(providerId); setSavedModel(selectedModel.trim()); setModel(selectedModel.trim()); setHasKey(true); setApiKey(''); setExpanded(false); setModelExpanded(false);
      Alert.alert(t('AI 设置已保存', 'AI settings saved'));
    } catch (reason) { Alert.alert(t('保存失败', 'Could not save settings'), reason instanceof Error ? reason.message : t('请稍后重试。', 'Please try again.')); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (locked || edited) return;
    setBusy(true);
    try {
      const saved = await loadAiSettings();
      if (!saved) throw new Error(t('请先保存 AI 设置。', 'Save AI settings first.'));
      if (saved.providerId !== providerId || saved.model !== model.trim()) throw new Error(t('AI 设置已变化，请重新打开设置。', 'AI settings changed. Reopen Settings.'));
      await testAiConnection(saved);
      Alert.alert(t('连接成功，可以开始 AI 审查。', 'Connected. AI review is ready.'));
    } catch (reason) { Alert.alert(t('连接失败', 'Connection failed'), reason instanceof Error && reason.name !== 'AbortError' ? reason.message : t('连接超时，请稍后重试。', 'Connection timed out. Please try again.')); }
    finally { setBusy(false); }
  };
  const forget = () => Alert.alert(t('移除 AI 授权？', 'Remove AI authorization?'), t('这台设备上保存的 API Key 将被清除。', 'The API key saved on this device will be removed.'), [
    { text: t('取消', 'Cancel'), style: 'cancel' },
    { text: t('移除', 'Remove'), style: 'destructive', onPress: () => { void clearAiSettings().then(() => { setHasKey(false); setSavedProvider(null); setApiKey(''); }).catch(() => Alert.alert(t('移除失败', 'Could not remove authorization'))); } },
  ]);
  const chooseCompactModel = () => {
    if (locked || !savedProvider || !savedModel) return;
    const choices = [...new Set([savedModel, AI_PROVIDERS.find((provider) => provider.id === savedProvider)!.defaultModel])];
    Alert.alert(t('模型选择', 'Choose model'), undefined, [
      ...choices.map((choice) => ({ text: choice, onPress: () => { void save(choice); } })),
      { text: t('输入其他模型', 'Enter another model'), onPress: () => { setExpanded(true); setModelExpanded(true); } },
      { text: t('取消', 'Cancel'), style: 'cancel' },
    ]);
  };
  return <Card><Pressable accessibilityRole="button" accessibilityState={{ expanded }} disabled={locked} onPress={toggleExpanded} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
    <View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('AI API 授权', 'AI API access')}</Text>
      <Text style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>{loading ? t('正在读取设置…', 'Loading settings…') : hasKey ? t('已连接 · 点击管理授权', 'Connected · manage access') : t('点击设置 AI 服务', 'Set up an AI provider')}</Text></View>
    <MaterialArrow name={expanded ? 'expandLess' : 'expandMore'} />
  </Pressable>
    {!expanded && hasKey && <View style={{ marginTop: 14 }}><Text style={{ color: palette.muted, marginBottom: 6 }}>{t('模型选择', 'Model')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('模型选择', 'Choose model')}: ${savedModel}`} disabled={locked} onPress={chooseCompactModel} style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}><Text numberOfLines={2} style={{ color: palette.ink, flex: 1 }}>{savedModel}</Text><MaterialArrow name="expandMore" /></Pressable>
    </View>}
    {expanded && <>
    <Text style={{ color: palette.muted, marginTop: 12, lineHeight: 20 }}>{t('使用你自己的 AI 服务授权审查改进请求和程序文件。授权仅保存在这台设备上。', 'Use your own AI credentials to review proposed changes and program files. Credentials stay on this device.')}</Text>
    <Text style={{ color: palette.ink, fontWeight: '700', marginTop: 16, marginBottom: 9 }}>{t('AI 服务商', 'AI provider')}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{AI_PROVIDERS.map((provider) => <Pressable key={provider.id} disabled={locked} accessibilityRole="radio" accessibilityState={{ checked: providerId === provider.id }} onPress={() => { if (providerId !== provider.id) { setProviderId(provider.id); setModel(provider.defaultModel); setApiKey(''); } }} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: providerId === provider.id ? palette.blue : palette.border, backgroundColor: providerId === provider.id ? '#e7f0ff' : '#fff' }}><Text style={{ color: providerId === provider.id ? palette.blue : palette.ink, fontWeight: '700' }}>{provider.name}</Text></Pressable>)}</View>
    <Text style={{ color: palette.ink, fontWeight: '700', marginTop: 17, marginBottom: 7 }}>API Key</Text>
    <TextInput value={apiKey} onChangeText={setApiKey} editable={!locked} maxLength={4096} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder={hasKey && savedProvider === providerId ? t('已保存；留空则保持原值', 'Saved; leave blank to keep it') : t('输入你自己的 API Key', 'Enter your own API key')} style={{ borderWidth: 1, borderColor: palette.border, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: palette.ink }} />
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: modelExpanded }} disabled={locked} onPress={() => setModelExpanded((value) => !value)} style={{ marginTop: 17, paddingVertical: 12, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }}><MaterialArrow name={modelExpanded ? 'expandLess' : 'expandMore'} color={palette.ink} /><Text style={{ color: palette.ink, fontWeight: '700', flexShrink: 1 }}>{t('更换模型（可选）', 'Change model (optional)')}</Text></Pressable>
    {modelExpanded && <View><Text style={{ color: palette.muted, marginBottom: 7 }}>{t('模型名称', 'Model name')}</Text><TextInput value={model} onChangeText={setModel} editable={!locked} maxLength={200} autoCapitalize="none" autoCorrect={false} style={{ borderWidth: 1, borderColor: palette.border, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: palette.ink }} /></View>}
    <View style={{ marginTop: 15, gap: 8 }}><Action title={busy ? t('正在处理…', 'Working…') : t('保存 AI 设置', 'Save AI settings')} disabled={locked || !model.trim() || (!apiKey.trim() && !(hasKey && savedProvider === providerId))} onPress={() => { void save(); }} />
      <Action title={t('测试连接', 'Test connection')} secondary disabled={locked || !hasKey || edited} onPress={() => { void test(); }} />
      {hasKey && <Action title={t('移除已保存的 API Key', 'Remove saved API key')} secondary disabled={locked} onPress={forget} />}</View>
    {edited && <Text style={{ color: palette.muted, marginTop: 10 }}>{t('保存修改后即可测试连接。', 'Save your changes before testing the connection.')}</Text>}
    </>}
  </Card>;
}
