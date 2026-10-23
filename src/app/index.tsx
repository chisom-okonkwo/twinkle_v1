import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Action, errorMessage, Message, Screen, styles } from '../components/ui';
import { deleteNote, listNotes, MAX_NOTE_LENGTH, saveNote, type Note } from '../lib/notes';
import { getSupabase } from '../lib/supabase';
import { useAuth } from '../providers/auth-provider';

// Remount all account-specific state if the signed-in user changes.
export default function NotesRoute() {
  const { session } = useAuth();
  return session ? <NotesScreen key={session.user.id} userId={session.user.id} email={session.user.email} /> : null;
}

function NotesScreen({ userId, email }: { userId: string; email?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [editor, setEditor] = useState<{ id?: string; original: string } | null>(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(true);
  const request = useRef(0);
  const operation = useRef(false);

  async function load(offset = 0) {
    const current = ++request.current;
    try {
      const page = await listNotes(userId, offset);
      if (!active.current || current !== request.current) return;
      setNotes((previous) => offset ? [...previous, ...page] : page);
      setHasMore(page.length === 30);
    } catch (cause) {
      if (active.current && current === request.current) setError(errorMessage(cause));
    } finally {
      if (active.current && current === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    active.current = true;
    const current = ++request.current;
    listNotes(userId).then((page) => {
      if (!active.current || current !== request.current) return;
      setNotes(page);
      setHasMore(page.length === 30);
    }).catch((cause: unknown) => {
      if (active.current && current === request.current) setError(errorMessage(cause));
    }).finally(() => {
      if (active.current && current === request.current) setLoading(false);
    });
    return () => { active.current = false; };
  }, [userId]);

  async function refresh(offset = 0) {
    setLoading(true);
    setError(null);
    await load(offset);
  }

  function closeEditor() {
    if (content !== editor?.original) {
      Alert.alert('Discard changes?', 'Your unsaved text will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => setEditor(null) },
      ]);
    } else setEditor(null);
  }

  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try { await action(); }
    catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally {
      operation.current = false;
      if (active.current) setBusy(false);
    }
  }

  function save() {
    void run(async () => {
      await saveNote(userId, content, editor?.id);
      if (!active.current) return;
      setEditor(null);
      setContent('');
      setMessage('Note saved.');
      await refresh();
    });
  }

  function confirmDelete() {
    if (!editor?.id) return;
    const id = editor.id;
    Alert.alert('Delete this note?', 'This permanently deletes the saved note.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run(async () => {
        await deleteNote(userId, id);
        if (!active.current) return;
        setEditor(null);
        setContent('');
        setMessage('Note deleted.');
        await refresh();
      }) },
    ]);
  }

  return (
    <Screen>
      <Text style={styles.title}>{editor ? editor.id ? 'Edit note' : 'New note' : 'Your notes'}</Text>
      <Message text={error} error />
      <Message text={message} />
      {editor ? <>
        <Text style={styles.label}>What’s on your mind?</Text>
        <TextInput accessibilityLabel="Note content" style={[styles.input, styles.editor]} multiline
          value={content} onChangeText={setContent} editable={!busy} maxLength={MAX_NOTE_LENGTH}
          placeholder="Start writing…" placeholderTextColor="#777182" autoFocus />
        <Action title={busy ? 'Please wait…' : 'Save note'} onPress={save} disabled={busy || !content.trim()} />
        <Action title="Cancel" onPress={closeEditor} disabled={busy} secondary />
        {editor.id ? <Action title="Delete note" onPress={confirmDelete} disabled={busy} destructive /> : null}
      </> : <>
        <Text style={styles.subtitle}>{email}</Text>
        <Action title="New note" disabled={busy || loading} onPress={() => {
          setEditor({ original: '' }); setContent(''); setError(null); setMessage(null);
        }} />
        <Action title="Refresh notes" onPress={() => void refresh()} disabled={busy || loading} secondary />
        {loading ? <ActivityIndicator accessibilityLabel="Loading notes" /> : null}
        {!loading && !error && !notes.length ? <Text style={styles.subtitle}>Your first thought starts here. Tap New note to write it down.</Text> : null}
        {notes.map((note) => <Pressable key={note.id} style={styles.card} accessibilityRole="button"
          accessibilityLabel={`Edit note: ${note.content.slice(0, 80)}`} disabled={busy || loading}
          onPress={() => { setEditor({ id: note.id, original: note.content }); setContent(note.content); setError(null); setMessage(null); }}>
          <Text style={styles.subtitle} numberOfLines={3}>{note.content}</Text>
          <Text>{new Date(note.updated_at).toLocaleString()}</Text>
        </Pressable>)}
        {hasMore ? <Action title="Load more" onPress={() => void refresh(notes.length)} disabled={loading || busy} secondary /> : null}
        <View style={{ marginTop: 12 }}>
          <Action title={busy ? 'Please wait…' : 'Sign out'} secondary disabled={busy}
            onPress={() => void run(async () => {
              const { error: signOutError } = await getSupabase().auth.signOut({ scope: 'local' });
              if (signOutError) throw signOutError;
            })} />
        </View>
      </>}
    </Screen>
  );
}
