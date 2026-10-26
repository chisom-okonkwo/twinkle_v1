import { openURL } from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { EMPTY_SOURCE, getNoteSource, saveNoteSource, SOURCE_TYPES, suggestSource, validateSource, type NoteSource, type SourceValues } from '../lib/sources';
import { Action, errorMessage, Message, styles } from './ui';
import { Confirmation, noteStyles, TextAction } from './note-ui';
const labels = { book: 'Book', article: 'Article / website', conversation: 'Conversation', project: 'Project', other: 'Other' };
export function NoteSourcePanel({ userId, noteId, content, disabled, onDirty, onSaved, onBusy }: {
  userId: string; noteId: string; content: string; disabled: boolean; onDirty: (dirty: boolean) => void; onSaved: () => void; onBusy: (busy: boolean) => void;
}) {
  const [row, setRow] = useState<NoteSource | null>(null);
  const [draft, setDraft] = useState<SourceValues>({ ...EMPTY_SOURCE, source_type: 'book' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  const [reload, setReload] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const active = useRef(true);
  const base = useRef<NoteSource | null>(null);
  const suggestion = suggestSource(content);
  useEffect(() => {
    active.current = true;
    let current = true;
    getNoteSource(userId, noteId).then(value => { if (active.current && current) { setRow(value); setError(null); } }).catch(() => { if (active.current && current) setError('Source information could not be loaded. Your note is safe.'); });
    return () => { current = false; active.current = false; };
  }, [userId, noteId, attempt]);
  function edit() {
    if (!row) return;
    base.current = row;
    setDraft(row.source_type ? { ...row, source_type: row.source_type as SourceValues['source_type'] } : { ...EMPTY_SOURCE, source_type: 'book' });
    setEditing(true); setError(null); onDirty(false);
  }
  function change(values: Partial<SourceValues>) {
    const value = { ...draft, ...values }; setDraft(value);
    onDirty(value.name !== (base.current?.name ?? '') || value.url !== (base.current?.url ?? '') || value.description !== (base.current?.description ?? '') || Boolean(base.current?.source_type && value.source_type !== base.current.source_type));
  }
  async function save(values: SourceValues, previous = base.current ?? row) {
    if (!previous || busy) return;
    setBusy(true); onBusy(true); setError(null); setRemove(false); onDirty(true);
    try {
      const value = await saveNoteSource(userId, previous, values);
      if (active.current) { setRow(value); setEditing(false); base.current = null; onDirty(false); onSaved(); }
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { if (active.current) { setBusy(false); onBusy(false); } }
  }
  const locked = busy || disabled;
  return <View style={{ gap: 8, marginTop: 12 }}>
    {row?.source_type && !editing ? <>
      <Text style={styles.label}>Source</Text>
      <Text style={noteStyles.meta}>{labels[row.source_type as keyof typeof labels]} · Confirmed by you</Text>
      {row.name ? <Text style={noteStyles.preview}>{row.name}</Text> : null}
      {row.url ? <TextAction title={row.url} disabled={locked} onPress={() => {
        try { const checked = validateSource({ ...row, source_type: row.source_type as SourceValues['source_type'] }); void openURL(checked.url).catch(() => setError('This web link could not be opened.')); }
        catch { setError('This source has an invalid web link. Edit it to use http:// or https://.'); }
      }} /> : null}
      {row.description ? <Text style={noteStyles.meta}>{row.description}</Text> : null}
      <TextAction title="Edit source" disabled={locked} onPress={edit} />
      <TextAction title="Remove source" destructive disabled={locked} onPress={() => setRemove(true)} />
    </> : !editing ? <TextAction title="Add a source" disabled={!row || locked} onPress={edit} /> : null}
    {editing ? <View style={styles.card}>
      <Text style={styles.label}>Where did this thought come from?</Text>
      <Text style={noteStyles.meta}>Optional. Only what you confirm here is saved as a source.</Text>
      {suggestion && !row?.source_type ? <>
        <Text style={noteStyles.meta}>Unconfirmed detail from your note: {suggestion.name || suggestion.url}</Text>
        <TextAction title="Use this detail" disabled={locked} onPress={() => change(suggestion)} />
      </> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {SOURCE_TYPES.map(kind => <TextAction key={kind} title={`${draft.source_type === kind ? '✓ ' : ''}${labels[kind]}`} disabled={locked} onPress={() => change({ source_type: kind })} />)}
      </View>
      <TextInput accessibilityLabel="Source name or title" placeholder="Name or title" value={draft.name} onChangeText={name => change({ name })} maxLength={300} editable={!locked} style={styles.input} />
      <TextInput accessibilityLabel="Source web link" placeholder="Web link (optional)" value={draft.url} onChangeText={url => change({ url })} maxLength={2000} keyboardType="url" autoCapitalize="none" autoCorrect={false} editable={!locked} style={styles.input} />
      <TextInput accessibilityLabel="Source details" placeholder="A little detail (optional)" value={draft.description} onChangeText={description => change({ description })} maxLength={2000} multiline editable={!locked} style={styles.input} />
      <Action title={busy ? 'Saving…' : 'Save source'} disabled={locked} onPress={() => void save(draft)} />
      <TextAction title="Cancel" disabled={locked} onPress={() => { setEditing(false); setError(null); onDirty(false); base.current = null; }} />
    </View> : null}
    <Message text={error} error />
    {error ? <TextAction title="Reload source" disabled={locked} onPress={() => editing ? setReload(true) : setAttempt(n => n + 1)} /> : null}
    <Confirmation visible={remove} title="Remove this source?" description="Your note and added context will stay saved." confirmLabel="Remove source" onCancel={() => setRemove(false)} onConfirm={() => void save(EMPTY_SOURCE, row)} />
    <Confirmation visible={reload} title="Reload source?" description="Copy any unsaved source details you want to keep first." confirmLabel="Discard and reload" onCancel={() => setReload(false)} onConfirm={() => { setReload(false); setEditing(false); onDirty(false); base.current = null; setAttempt(n => n + 1); }} />
  </View>;
}
