import { Stack } from 'expo-router';
import { DesignNotesProvider } from '../../providers/design-notes-provider';

export default function DesignLayout() {
  return <DesignNotesProvider><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f5f6f3' } }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="calendar" options={{ animation: 'none' }} />
    <Stack.Screen name="vibe" options={{ animation: 'none' }} />
    <Stack.Screen name="editor" />
    <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
  </Stack></DesignNotesProvider>;
}
