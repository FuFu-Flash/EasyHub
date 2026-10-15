import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useSession } from '@/features/auth/session';
import { Page, palette } from './elements';
import { SessionConnectionNotice } from './SessionConnectionNotice';

/** Keep the router mounted so sign-in and settings remain reachable from failed startup. */
export function SessionRecoveryBoundary({ children }: { children: ReactNode }) {
  const { ready, recovery, user } = useSession();
  const pathname = usePathname();
  const blocked = ready && !!recovery && !user && pathname !== '/login' && pathname !== '/settings';
  return <View style={{ flex: 1 }}>
    <View style={{ flex: 1 }} pointerEvents={blocked ? 'none' : 'auto'} accessibilityElementsHidden={blocked}
      importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}>{children}</View>
    {blocked && <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}>
      <Page><View style={{ paddingTop: 48 }}><SessionConnectionNotice full /></View></Page>
    </View>}
  </View>;
}
