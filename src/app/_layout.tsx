import { CaptureConnectionsProvider } from '../providers/capture-connections-provider';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text } from 'react-native';

import { Screen, styles } from '../components/ui';
import { configurationError } from '../lib/supabase';
import { RecallNotificationBridge } from '../components/recall-notification-bridge';
import { AuthProvider, useAuth } from '../providers/auth-provider';

function Routes() {
  const { session, loading } = useAuth();
  if (configurationError)
    return (
      <Screen>
        <Text style={styles.title}>Set up Twinkle</Text>
        <Text style={styles.subtitle}>{configurationError}</Text>
      </Screen>
    );
  if (loading)
    return (
      <Screen>
        <ActivityIndicator accessibilityLabel="Restoring your session" />
      </Screen>
    );
  return (
    <CaptureConnectionsProvider key={session?.user.id ?? 'signed-out'}>
      {session ? <RecallNotificationBridge key={session.user.id} userId={session.user.id} /> : null}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="index" />
          <Stack.Screen name="note" />
          <Stack.Screen name="search" />
          <Stack.Screen name="discover" />
          <Stack.Screen name="themes" />
          <Stack.Screen name="reflect" />
          <Stack.Screen name="import" />
          <Stack.Screen name="flashback" />
          <Stack.Screen name="recall-settings" />
        </Stack.Protected>
      </Stack>
    </CaptureConnectionsProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Routes />
    </AuthProvider>
  );
}
