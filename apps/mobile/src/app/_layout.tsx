import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/features/auth/session';
import { PreferencesProvider } from '@/features/preferences/provider';
import { AppAlertProvider } from '@/components/AppAlert';
import { useReducedMotion } from '@/features/motion/useReducedMotion';

export default function RootLayout() {
  const reducedMotion = useReducedMotion();
  return <SafeAreaProvider><PreferencesProvider><SessionProvider><AppAlertProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, animation: reducedMotion ? 'fade' : 'default', animationMatchesGesture: reducedMotion, contentStyle: { backgroundColor: '#f5f8fd' } }} /></AppAlertProvider></SessionProvider></PreferencesProvider></SafeAreaProvider>;
}
