import { useEffect } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionRecoveryBoundary } from '@/components/SessionRecoveryBoundary';
import { SessionProvider } from '@/features/auth/session';
import { PreferencesProvider, usePreferences } from '@/features/preferences/provider';
import { AppAlertProvider } from '@/components/AppAlert';
import { useReducedMotion } from '@/features/motion/useReducedMotion';
import { applyTheme, palette, resolveTheme } from '@/features/theme/theme';

function ThemedStack() {
  const reducedMotion = useReducedMotion();
  const { theme: preference } = usePreferences();
  const theme = resolveTheme(preference, useColorScheme());
  // Screens read the shared colours while rendering, so the active theme is set before they mount.
  applyTheme(theme);
  useEffect(() => { Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference); }, [preference]);
  return <AppAlertProvider key={theme}><SessionRecoveryBoundary><StatusBar style={theme === 'dark' ? 'light' : 'dark'} /><Stack screenOptions={{ headerShown: false, animation: reducedMotion ? 'fade' : 'default', animationMatchesGesture: reducedMotion, contentStyle: { backgroundColor: palette.background } }} /></SessionRecoveryBoundary></AppAlertProvider>;
}

export default function RootLayout() {
  return <SafeAreaProvider><PreferencesProvider><SessionProvider><ThemedStack /></SessionProvider></PreferencesProvider></SafeAreaProvider>;
}
