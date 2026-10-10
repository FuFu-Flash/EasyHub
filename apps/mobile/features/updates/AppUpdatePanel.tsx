import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import { useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { Action, Card, palette } from '@/components/elements';
import { MaterialArrow } from '@/components/MaterialArrow';
import { usePreferences } from '@/features/preferences/provider';
import { AppUpdateError, checkAndroidAppUpdate, type AppUpdateErrorCode, type AppUpdateResult } from './appUpdate';

export function AppUpdatePanel() {
  const { t } = usePreferences();
  const currentVersion = Constants.expoConfig?.version ?? '';
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AppUpdateResult | null>(null);
  const [error, setError] = useState<AppUpdateErrorCode | 'open-page' | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  useFocusEffect(useCallback(() => () => {
    // Tabs retain their mounted screens. Keep the request identity until its finally settles.
    request.current?.abort();
  }, []));

  async function check(): Promise<void> {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(null); setResult(null);
    try {
      const next = await checkAndroidAppUpdate(currentVersion, expoFetch as typeof fetch, controller.signal);
      if (mounted.current && request.current === controller && !controller.signal.aborted) setResult(next);
    } catch (cause) {
      if (mounted.current && request.current === controller && !controller.signal.aborted) setError(cause instanceof AppUpdateError ? cause.code : 'network');
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }

  async function openRelease(): Promise<void> {
    if (!result?.available) return;
    setError(null);
    try { await Linking.openURL(result.releaseUrl); }
    catch { if (mounted.current) setError('open-page'); }
  }

  const message = error === 'rate-limit' ? t('检查更新过于频繁，请稍后重试。', 'Too many update checks. Please try again later.')
    : error === 'no-android-release' ? t('暂时没有可用的安卓版本，请稍后重试。', 'No Android release is available yet. Please try again later.')
    : error === 'version' ? t('无法识别当前应用版本。', 'Unable to identify the current app version.')
    : error === 'open-page' ? t('无法打开下载页面。', 'Unable to open the download page.')
    : t('暂时无法检查更新，请稍后重试。', 'Unable to check for updates. Please try again later.');

  return <Card>
    <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('关于 EasyHub', 'About EasyHub')}</Text>
    <Text style={{ color: palette.muted, marginTop: 8 }}>{t('当前版本', 'Current version')} {currentVersion || t('未知', 'Unknown')}</Text>
    <Text style={{ color: palette.muted, marginTop: 5 }}>{t('依据 GPLv3 发布', 'Released under GPLv3')}</Text>
    <View style={{ marginTop: 16 }}><Action title={busy ? t('正在检查…', 'Checking…') : t('检查更新', 'Check for updates')} secondary disabled={busy} onPress={() => { void check(); }} /></View>
    {busy && <ActivityIndicator accessibilityLabel={t('正在检查更新', 'Checking for updates')} color={palette.blue} style={{ marginTop: 12 }} />}
    {result && <Text accessibilityLiveRegion="polite" style={{ color: result.available ? palette.blue : palette.green, lineHeight: 21, marginTop: 12 }}>{result.available ? t(`发现新版本 ${result.latestVersion}`, `Version ${result.latestVersion} is available`) : t('已是最新版本。', 'You are up to date.')}</Text>}
    {result?.available && <Pressable accessibilityRole="link" onPress={() => { void openRelease(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%', minHeight: 48, paddingVertical: 12 }}>
      <Text style={{ color: palette.blue, fontWeight: '700', minWidth: 0, flexShrink: 1 }}>{t('查看更新并下载', 'View update and download')}</Text>
      <MaterialArrow name="external" color={palette.blue} />
    </Pressable>}
    {error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: '#bf3947', lineHeight: 21, marginTop: 12 }}>{message}</Text>}
  </Card>;
}
