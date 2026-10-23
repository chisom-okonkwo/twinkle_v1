import { useState } from 'react';
import { Text, TextInput } from 'react-native';

import { Action, errorMessage, Message, Screen, styles } from '../components/ui';
import { getSupabase } from '../lib/supabase';
import { useAuth } from '../providers/auth-provider';

export default function SignInScreen() {
  const { error: sessionError } = useAuth();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);
    setMessage(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (register && password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const credentials = { email: email.trim(), password };
      const { data, error: authError } = register
        ? await getSupabase().auth.signUp(credentials)
        : await getSupabase().auth.signInWithPassword(credentials);
      if (authError) throw authError;
      setPassword('');
      if (register && !data.session) {
        setMessage('Check your email to confirm your account. Then return here and sign in.');
        setRegister(false);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>Twinkle</Text>
      <Text style={styles.subtitle}>A quiet place for your thoughts.</Text>
      <Text style={styles.label}>{register ? 'Create your account' : 'Welcome back'}</Text>
      <Text nativeID="email-label" style={styles.label}>Email</Text>
      <TextInput accessibilityLabel="Email" accessibilityLabelledBy="email-label" style={styles.input}
        value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
        autoComplete="email" editable={!busy} placeholder="you@example.com" placeholderTextColor="#777182" />
      <Text nativeID="password-label" style={styles.label}>Password</Text>
      <TextInput accessibilityLabel="Password" accessibilityLabelledBy="password-label" style={styles.input}
        value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
        autoComplete={register ? 'new-password' : 'current-password'} editable={!busy}
        onSubmitEditing={submit} returnKeyType="go" />
      <Message text={error ?? sessionError} error />
      <Message text={message} />
      <Action title={busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'} disabled={busy} onPress={submit} />
      <Action title={register ? 'Already have an account? Sign in' : 'New here? Create an account'} disabled={busy} secondary
        onPress={() => { setRegister(!register); setPassword(''); setError(null); setMessage(null); }} />
    </Screen>
  );
}
