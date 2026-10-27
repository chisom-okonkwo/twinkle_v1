import { NoteMediaMenu } from '../components/note-media-menu';
import { randomUUID } from 'expo-crypto';
import { NoteAttachmentsPanel } from '../components/note-attachments-panel';
import { appendCaptureText, MAX_NOTE_ATTACHMENTS, type NoteAttachment } from '../lib/attachments-repository';
import { importProvenance } from '../lib/import-provenance';
import { MAX_NOTE_TITLE_LENGTH } from '../lib/note-title';
import { useCaptureConnections } from '../providers/capture-connections-provider';
import { NoteSourcePanel } from '../components/note-source-panel';
import { RelatedNotesPanel } from '../components/related-notes-panel';
import { NoteRecallControl } from '../components/note-recall-control';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Confirmation, formatNoteDate, noteStyles, TextAction } from '../components/note-ui';
import { Action, errorMessage, Message } from '../components/ui';
import { deleteNote, getNote, MAX_NOTE_LENGTH, NoteConflictError, saveNote, saveNoteWithAttachments, listAttachments, type Note } from '../lib/notes';
import { useAuth } from '../providers/auth-provider';
import { CapturePanel } from '../components/capture-panel';
import { type CaptureDraft, discardDraft, removeLocalAsset } from '../lib/captures';
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
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(Boolean(id) && validId);
  const [loadError, setLoadError] = useState<string | null>(validId ? null : 'This note link is invalid.');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<'save' | 'delete' | 'remove' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [added, setAdded] = useState<CaptureDraft[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [captureRequest, setCaptureRequest] = useState<{ id: number; kind: 'camera' | 'library' | 'audio' } | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const captureTop = useRef(0);
  const revealCapture = useRef(false);
  const [newMediaNoteId] = useState(randomUUID);
  const [initialCaptureId, setInitialCaptureId] = useState<string | undefined>();
  const captureIds = [...attachments.filter(a => !removed.includes(a.capture_id)).map(a => a.capture_id), ...added.map(a => a.asset.id)];
  const [captureBusy, setCaptureBusy] = useState(false);
  const [contextDirty, setContextDirty] = useState(false);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [relatedVersion, setRelatedVersion] = useState(0);
  const active = useRef(true);
  const operation = useRef(false);
  const noteDirty = title !== (note?.title ?? '') || content !== (note?.content ?? '') || Boolean(draft) || added.length > 0 || removed.length > 0;
  const dirty = noteDirty || contextDirty || sourceDirty;
  const imported = importProvenance(note?.import_metadata);

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
    Promise.all([getNote(userId, id), listAttachments(id)]).then(([saved, media]) => {
      if (!current) return;
      setNote(saved);
      setContent(saved.content);
      setTitle(saved.title);
      setAttachments(media); setAdded([]); setRemoved([]); setDraft(null);
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

  function requestMedia(kind: 'camera' | 'library' | 'audio') {
    revealCapture.current = true;
    setCaptureRequest(previous => ({ id: (previous?.id ?? 0) + 1, kind }));
    scroll.current?.scrollTo({ y: Math.max(0, captureTop.current - 24), animated: false });
  }

  async function removeStaged(captureId: string) {
    if (operation.current || captureBusy || sourceBusy) return;
    const item = added.find(value => value.asset.id === captureId);
    if (!item) return;
    operation.current = true; setBusy('remove'); setError(null);
    try { await discardDraft(item); if (active.current) setAdded(items => items.filter(value => value.asset.id !== captureId)); }
    catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { operation.current = false; if (active.current) setBusy(null); }
  }
  async function reloadWithMediaCleanup() {
    if (operation.current || captureBusy) return;
    operation.current = true; setBusy('remove');
    try { for (const item of [...added, ...(draft ? [draft] : [])]) await discardDraft(item); reload(); }
    catch (cause) { setError(errorMessage(cause)); setConfirmReload(false); }
    finally { operation.current = false; if (active.current) setBusy(null); }
  }

  async function persist(kind: 'save' | 'delete') {
    if (operation.current || sourceBusy) return;
    operation.current = true;
    setBusy(kind);
    setError(null);
    setConfirmDelete(false);
    try {
      if (kind === 'save') {
        if (draft) throw new Error('Review the source and tap Add to note, or discard it before saving.');
        const saved = captureIds.length || removed.length
          ? await saveNoteWithAttachments(userId, note?.id ?? newMediaNoteId, content, captureIds, note ?? undefined, removed, !note && captureIds.includes(initialCaptureId ?? '') ? initialCaptureId : undefined, title)
          : await saveNote(userId, content, note ?? undefined, undefined, title);
        setTitle(saved.title);
        added.forEach(item => removeLocalAsset(item.asset));
        noteSaved(saved);
        // Preserve independently edited context/source drafts when the main note saves.
        if ((contextDirty || sourceDirty) && note) {
          setNote(saved); setDraft(null);
          setAttachments([...attachments.filter(a => !removed.includes(a.capture_id)), ...added.map(item => ({ capture_id: item.asset.id, kind: item.asset.kind, created_at: new Date().toISOString() }))]);
          setAdded([]); setRemoved([]); return;
        }
      }
      else if (note) {
        await deleteNote(userId, note);
        for (const item of [...added, ...(draft ? [draft] : [])]) void discardDraft(item).catch(() => {});
      }
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
          disabled={loading || Boolean(loadError) || Boolean(busy) || captureBusy || sourceBusy || Boolean(draft) || !noteDirty || !content.trim() && !captureIds.length} />
      </View>
      {loading ? <View style={noteStyles.state}><ActivityIndicator accessibilityLabel="Loading note" color="#55458d" /></View>
        : loadError ? <View style={noteStyles.editorBody}>
          <Message text={loadError} error />
          {validId ? <Action title="Try again" secondary onPress={reload} /> : null}
        </View> : <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[noteStyles.editorBody, { paddingBottom: 112 }]}>
          <Text style={noteStyles.eyebrow}>{id ? 'YOUR WORDS, YOUR SPACE' : 'WHAT’S ON YOUR MIND?'}</Text>
          <Message text={error} error />

          {conflict ? <TextAction title="Reload saved note" onPress={() => setConfirmReload(true)} disabled={Boolean(busy)} /> : null}
          <TextInput accessibilityLabel="Note title" placeholder="Title (optional)" placeholderTextColor="#91899f"
            style={noteStyles.editorTitle} value={title} onChangeText={setTitle} maxLength={MAX_NOTE_TITLE_LENGTH}
            onFocus={() => setWriting(true)} onBlur={() => setWriting(false)} editable={!busy && !sourceBusy} />
          <TextInput accessibilityLabel="Note content" multiline style={noteStyles.editor}
            placeholder="Start with a thought…" placeholderTextColor="#91899f" autoFocus={!id}
            value={content} onFocus={() => setWriting(true)} onBlur={() => setWriting(false)} onChangeText={setContent} editable={!busy && !sourceBusy} maxLength={MAX_NOTE_LENGTH} />
          <View onLayout={event => {
            captureTop.current = event.nativeEvent.layout.y;
            if (revealCapture.current && event.nativeEvent.layout.height > 0) {
              scroll.current?.scrollTo({ y: Math.max(0, captureTop.current - 24), animated: false });
              revealCapture.current = false;
            }
          }}><CapturePanel request={captureRequest} userId={userId} disabled={Boolean(busy) || sourceBusy || captureIds.length >= MAX_NOTE_ATTACHMENTS && !draft} draft={draft} onDraft={setDraft} onBusy={setCaptureBusy}
            excludedIds={captureIds} onAdd={item => {
              if (!item.prepared || !item.record) throw new Error('Prepare the attachment first.');
              if (captureIds.includes(item.asset.id)) throw new Error('This source is already in this note.');
              if (captureIds.length >= MAX_NOTE_ATTACHMENTS) throw new Error('Keep up to 10 photos or recordings in one note.');
              const next = appendCaptureText(content, item.extractedText ?? '');
              if (!note && !added.length && !content.trim()) setInitialCaptureId(item.asset.id);
              setContent(next); setAdded(items => [...items, item]); setDraft(null);
            }} /></View>
          <NoteAttachmentsPanel saved={attachments} added={added} removed={removed} disabled={Boolean(busy) || captureBusy || sourceBusy}
            onToggleRemove={captureId => setRemoved(ids => ids.includes(captureId) ? ids.filter(value => value !== captureId) : [...ids, captureId])}
            onRemoveDraft={captureId => void removeStaged(captureId)} />
          {captureIds.length >= MAX_NOTE_ATTACHMENTS ? <Text style={noteStyles.meta}>This note has 10 attachments. Remove one to add another.</Text> : null}
          {!content.trim() && !captureIds.length && removed.length ? <Text style={noteStyles.meta}>Add some words before saving without any attachments, or undo the removal.</Text> : null}
          <View style={noteStyles.editorMeta}>
            {note ? <>
              {imported ? <>
                <Text style={noteStyles.meta}>Imported from {imported.filename} · {formatNoteDate(imported.importedAt)}</Text>
                <Text style={noteStyles.meta}>{imported.originalDate ? `Creation date supplied by file: ${imported.originalDate}` : 'Original creation date unavailable; using the import date.'}</Text>
                {imported.originalUpdatedAt ? <Text style={noteStyles.meta}>Last edited in Keep: {imported.originalUpdatedAt}</Text> : null}
              </> : <Text style={noteStyles.meta}>Created {formatNoteDate(note.created_at)}</Text>}
              <Text style={noteStyles.meta}>Edited {formatNoteDate(note.updated_at)}</Text>
            </> : <Text style={noteStyles.meta}>Only you can see your notes.</Text>}
            <Text style={noteStyles.meta}>{dirty ? 'Unsaved changes' : note ? 'Saved in your private notes' : 'Save when you’re ready'}</Text>
            {note ? <NoteSourcePanel userId={userId} noteId={note.id} content={note.content} disabled={Boolean(busy)} onDirty={setSourceDirty} onBusy={setSourceBusy} onSaved={() => setRelatedVersion(n => n + 1)} /> : null}
            {note ? <NoteContextPanel userId={userId} note={note} noteDirty={noteDirty} disabled={Boolean(busy) || sourceBusy} onDirty={setContextDirty} onSaved={() => setRelatedVersion(n => n + 1)} /> : null}
            {id && note && note.content.trim() && !dirty && !writing && !busy && !sourceBusy ? <RelatedNotesPanel key={relatedVersion} userId={userId} noteId={note.id} /> : null}
            {note ? <NoteRecallControl userId={userId} noteId={note.id} disabled={Boolean(busy) || sourceBusy} /> : null}
            {note ? <TextAction title={busy === 'delete' ? 'Deleting…' : 'Delete note'} destructive
              disabled={Boolean(busy) || sourceBusy} onPress={() => setConfirmDelete(true)} /> : null}
          </View>
        </ScrollView>}
      {!loading && !loadError ? <NoteMediaMenu disabled={Boolean(busy) || captureBusy || sourceBusy || Boolean(draft) || captureIds.length >= MAX_NOTE_ATTACHMENTS}
        onPhoto={camera => requestMedia(camera ? 'camera' : 'library')} onAudio={() => requestMedia('audio')} /> : null}
    </KeyboardAvoidingView>
    <Confirmation visible={Boolean(discardAction)} title="Leave without saving?"
      description="Your latest changes haven’t been saved. You can keep writing or discard them."
      confirmLabel="Discard changes" cancelLabel="Keep editing" onCancel={() => setDiscardAction(null)}
      onConfirm={() => {
        const resume = discardAction; setDiscardAction(null); setCaptureBusy(true);
        void (async () => {
          try { for (const item of [...added, ...(draft ? [draft] : [])]) await discardDraft(item); setDraft(null); setAdded([]); setLeaving(true); resume?.(); }
          catch (cause) { setError(errorMessage(cause)); }
          finally { setCaptureBusy(false); }
        })();
      }} />
    <Confirmation visible={confirmDelete} title="Delete this note?"
      description="This will permanently delete the saved note and any unsaved changes."
      confirmLabel="Delete note" onCancel={() => setConfirmDelete(false)} onConfirm={() => void persist('delete')} />
    <Confirmation visible={confirmReload} title="Reload the saved note?"
      description="Your current text will be replaced. Copy any unsaved changes you want to keep first."
      confirmLabel="Discard and reload" cancelLabel="Keep editing" onCancel={() => setConfirmReload(false)} onConfirm={() => void reloadWithMediaCleanup()} />
  </SafeAreaView>;
}
