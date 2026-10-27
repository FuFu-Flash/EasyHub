import { useTranslation } from '@/features/localization/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import { useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { Action, Card, palette } from '@/components/elements';
import { MaterialArrow } from '@/components/MaterialArrow';

import { AppUpdateError, checkAndroidAppUpdate, type AppUpdateErrorCode, type AppUpdateResult } from './appUpdate';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';
import { themed } from '@/features/theme/theme';

export function AppUpdatePanel() {
  const t = useTranslation();
  const currentVersion = Constants.expoConfig?.version ?? '';
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AppUpdateResult | null>(null);
  const { value: error, set: setError, capture } = usePageFeedback<AppUpdateErrorCode | 'open-page' | null>(null);

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
    const current = capture();
    try { await Linking.openURL(result.releaseUrl); }
    catch { if (mounted.current && current()) setError('open-page'); }
  }

  const message = error === 'rate-limit' ? t("AppUpdatePanel.tooManyUpdateChecksPleaseTryAgainLater")
    : error === 'no-android-release' ? t("AppUpdatePanel.noAndroidReleaseIsAvailableYetPleaseTryAgainLater")
    : error === 'version' ? t("AppUpdatePanel.unableToIdentifyTheCurrentAppVersion")
    : error === 'open-page' ? t("AppUpdatePanel.unableToOpenTheDownloadPage")
    : t("AppUpdatePanel.unableToCheckForUpdatesPleaseTryAgainLater");

  return <Card>
    <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t("AppUpdatePanel.aboutEasyHub")}</Text>
    <Text style={{ color: palette.muted, marginTop: 8 }}>{t("AppUpdatePanel.currentVersion")} {currentVersion || t("AppUpdatePanel.unknown")}</Text>
    <Text style={{ color: palette.muted, marginTop: 5 }}>{t("AppUpdatePanel.releasedUnderApache20")}</Text>
    <View style={{ marginTop: 16 }}><Action title={busy ? t("ForkContributionPanel.checking") : t("AppUpdatePanel.checkForUpdates")} secondary disabled={busy} onPress={() => { void check(); }} /></View>
    {busy && <ActivityIndicator accessibilityLabel={t("AppUpdatePanel.checkingForUpdates")} color={palette.blue} style={{ marginTop: 12 }} />}
    {result && <Text accessibilityLiveRegion="polite" style={{ color: result.available ? palette.blue : palette.green, lineHeight: 21, marginTop: 12 }}>{result.available ? t("AppUpdatePanel.versionIsAvailable", { p0: result.latestVersion }) : t("AppUpdatePanel.youAreUpToDate")}</Text>}
    {result?.available && <Pressable accessibilityRole="link" onPress={() => { void openRelease(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%', minHeight: 48, paddingVertical: 12 }}>
      <Text style={{ color: palette.blue, fontWeight: '700', minWidth: 0, flexShrink: 1 }}>{t("AppUpdatePanel.viewUpdateAndDownload")}</Text>
      <MaterialArrow name="external" color={palette.blue} />
    </Pressable>}
    {error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: themed('#bf3947'), lineHeight: 21, marginTop: 12 }}>{message}</Text>}
  </Card>;
}
