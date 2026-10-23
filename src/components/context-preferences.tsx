import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { getContextPreference, resumePendingContexts, setContextPreference } from '../lib/context';
import { TextAction, noteStyles } from './note-ui';
import { Action, Message, errorMessage } from './ui';

export function ContextPreferences({ userId }: { userId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const load = useCallback(() => {
    return getContextPreference(userId).then((value) => {
      if (!active.current) return;
      setEnabled(value); setLoaded(true); setError(null);
      if (value) void resumePendingContexts(userId).catch(() => {});
    }).catch(() => { if (active.current) setError('Context settings could not be loaded. Your notes still work.'); });
  }, [userId]);
  useFocusEffect(useCallback(() => {
    active.current = true; void load();
    return () => { active.current = false; };
  }, [load]));
  async function toggle() {
    setBusy(true); setError(null);
    try { const value = await setContextPreference(userId, !enabled); if (active.current) setEnabled(value); }
    catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  return <View style={{ gap: 4 }}>
    <TextAction title={loaded ? `AI context · ${enabled ? 'On' : 'Off'}` : 'AI context settings'} onPress={() => setExpanded((value) => !value)} />
    {expanded ? <View style={{ gap: 8 }}>
      <Text style={noteStyles.meta}>When enabled, new and edited notes are sent securely to OpenAI after saving to preserve useful context. Your original words stay unchanged. Older notes are analyzed only when you save an edit or choose Analyze context on that note.</Text>
      <Text style={noteStyles.meta}>You can turn this off at any time. Your own added context is always available.</Text>
      <Action secondary title={busy ? 'Updating…' : enabled ? 'Disable future enrichment' : 'Enable AI context'} disabled={!loaded || busy} onPress={() => void toggle()} />
    </View> : null}
    <Message text={error} error />
    {error ? <TextAction title="Reload context settings" onPress={() => void load()} /> : null}
  </View>;
}
