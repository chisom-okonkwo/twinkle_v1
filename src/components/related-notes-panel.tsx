import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { recordResurfacedNotes, dismissRelatedNote, resurfacingEligible, readRelatedNotes, relatedStatus, requestRelatedNotes, type RelatedNote } from '../lib/related';
import { getContextPreference } from '../lib/context';
import { errorMessage } from './ui';
import { formatNoteDate, noteStyles, TextAction } from './note-ui';
export function RelatedNotesPanel({ userId, noteId, capture = false }: { userId: string; noteId: string; capture?: boolean }) {
  const [rows, setRows] = useState<RelatedNote[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dismissing, setDismissing] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true, polling = false, checks = 0, cycle = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    async function check() {
      if (!active || polling || AppState.currentState !== 'active') return;
      polling = true;
      const current = cycle;
      try {
        const row = await relatedStatus(userId, noteId);
        if (!active || current !== cycle) return;
        // Edits/consent changes invalidate the run. Never retain old links in the UI.
        if (!row) {
          setRows([]);
          if (++checks >= 32) { setStatus('waiting'); stop(); return; }
          const result = await requestRelatedNotes(noteId);
          if (!active || current !== cycle) return;
          if (result.status === 'disabled') { setStatus(''); stop(); }
          else if (result.status === 'failed') throw new Error('Related thoughts could not be prepared. Your note is safe.');
          else setStatus('processing');
          return;
        }
        if (row.status === 'completed') {
          const results = await readRelatedNotes(noteId, capture);
          if (active && current === cycle) { setRows(results); setStatus('completed'); setError(null); stop();
            if (capture && results.length) void recordResurfacedNotes(noteId,results.map(row=>row.id)).catch(()=>{}); }
        } else if (row.status === 'failed') { setRows([]); setStatus('failed'); setError('Related thoughts could not be prepared. Your note is safe.'); stop(); }
        else if (++checks >= 32) { setStatus('waiting'); stop(); }
      } catch (cause) { if (active && current === cycle) { setRows([]); setError(errorMessage(cause)); setStatus('failed'); stop(); } }
      finally { polling = false; }
    }
    async function start() {
      const current = ++cycle; stop(); checks = 0;
      if (!active) return;
      setRows([]); setError(null); setStatus('');
      try {
        if (!await getContextPreference(userId) || !active || current !== cycle) return;
        if (capture && !await resurfacingEligible(userId,noteId)) return;
        if (!active || current !== cycle) return;
        setStatus('processing');
        const result = await requestRelatedNotes(noteId, attempt > 0);
        if (!active || current !== cycle) return;
        setStatus(result.status === 'waiting_context' ? 'processing' : result.status);
        if (result.status === 'disabled') return;
        if (result.status === 'failed') throw new Error('Related thoughts could not be prepared. Try again in a moment.');
        timer = setInterval(() => void check(), 2500);
        await check();
      } catch (cause) { if (active && current === cycle) { setError(errorMessage(cause)); setStatus('failed'); } }
    }
    void start();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void start();
      else { cycle++; stop(); setRows([]); }
    });
    return () => { active = false; cycle++; stop(); listener.remove(); };
  }, [userId, noteId, attempt, capture]));
  async function dismiss(id: string) {
    if (dismissing) return;
    setDismissing(id);
    try { await dismissRelatedNote(noteId,id); setRows(current => current.filter(row => row.id !== id)); setError(null); }
    catch { setError('This connection could not be hidden. Please retry.'); }
    finally { setDismissing(null); }
  }
  if (capture && !rows.length) return null;
  if (!rows.length && !error && !['processing','waiting'].includes(status)) return null;
  return <View style={{ gap: 10, marginTop: 16 }}>
    {rows.length ? <>
      <Text style={noteStyles.eyebrow}>{capture ? "YOU’VE EXPLORED SOMETHING SIMILAR BEFORE" : "RELATED THOUGHTS"}</Text>
      {rows.map(row => <View key={row.id} style={{ gap: 4 }}>
        <TextAction title={row.title} onPress={() => router.push({ pathname: '/note', params: { id: row.id } })} />
        <Text style={noteStyles.meta}>{formatNoteDate(row.created_at)}</Text>
        <Text style={noteStyles.preview}>{row.explanation}</Text>
        {capture ? <TextAction title={dismissing === row.id ? "Hiding…" : "Not now"} disabled={Boolean(dismissing)} onPress={() => void dismiss(row.id)} /> : null}
      </View>)}
    </> : <Text style={noteStyles.meta}>{error ?? (status === 'waiting' ? 'Related thoughts are still being prepared.' : 'Looking for a meaningful connection…')}</Text>}
    {capture && error ? <Text style={noteStyles.meta}>{error}</Text> : null}
    {!capture && (error || status === 'waiting') ? <TextAction title="Check related thoughts again" onPress={() => setAttempt(n => n + 1)} /> : null}
  </View>;
}
