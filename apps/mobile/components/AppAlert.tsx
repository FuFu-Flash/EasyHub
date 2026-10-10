import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { palette } from './elements';
import { usePreferences } from '@/features/preferences/provider';

type Button = { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };
type Dialog = { title: string; message?: string; buttons: Button[] };
let showDialog: ((dialog: Dialog) => void) | null = null;

/** In-app replacement for Android's system alert. */
export const AppAlert = {
  alert(title: string, message?: string, buttons?: Button[]): void {
    showDialog?.({ title, message, buttons: buttons ?? [] });
  },
};

export function AppAlertProvider({ children }: { children: ReactNode }) {
  const { t } = usePreferences();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  useEffect(() => { showDialog = setDialog; return () => { showDialog = null; }; }, []);
  const dismiss = () => setDialog(null);
  return <>{children}<Modal visible={!!dialog} transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
    <View style={{ flex: 1, backgroundColor: 'rgba(18, 34, 58, 0.46)', justifyContent: 'center', padding: 22 }}>
      <Pressable onPress={dismiss} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} accessibilityLabel="Close dialog" />
      <View style={{ backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: palette.border, padding: 22, maxHeight: '78%' }}>
        <Text style={{ color: palette.ink, fontSize: 21, fontWeight: '800' }}>{dialog?.title}</Text>
        {!!dialog?.message && <ScrollView style={{ flexGrow: 0, marginTop: 11, marginBottom: 20 }}><Text style={{ color: palette.muted, fontSize: 15, lineHeight: 23 }}>{dialog.message}</Text></ScrollView>}
        <View style={{ gap: 9, marginTop: dialog?.message ? 0 : 22 }}>{(dialog?.buttons.length ? dialog.buttons : [{ text: t('知道了', 'OK') }]).map((button, index) => {
          const quiet = button.style === 'cancel';
          const danger = button.style === 'destructive';
          return <Pressable key={`${button.text}-${index}`} accessibilityRole="button" onPress={() => { setDialog(null); button.onPress?.(); }} style={{ minHeight: 48, borderRadius: 11, justifyContent: 'center', alignItems: 'center', borderWidth: 1,
            borderColor: quiet ? palette.border : danger ? '#e9b7bf' : palette.blue, backgroundColor: quiet ? '#fff' : danger ? '#fff2f3' : palette.blue }}>
            <Text style={{ color: quiet ? palette.ink : danger ? '#b43449' : '#fff', fontWeight: '800', fontSize: 15 }}>{button.text || '确定'}</Text>
          </Pressable>;
        })}</View>
      </View>
    </View>
  </Modal></>;
}
