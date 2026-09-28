import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { Action, Card, Heading, Page, palette } from '@/components/elements';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { awaitDeviceAuthorization, requestDeviceCode } from '@/features/auth/deviceFlow';

export default function Login() {
  const { signIn } = useSession();
  const { t } = usePreferences();
  const [code, setCode] = useState<{ user_code: string; verification_uri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = useRef<AbortController | null>(null);
  useEffect(() => () => cancel.current?.abort(), []);
  const begin = async () => {
    cancel.current?.abort();
    const controller = new AbortController(); cancel.current = controller;
    setBusy(true); setCode(null); setError('');
    try {
      const authorization = await requestDeviceCode(controller.signal);
      if (controller.signal.aborted) return;
      setCode(authorization);
      const credential = await awaitDeviceAuthorization(authorization, controller.signal);
      if (controller.signal.aborted) return;
      await signIn(credential);
      router.replace('/');
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t('登录失败，请重试。', 'Sign-in failed. Please try again.'));
    } finally { setBusy(false); }
  };
  return <Page><Text onPress={() => router.back()} style={{ color: palette.blue, marginBottom: 28 }}>← {t('返回', 'Back')}</Text><Heading title={t('使用 GitHub 登录', 'Sign in with GitHub')} subtitle={t('EasyHub 会打开 GitHub 授权页面。登录后即可在手机上查看和管理项目。', 'EasyHub opens GitHub for authorization. You can then view and manage projects on your phone.')} />
    <Card><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '700' }}>{t('安全连接你的账号', 'Connect your account securely')}</Text><Text style={{ color: palette.muted, lineHeight: 23, marginTop: 10 }}>{t('EasyHub 不建立新账号。登录信息仅保存在这台设备的安全存储中。', 'EasyHub does not create a separate account. Sign-in details stay in secure storage on this device.')}</Text></Card>
      {code && <Card><Text style={{ color: palette.muted }}>{t('复制验证码，然后在 GitHub 页面粘贴', 'Copy the code and paste it on GitHub')}</Text><Text selectable style={{ color: palette.ink, fontSize: 30, fontWeight: '800', letterSpacing: 3, marginVertical: 14 }}>{code.user_code}</Text><Action title={t('复制验证码并打开 GitHub', 'Copy code and open GitHub')} secondary onPress={() => { void Clipboard.setStringAsync(code.user_code).then(() => WebBrowser.openBrowserAsync(code.verification_uri)); }} /><Text style={{ color: palette.muted, marginTop: 14 }}>{t('完成授权后回到 EasyHub，登录会自动完成。', 'Return to EasyHub after authorization. Sign-in completes automatically.')}</Text></Card>}
    {!!error && <Text style={{ color: '#bf3947', marginBottom: 14 }}>{error}</Text>}
    <Action title={busy ? t('正在等待授权…', 'Waiting for authorization…') : t('开始登录', 'Start sign-in')} disabled={busy} onPress={() => { void begin(); }} />
    {busy && <View style={{ marginTop: 12 }}><Action title={t('取消登录', 'Cancel sign-in')} secondary onPress={() => { cancel.current?.abort(); setBusy(false); setCode(null); }} /></View>}
  </Page>;
}
