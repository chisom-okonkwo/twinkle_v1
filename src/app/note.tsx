import { useCaptureConnections } from '../providers/capture-connections-provider';
import { NoteSourcePanel } from '../components/note-source-panel';
import { RelatedNotesPanel } from '../components/related-notes-panel';
import { NoteRecallControl } from '../components/note-recall-control';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Confirmation, formatNoteDate, noteStyles, TextAction } from '../components/note-ui';
import { Action, errorMessage, Message } from '../components/ui';
import { deleteNote, getNote, MAX_NOTE_LENGTH, NoteConflictError, saveNote, type Note } from '../lib/notes';
import { useAuth } from '../providers/auth-provider';
import { CapturePanel, SourcePreview } from '../components/capture-panel';
import { type CaptureDraft, type CaptureRecord, discardDraft, loadSavedSource, removeLocalAsset } from '../lib/captures';
import { NoteContextPanel } from '../components/note-context-panel';

export default function NoteRoute() {
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const noteId = Array.isArray(id) ? id[0] : id;
  return session ? <NoteEditor key={`${session.user.id}:${noteId ?? 'new'}`} userId={session.user.id} id={noteId} /> : null;
}

function NoteEditor({ userId, id }: { userId: string; id?: string }) {
  const { noteSaved } = useCaptureConnections();
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
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [contextDirty, setContextDirty] = useState(false);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [relatedVersion, setRelatedVersion] = useState(0);
  const active = useRef(true);
  const operation = useRef(false);
  const noteDirty = content !== (note?.content ?? '') || Boolean(draft);
  const dirty = noteDirty || contextDirty || sourceDirty;

  const disablePrevention = usePreventRemove((dirty || Boolean(busy) || captureBusy || sourceBusy) && !leaving, ({ repeat }) => {
    if (!operation.current && !captureBusy && !sourceBusy) setDiscardAction(() => repeat);
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
    if (operation.current || sourceBusy) return;
    operation.current = true;
    setBusy(kind);
    setError(null);
    setConfirmDelete(false);
    try {
      if (kind === 'save') {
        if (draft && (!draft.processed || !draft.record)) throw new Error('Process the source and review the text before saving.');
        const saved = await saveNote(userId, content, note ?? undefined, draft?.record ? { id: draft.record.id, kind: draft.asset.kind } : undefined);
        if (draft) removeLocalAsset(draft.asset);
        noteSaved(saved);
        // Preserve independently edited context/source drafts when the main note saves.
        if ((contextDirty || sourceDirty) && note) { setNote(saved); setDraft(null); return; }
      }
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
        <TextAction title="‹ Notes" onPress={back} disabled={Boolean(busy) || captureBusy || sourceBusy} />
        <Text style={noteStyles.meta}>{id ? 'Edit note' : 'New note'}</Text>
        <Action title={busy === 'save' ? 'Saving…' : 'Save'} onPress={() => void persist('save')}
          disabled={loading || Boolean(loadError) || Boolean(busy) || captureBusy || sourceBusy || Boolean(draft && !draft.processed) || !noteDirty || !content.trim()} />
      </View>
      {loading ? <View style={noteStyles.state}><ActivityIndicator accessibilityLabel="Loading note" color="#55458d" /></View>
        : loadError ? <View style={noteStyles.editorBody}>
          <Message text={loadError} error />
          {validId ? <Action title="Try again" secondary onPress={reload} /> : null}
        </View> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={noteStyles.editorBody}>
          <Text style={noteStyles.eyebrow}>{id ? 'YOUR WORDS, YOUR SPACE' : 'WHAT’S ON YOUR MIND?'}</Text>
          <Message text={error} error />
          {!id ? <CapturePanel userId={userId} disabled={Boolean(busy)} draft={draft} onDraft={setDraft} onBusy={setCaptureBusy}
            onText={(text) => setContent((previous) => previous.trim() ? `${previous}\n\n${text}` : text)} /> : null}
          {conflict ? <TextAction title="Reload saved note" onPress={() => setConfirmReload(true)} disabled={Boolean(busy)} /> : null}
          <TextInput accessibilityLabel="Note content" multiline style={noteStyles.editor}
            placeholder="Start with a thought…" placeholderTextColor="#91899f" autoFocus={!id}
            value={content} onFocus={() => setWriting(true)} onBlur={() => setWriting(false)} onChangeText={setContent} editable={!busy && !sourceBusy} maxLength={MAX_NOTE_LENGTH} />
          <View style={noteStyles.editorMeta}>
            {note ? <>
              <Text style={noteStyles.meta}>Created {formatNoteDate(note.created_at)}</Text>
              <Text style={noteStyles.meta}>Edited {formatNoteDate(note.updated_at)}</Text>
            </> : <Text style={noteStyles.meta}>Only you can see your notes.</Text>}
            <Text style={noteStyles.meta}>{dirty ? 'Unsaved changes' : note ? 'Saved in your private notes' : 'Save when you’re ready'}</Text>
            {note?.source_capture_id ? <SavedSource captureId={note.source_capture_id} /> : null}
            {note ? <NoteSourcePanel userId={userId} noteId={note.id} content={note.content} disabled={Boolean(busy)} onDirty={setSourceDirty} onBusy={setSourceBusy} onSaved={() => setRelatedVersion(n => n + 1)} /> : null}
            {note ? <NoteContextPanel userId={userId} note={note} noteDirty={noteDirty} disabled={Boolean(busy) || sourceBusy} onDirty={setContextDirty} onSaved={() => setRelatedVersion(n => n + 1)} /> : null}
            {id && note && !dirty && !writing && !busy && !sourceBusy ? <RelatedNotesPanel key={relatedVersion} userId={userId} noteId={note.id} /> : null}
            {note ? <NoteRecallControl userId={userId} noteId={note.id} disabled={Boolean(busy) || sourceBusy} /> : null}
            {note ? <TextAction title={busy === 'delete' ? 'Deleting…' : 'Delete note'} destructive
              disabled={Boolean(busy) || sourceBusy} onPress={() => setConfirmDelete(true)} /> : null}
          </View>
        </ScrollView>}
    </KeyboardAvoidingView>
    <Confirmation visible={Boolean(discardAction)} title="Leave without saving?"
      description="Your latest changes haven’t been saved. You can keep writing or discard them."
      confirmLabel="Discard changes" cancelLabel="Keep editing" onCancel={() => setDiscardAction(null)}
      onConfirm={() => {
        const resume = discardAction; setDiscardAction(null); setCaptureBusy(true);
        void (async () => {
          try { if (draft) await discardDraft(draft); setDraft(null); setLeaving(true); resume?.(); }
          catch (cause) { setError(errorMessage(cause)); }
          finally { setCaptureBusy(false); }
        })();
      }} />
    <Confirmation visible={confirmDelete} title="Delete this note?"
      description="This will permanently delete the saved note and any unsaved changes."
      confirmLabel="Delete note" onCancel={() => setConfirmDelete(false)} onConfirm={() => void persist('delete')} />
    <Confirmation visible={confirmReload} title="Reload the saved note?"
      description="Your current text will be replaced. Copy any unsaved changes you want to keep first."
      confirmLabel="Discard and reload" cancelLabel="Keep editing" onCancel={() => setConfirmReload(false)} onConfirm={reload} />
  </SafeAreaView>;
}

function SavedSource({ captureId }: { captureId: string }) {
  const [source, setSource] = useState<{ record: CaptureRecord; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    loadSavedSource(captureId).then((value) => { if (active) { setSource(value); setError(null); } }).catch(() => { if (active) setError('The original source could not be opened.'); });
    return () => { active = false; };
  }, [captureId, retry]);
  return <View style={{ gap: 10, marginTop: 16 }}>
    <Text style={noteStyles.meta}>Original {source?.record.kind === 'audio' ? 'recording' : 'source'} · private</Text>
    {source ? <SourcePreview key={`${source.uri}-${retry}`} kind={source.record.kind} uri={source.uri} /> : !error ? <ActivityIndicator accessibilityLabel="Opening private source" color="#55458d" /> : null}
    <Message text={error} error />
    <TextAction title="Reload private source" onPress={() => { setSource(null); setError(null); setRetry((value) => value + 1); }} />
  </View>;
}
