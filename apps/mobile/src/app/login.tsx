import { localizeError } from '../../features/localization/error.ts';
import { useTranslation } from '@/features/localization/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { Action, BackLink, Card, Heading, Page, palette } from '@/components/elements';
import { useSession } from '@/features/auth/session';

import { awaitDeviceAuthorization, requestDeviceCode } from '@/features/auth/deviceFlow';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';

export default function Login() {
  const { signIn } = useSession();
  const t = useTranslation();
  const [code, setCode] = useState<{ user_code: string; verification_uri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { value: error, set: setError, capture } = usePageFeedback();
  const cancel = useRef<AbortController | null>(null);
  useEffect(() => () => cancel.current?.abort(), []);
  useFocusEffect(useCallback(() => () => { cancel.current?.abort(); setBusy(false); setCode(null); }, []));
  const begin = async () => {
    cancel.current?.abort();
    const controller = new AbortController(); cancel.current = controller;
    const current = capture();
    setBusy(true); setCode(null); setError('');
    try {
      const authorization = await requestDeviceCode(controller.signal);
      if (controller.signal.aborted || !current()) return;
      setCode(authorization);
      const credential = await awaitDeviceAuthorization(authorization, controller.signal);
      if (controller.signal.aborted || !current()) return;
      await signIn(credential);
      if (current()) router.replace('/');
    } catch (reason) {
      if (!controller.signal.aborted && current()) setError(localizeError(reason, t, t("login.signInFailedPleaseTryAgain")));
    } finally { setBusy(false); }
  };
  return <Page><BackLink title={t("analysis.back")} marginBottom={28} /><Heading title={t("discover.signInWithGitHub")} subtitle={t("login.easyhubOpensGitHubForAuthorizationYouCanThenViewAndManage")} />
    <Card><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '700' }}>{t("login.connectYourAccountSecurely")}</Text><Text style={{ color: palette.muted, lineHeight: 23, marginTop: 10 }}>{t("login.easyhubDoesNotCreateASeparateAccountSignInDetailsStay")}</Text></Card>
      {code && <Card><Text style={{ color: palette.muted }}>{t("login.copyTheCodeAndPasteItOnGitHub")}</Text><Text selectable style={{ color: palette.ink, fontSize: 30, fontWeight: '800', letterSpacing: 3, marginVertical: 14 }}>{code.user_code}</Text><Action title={t("login.copyCodeAndOpenGitHub")} secondary onPress={() => { void Clipboard.setStringAsync(code.user_code).then(() => WebBrowser.openBrowserAsync(code.verification_uri)); }} /><Text style={{ color: palette.muted, marginTop: 14 }}>{t("login.returnToEasyHubAfterAuthorizationSignInCompletesAutomatically")}</Text></Card>}
    {!!error && <Text style={{ color: '#bf3947', marginBottom: 14 }}>{error}</Text>}
    <Action title={busy ? t("login.waitingForAuthorization") : t("login.startSignIn")} disabled={busy} onPress={() => { void begin(); }} />
    {busy && <View style={{ marginTop: 12 }}><Action title={t("login.cancelSignIn")} secondary onPress={() => { cancel.current?.abort(); setBusy(false); setCode(null); }} /></View>}
  </Page>;
}
