import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, TextInput, View } from 'react-native';
import { CONTEXT_FIELDS, type GeneratedContext, validateContextAnalysis } from '../../supabase/functions/_shared/context-contract';
import { contextHash, getContextPreference, getNoteContext, requestContext, saveUserContext, startSavedContext, type NoteContext } from '../lib/context';
import type { Note } from '../lib/notes';
import { Action, Message, errorMessage, styles } from './ui';
import { Confirmation, TextAction, noteStyles } from './note-ui';

const labels = { topics: 'Topics', details: 'Details', intentions: 'Intentions', concerns: 'Concerns', open_questions: 'Open questions', emotions: 'Expressed feelings' };
export function NoteContextPanel({ userId, note, noteDirty, disabled, onDirty }: {
  userId: string; note: Note; noteDirty: boolean; disabled: boolean; onDirty: (dirty: boolean) => void;
}) {
  const [data, setData] = useState<{ row: NoteContext; enabled: boolean; hash: string; version: string; checkedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [extra, setExtra] = useState('');
  const [answer, setAnswer] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const active = useRef(true);
  const fetching = useRef(false);
  const starting = useRef(false);
  const request = useRef(0);
  const editBase = useRef<NoteContext | null>(null);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    fetching.current = true;
    try {
      const [row, enabled, hash] = await Promise.all([getNoteContext(userId, note.id), getContextPreference(userId), contextHash(note.content)]);
      if (!active.current || current !== request.current) return;
      setData({ row, enabled, hash, version: note.updated_at, checkedAt: Date.now() });
      setLoadError(null);
      if (enabled && row.status === 'pending' && !starting.current) {
        starting.current = true;
        void startSavedContext(userId, note.id).catch(() => {}).finally(() => { starting.current = false; });
      }
    } catch (cause) { if (active.current && current === request.current) setLoadError(errorMessage(cause)); }
    finally { if (current === request.current) fetching.current = false; }
  }, [userId, note.id, note.content, note.updated_at]);
  const invalidate = useCallback(() => { active.current = false; request.current++; }, []);
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(refresh);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { invalidate(); listener.remove(); };
  }, [refresh, invalidate]);
  const row = data?.row;
  useEffect(() => {
    if (!['pending', 'processing'].includes(row?.status ?? '')) return;
    let checks = 0;
    const timer = setInterval(() => {
      if (++checks >= 40) { clearInterval(timer); return; }
      if (AppState.currentState === 'active' && !fetching.current) void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [row?.status, refresh]);

  const current = Boolean(data && data.version === note.updated_at && data.hash === row?.source_hash && !noteDirty);
  let generated: GeneratedContext | null = null;
  if (current && row?.status === 'completed' && row.generated_context) {
    try { generated = validateContextAnalysis({ ...(row.generated_context as object), missing_context: null }, note.content); } catch { /* Never display unvalidated AI data. */ }
  }
  const questionVisible = Boolean(current && generated && row?.prompt_question && row.prompt_revision === row.revision && !row.prompt_dismissed && !row.answer && !row.user_context.trim());
  const stale = row?.status === 'processing' && Date.parse(row.processing_started_at ?? '') < (data?.checkedAt ?? 0) - 120000;

  async function analyze() {
    setBusy(true); setError(null);
    try { await requestContext(note.id, { manual: true, retry: true }); await refresh(); }
    catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  function edit() {
    if (!row) return;
    editBase.current = row; setExtra(row.user_context); setAnswer(row.answer); setEditing(true); onDirty(false);
  }
  function changeExtra(value: string) { setExtra(value); onDirty(value !== editBase.current?.user_context || answer !== editBase.current?.answer); }
  function changeAnswer(value: string) { setAnswer(value); onDirty(extra !== editBase.current?.user_context || value !== editBase.current?.answer); }
  async function update(values: { user_context?: string; answer?: string; prompt_dismissed?: boolean }, previous = row) {
    if (!previous || !data) return;
    setBusy(true); setError(null); setConfirmRemove(false);
    try {
      const saved = await saveUserContext(userId, previous, values);
      if (active.current) { setData((old) => old ? { ...old, row: saved } : old); setEditing(false); onDirty(false); }
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  const locked = busy || disabled;
  const visibleError = error ?? loadError;
  function reloadContext() { setConfirmReload(false); setEditing(false); onDirty(false); setError(null); void refresh(); }
  return <View style={{ gap: 10, marginTop: 16 }}>
    <Text style={styles.label}>A little context</Text>
    {!data ? <><Message text={visibleError} error />{!visibleError ? <ActivityIndicator accessibilityLabel="Loading note context" color="#55458d" /> : <TextAction title="Reload context" onPress={() => void refresh()} />}</> : <>
      {noteDirty ? <Text style={noteStyles.meta}>Save your note changes to refresh generated context.</Text> : null}
      {current && ['pending', 'processing'].includes(row!.status) ? <Text style={noteStyles.meta}>Context is being prepared. Your note is already saved.</Text> : null}
      {current && ['pending', 'processing'].includes(row!.status) ? <TextAction title="Refresh context" disabled={locked} onPress={() => void refresh()} /> : null}
      {current && row!.status === 'failed' ? <Text style={noteStyles.meta}>Context could not be prepared. Your note and added context are safe.</Text> : null}
      {generated?.situation ? <Text style={noteStyles.preview}>{generated.situation.certainty === 'interpretation' ? 'Possible context: ' : 'From your note: '}{generated.situation.quote}</Text> : null}
      {generated ? <>
        <TextAction title={expanded ? 'Hide generated context' : 'View generated context'} onPress={() => setExpanded((value) => !value)} />
        {expanded ? <View style={{ gap: 8 }}>
          <Text style={noteStyles.meta}>AI-selected excerpts, kept separate from your original note. Check the original for the full meaning.</Text>
          {CONTEXT_FIELDS.map((field) => generated![field].length ? <View key={field}><Text style={noteStyles.meta}>{labels[field]}</Text>{generated![field].map((cue, index) => <Text key={index} style={noteStyles.preview}>{cue.certainty === 'interpretation' ? 'Possible: ' : ''}{cue.quote}</Text>)}</View> : null)}
          {!generated.situation && CONTEXT_FIELDS.every((field) => !generated![field].length) ? <Text style={noteStyles.meta}>No additional context was needed.</Text> : null}
        </View> : null}
      </> : null}
      {current && data.enabled && (['disabled', 'failed', 'pending'].includes(row!.status) || stale) ? <TextAction title={busy ? 'Starting…' : row!.status === 'failed' || stale ? 'Retry context analysis' : 'Analyze context'} disabled={locked} onPress={() => void analyze()} /> : null}
      {!data.enabled ? <Text style={noteStyles.meta}>AI enrichment is off for future notes. You can enable it on Notes Home.</Text> : null}
      {questionVisible && !editing ? <View style={{ gap: 6 }}>
        <Text style={noteStyles.meta}>Want to add a little context?</Text><Text style={noteStyles.preview}>{row!.prompt_question}</Text>
        <TextAction title="Add context" disabled={locked} onPress={edit} />
        <TextAction title="Not now" disabled={locked} onPress={() => void update({ prompt_dismissed: true })} />
      </View> : null}
      {!editing && (row!.user_context || row!.answer) ? <View style={{ gap: 6 }}>
        <Text style={noteStyles.meta}>Your added context</Text>
        {row!.user_context ? <Text style={noteStyles.preview}>{row!.user_context}</Text> : null}
        {row!.answer ? <><Text style={noteStyles.meta}>{row!.prompt_question}</Text><Text style={noteStyles.preview}>{row!.answer}</Text></> : null}
        <TextAction title="Edit your context" disabled={locked} onPress={edit} />
        <TextAction title="Remove your context" destructive disabled={locked} onPress={() => setConfirmRemove(true)} />
      </View> : null}
      {!editing && !row!.user_context && !row!.answer && !questionVisible ? <TextAction title="Add your own context" disabled={locked} onPress={edit} /> : null}
      {editing ? <View style={{ gap: 10 }}>
        {row!.prompt_question ? <><Text style={noteStyles.meta}>{row!.prompt_question}</Text><TextInput accessibilityLabel="Context answer" multiline value={answer} onChangeText={changeAnswer} maxLength={2000} editable={!locked} style={styles.input} /></> : null}
        <Text style={noteStyles.meta}>Anything else you want to remember? Optional, and separate from the note.</Text>
        <TextInput accessibilityLabel="Your added context" multiline value={extra} onChangeText={changeExtra} maxLength={4000} editable={!locked} style={styles.input} />
        <Action secondary title={busy ? 'Saving context…' : 'Save added context'} disabled={locked} onPress={() => void update({ user_context: extra, answer, ...(answer.trim() ? { prompt_dismissed: true } : {}) }, editBase.current ?? undefined)} />
        <TextAction title="Cancel context changes" disabled={locked} onPress={() => { setEditing(false); onDirty(false); }} />
      </View> : null}
      <Message text={visibleError} error />
      {visibleError ? <TextAction title="Reload context" disabled={locked} onPress={() => { if (editing) setConfirmReload(true); else reloadContext(); }} /> : null}
    </>}
    <Confirmation visible={confirmRemove} title="Remove your added context?" description="Your original note and generated context will stay. This removes your added details and answer." confirmLabel="Remove context" onCancel={() => setConfirmRemove(false)} onConfirm={() => void update({ user_context: '', answer: '', prompt_dismissed: true })} />
    <Confirmation visible={confirmReload} title="Reload your added context?" description="Your unsaved context changes will be discarded. Copy anything you want to keep before reloading." confirmLabel="Discard and reload context" onCancel={() => setConfirmReload(false)} onConfirm={reloadContext} />
  </View>;
}
