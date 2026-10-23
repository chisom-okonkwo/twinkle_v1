import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.column}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Action({ title, onPress, disabled, secondary, destructive }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; destructive?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.button, secondary && styles.secondary, destructive && styles.destructive, (disabled || pressed) && styles.dim]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
    </Pressable>
  );
}

export function Message({ text, error = false }: { text: string | null; error?: boolean }) {
  return text ? <Text accessibilityLiveRegion="polite" style={[styles.message, error && styles.error]}>{text}</Text> : null;
}

export function errorMessage(error: unknown) {
  return error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
    ? String(error.message) : 'Something went wrong. Please try again.';
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#faf9f6' },
  content: { flexGrow: 1, padding: 20 },
  column: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 16 },
  title: { fontSize: 30, fontWeight: '700', color: '#29263d' },
  subtitle: { fontSize: 16, lineHeight: 24, color: '#585466' },
  label: { fontSize: 16, fontWeight: '600', color: '#29263d' },
  input: { borderWidth: 1, borderColor: '#aaa6b6', backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 17, color: '#29263d' },
  editor: { minHeight: 200, textAlignVertical: 'top' },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, padding: 12, backgroundColor: '#55458d' },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  secondary: { backgroundColor: '#eeebf4' },
  secondaryText: { color: '#403567' },
  destructive: { backgroundColor: '#a32d35' },
  dim: { opacity: 0.5 },
  message: { fontSize: 15, lineHeight: 22, color: '#403567' },
  error: { color: '#9c2730' },
  card: { padding: 16, borderWidth: 1, borderColor: '#ddd9e5', borderRadius: 12, gap: 8, backgroundColor: '#fff' },
});
