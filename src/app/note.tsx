import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Confirmation, formatNoteDate, noteStyles, TextAction } from '../components/note-ui';
import { Action, errorMessage, Message } from '../components/ui';
import { deleteNote, getNote, MAX_NOTE_LENGTH, NoteConflictError, saveNote, type Note } from '../lib/notes';
import { useAuth } from '../providers/auth-provider';

export default function NoteRoute() {
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const noteId = Array.isArray(id) ? id[0] : id;
  return session ? <NoteEditor key={`${session.user.id}:${noteId ?? 'new'}`} userId={session.user.id} id={noteId} /> : null;
}

function NoteEditor({ userId, id }: { userId: string; id?: string }) {
  const validId = !id || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const [note, setNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(Boolean(id) && validId);
  const [loadError, setLoadError] = useState<string | null>(validId ? null : 'This note link is invalid.');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const operation = useRef(false);
  const dirty = content !== (note?.content ?? '');

  const disablePrevention = usePreventRemove((dirty || Boolean(busy)) && !leaving, ({ repeat }) => {
    if (!operation.current) setDiscardAction(() => repeat);
  });

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (!id || !validId) return;
    let current = true;
    getNote(userId, id).then((saved) => {
      if (!current) return;
      setNote(saved);
      setContent(saved.content);
      setConflict(false);
      setError(null);
      setLoadError(null);
    }).catch((cause: unknown) => {
      if (current) setLoadError(errorMessage(cause));
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [id, userId, validId, retry]);

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function leave() {
    setLeaving(true);
    disablePrevention();
    back();
  }

  function reload() {
    setConfirmReload(false);
    setLoadError(null);
    setLoading(true);
    setRetry((value) => value + 1);
  }

  async function persist(kind: 'save' | 'delete') {
    if (operation.current) return;
    operation.current = true;
    setBusy(kind);
    setError(null);
    setConfirmDelete(false);
    try {
      if (kind === 'save') await saveNote(userId, content, note ?? undefined);
      else if (note) await deleteNote(userId, note);
      if (active.current) leave();
    } catch (cause) {
      if (active.current) {
        setError(errorMessage(cause));
        setConflict(cause instanceof NoteConflictError);
      }
    } finally {
      operation.current = false;
      if (active.current) setBusy(null);
    }
  }

  return <SafeAreaView style={noteStyles.page}>
    <KeyboardAvoidingView style={noteStyles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={noteStyles.toolbar}>
        <TextAction title="‹ Notes" onPress={back} disabled={Boolean(busy)} />
        <Text style={noteStyles.meta}>{id ? 'Edit note' : 'New note'}</Text>
        <Action title={busy === 'save' ? 'Saving…' : 'Save'} onPress={() => void persist('save')}
          disabled={loading || Boolean(loadError) || Boolean(busy) || !dirty || !content.trim()} />
      </View>
      {loading ? <View style={noteStyles.state}><ActivityIndicator accessibilityLabel="Loading note" color="#55458d" /></View>
        : loadError ? <View style={noteStyles.editorBody}>
          <Message text={loadError} error />
          {validId ? <Action title="Try again" secondary onPress={reload} /> : null}
        </View> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={noteStyles.editorBody}>
          <Text style={noteStyles.eyebrow}>{id ? 'YOUR WORDS, YOUR SPACE' : 'WHAT’S ON YOUR MIND?'}</Text>
          <Message text={error} error />
          {conflict ? <TextAction title="Reload saved note" onPress={() => setConfirmReload(true)} disabled={Boolean(busy)} /> : null}
          <TextInput accessibilityLabel="Note content" multiline style={noteStyles.editor}
            placeholder="Start with a thought…" placeholderTextColor="#91899f" autoFocus={!id}
            value={content} onChangeText={setContent} editable={!busy} maxLength={MAX_NOTE_LENGTH} />
          <View style={noteStyles.editorMeta}>
            {note ? <>
              <Text style={noteStyles.meta}>Created {formatNoteDate(note.created_at)}</Text>
              <Text style={noteStyles.meta}>Edited {formatNoteDate(note.updated_at)}</Text>
            </> : <Text style={noteStyles.meta}>Only you can see your notes.</Text>}
            <Text style={noteStyles.meta}>{dirty ? 'Unsaved changes' : note ? 'Saved in your private notes' : 'Save when you’re ready'}</Text>
            {note ? <TextAction title={busy === 'delete' ? 'Deleting…' : 'Delete note'} destructive
              disabled={Boolean(busy)} onPress={() => setConfirmDelete(true)} /> : null}
          </View>
        </ScrollView>}
    </KeyboardAvoidingView>
    <Confirmation visible={Boolean(discardAction)} title="Leave without saving?"
      description="Your latest changes haven’t been saved. You can keep writing or discard them."
      confirmLabel="Discard changes" cancelLabel="Keep editing" onCancel={() => setDiscardAction(null)}
      onConfirm={() => { setLeaving(true); const resume = discardAction; setDiscardAction(null); resume?.(); }} />
    <Confirmation visible={confirmDelete} title="Delete this note?"
      description="This will permanently delete the saved note and any unsaved changes."
      confirmLabel="Delete note" onCancel={() => setConfirmDelete(false)} onConfirm={() => void persist('delete')} />
    <Confirmation visible={confirmReload} title="Reload the saved note?"
      description="Your current text will be replaced. Copy any unsaved changes you want to keep first."
      confirmLabel="Discard and reload" cancelLabel="Keep editing" onCancel={() => setConfirmReload(false)} onConfirm={reload} />
  </SafeAreaView>;
}
