import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, TextInput, View } from 'react-native';
import { Action, Message, Screen, styles } from '../components/ui';
import { formatNoteDate, noteStyles, TextAction } from '../components/note-ui';
import { dismissDiscovery, nextDiscovery, type DiscoveryItem, type DiscoveryRequest } from '../lib/discovery';
import { useAuth } from '../providers/auth-provider';
export default function DiscoveryRoute() {
  const { session } = useAuth();
  return session ? <DiscoverThoughts key={session.user.id} userId={session.user.id} /> : null;
}
function DiscoverThoughts({ userId }: { userId: string }) {
  const [sessionId, setSessionId] = useState(() => randomUUID());
  const [topic, setTopic] = useState('');
  const [item, setItem] = useState<DiscoveryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [mode, setMode] = useState<DiscoveryRequest['mode']>('surprise');
  const [error, setError] = useState<string | null>(null);
  const last = useRef<DiscoveryRequest | null>(null), active = useRef(false), busy = useRef(false), generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const cancel = useCallback(() => { generation.current++; controller.current?.abort(); busy.current = false; }, []);
  const run = useCallback(async (request: DiscoveryRequest) => {
    cancel(); const current = generation.current, abort = new AbortController(); controller.current = abort;
    busy.current = true; setLoading(true); setItem(null); setError(null); setMode(request.mode);
    try {
      const result = await nextDiscovery(request,abort.signal);
      if (active.current && current === generation.current) { setItem(result); setFinished(true); if (result) setSeen(previous => previous.includes(result.note_id) ? previous : [...previous,result.note_id]); }
    } catch {
      if (active.current && current === generation.current) setError('Couldn’t discover a thought. Check your connection and try again.');
    } finally { if (active.current && current === generation.current) { busy.current = false; setLoading(false); } }
  }, [cancel]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    if (last.current) void run(last.current);
    const subscription = AppState.addEventListener('change',state => { if (state === 'active' && last.current) void run(last.current); else if (state !== 'active') cancel(); });
    return () => { active.current = false; cancel(); subscription.remove(); };
  }, [run,cancel]));
  function start(mode: DiscoveryRequest['mode'], value = topic, round = sessionId) {
    if (busy.current) return;
    const request = { mode, topic: mode === 'topic' ? value.trim() : '', sessionId: round, requestId: randomUUID() };
    last.current = request; void run(request);
  }
  async function dismiss() {
    if (!item || busy.current) return;
    busy.current = true; setLoading(true); const current = generation.current;
    try {
      await dismissDiscovery(userId,item.request_id);
      if (!active.current || current !== generation.current) return;
      busy.current = false; setLoading(false); start(last.current?.mode ?? 'surprise',last.current?.topic ?? '');
    } catch { if (active.current && current === generation.current) { busy.current = false; setLoading(false); setError('This thought could not be skipped. Please retry.'); } }
  }
  const exhausted = finished && !item && !loading && !error && mode === 'surprise' && seen.length > 0;
  function anotherRound() { const round = randomUUID(); setSessionId(round); setSeen([]); start('surprise','',round); }
  return <Screen>
    <TextAction title="‹ Notes" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
    <Text accessibilityRole="header" style={styles.title}>Discover a thought</Text>
    <Text style={styles.subtitle}>A little room to revisit something you kept.</Text>
    <Action title={exhausted ? "Start another round" : "Surprise me"} disabled={loading} onPress={() => exhausted ? anotherRound() : start('surprise')} />
    <TextInput accessibilityLabel="Optional topic to explore" placeholder="Or explore a topic, source, or idea" value={topic} onChangeText={setTopic} maxLength={200} editable={!loading} style={styles.input} returnKeyType="search" onSubmitEditing={() => { if (/[\p{L}\p{N}]/u.test(topic)) start('topic'); }} />
    <Action secondary title="Explore this topic" disabled={loading || !/[\p{L}\p{N}]/u.test(topic)} onPress={() => start('topic')} />
    <Message text={error} error />
    {error ? <TextAction title="Try again" disabled={loading} onPress={() => { if (!busy.current && last.current) void run(last.current); }} /> : null}
    {loading ? <ActivityIndicator accessibilityLabel="Finding a thought to rediscover" color="#55458d" /> : item ? <View style={styles.card}>
      <Text style={noteStyles.eyebrow}>FROM YOUR NOTES</Text>
      <Text style={noteStyles.heading}>{item.title}</Text>
      <Text style={noteStyles.meta}>{formatNoteDate(item.created_at)}{item.capture_method === 'image' ? ' · Photo' : item.capture_method === 'audio' ? ' · Audio' : ''}</Text>
      <Text style={noteStyles.preview}>{item.preview}</Text>
      <Action title="Open original note" onPress={() => router.push({ pathname:'/note',params:{id:item.note_id} })} />
      <TextAction title="Another thought" onPress={() => start(last.current?.mode ?? 'surprise',last.current?.topic ?? '')} />
      <TextAction title="Not for me" onPress={() => void dismiss()} />
    </View> : finished && !error ? <View style={noteStyles.state}>
      <Text style={noteStyles.heading}>{mode === 'topic' ? 'No more thoughts for this topic' : exhausted ? 'You’ve explored this round' : 'Nothing to rediscover just yet'}</Text>
      <Text style={noteStyles.stateText}>{mode === 'topic' ? 'Try another idea or source name. Recently seen and excluded notes get some space.' : exhausted ? 'Start another round to revisit available thoughts again, or explore a topic.' : 'There may not be enough eligible thoughts yet. Try a topic, or come back after capturing a little more.'}</Text>
    </View> : null}
  </Screen>;
}
