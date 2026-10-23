import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';

import { supabase } from '../lib/supabase';

const AuthContext = createContext<{
  session: Session | null;
  loading: boolean;
  error: string | null;
}>({ session: null, loading: true, error: null });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    let receivedAuthEvent = false;

    // Keep callbacks synchronous: awaiting auth methods here can deadlock the auth lock.
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      receivedAuthEvent = true;
      if (active) {
        setSession(nextSession);
        setError(null);
        setLoading(false);
      }
    });

    client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || receivedAuthEvent) return;
      setSession(data.session);
      setError(sessionError?.message ?? null);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError('Unable to restore your session. Please sign in again.');
      setLoading(false);
    });

    function syncRefresh(state: string | null | undefined) {
      if (state === 'active') client!.auth.startAutoRefresh();
      else client!.auth.stopAutoRefresh();
    }
    const listener = Platform.OS === 'web' ? null : AppState.addEventListener('change', syncRefresh);
    if (Platform.OS !== 'web') syncRefresh(AppState.currentState);

    return () => {
      active = false;
      subscription.unsubscribe();
      listener?.remove();
      if (Platform.OS !== 'web') client.auth.stopAutoRefresh();
    };
  }, []);

  return <AuthContext.Provider value={{ session, loading, error }}>{children}</AuthContext.Provider>;
}
