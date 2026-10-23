import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text } from 'react-native';

import { Screen, styles } from '../components/ui';
import { configurationError } from '../lib/supabase';
import { AuthProvider, useAuth } from '../providers/auth-provider';

function Routes() {
  const { session, loading } = useAuth();
  if (configurationError) return <Screen><Text style={styles.title}>Set up Twinkle</Text><Text style={styles.subtitle}>{configurationError}</Text></Screen>;
  if (loading) return <Screen><ActivityIndicator accessibilityLabel="Restoring your session" /></Screen>;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!session}><Stack.Screen name="sign-in" /></Stack.Protected>
      <Stack.Protected guard={Boolean(session)}><Stack.Screen name="index" /></Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return <AuthProvider><StatusBar style="dark" /><Routes /></AuthProvider>;
}
