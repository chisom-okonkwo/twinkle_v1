import 'react-native-url-polyfill/auto';
import { createClient, processLock } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { withDeadline } from './capture-network';

import type { Database } from './database.types';
import { sessionStorage } from './session-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const configurationError = !url || !key || url.includes('YOUR_PROJECT_REF') || !key.startsWith('sb_publishable_') || key.includes('REPLACE_ME')
  ? 'Add the Supabase project URL and publishable key to .env.local, then reload the app. See README.md for setup.'
  : !/^https:\/\//.test(url)
    ? 'EXPO_PUBLIC_SUPABASE_URL must be an HTTPS project URL.'
    : null;

// No fallback backend or privileged key: missing configuration shows setup guidance.
export const supabase = configurationError ? null : createClient<Database>(url!, key!, {
  global: { fetch: (input, init) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (target.startsWith(`${url}/storage/v1/`)) {
      const timeout = init?.method === 'POST' && target.includes('/object/') && !target.includes('/sign/') ? 45000 : 15000;
      return withDeadline((signal) => expoFetch(input, { ...init, signal }), timeout, init?.signal ?? undefined);
    }
    return fetch(input, init);
  } },
  auth: {
    storage: sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    ...(Platform.OS !== 'web' ? { lock: processLock } : {}),
  },
});

export function getSupabase() {
  if (!supabase) throw new Error(configurationError ?? 'Supabase is not configured.');
  return supabase;
}
