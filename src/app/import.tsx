import { router, useFocusEffect } from 'expo-router';
import { requireOptionalNativeModule } from 'expo';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { Action, errorMessage, Message, Screen, styles } from '../components/ui';
import { TextAction } from '../components/note-ui';
import { useAuth } from '../providers/auth-provider';
import { reviewImportFiles, runImport, type ImportItem } from '../lib/import-contract';
import { importNote, readImportAsset, releaseImportAsset } from '../lib/note-import';

export default function ImportRoute() {
  const { session } = useAuth();
  return session ? <ImportNotes key={session.user.id} /> : null;
}
function ImportNotes() {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useFocusEffect(useCallback(() => {
    active.current = true;
    if (!locked.current) setBusy(null);
    return () => { active.current = false; controller.current?.abort(); };
  }, []));

  async function choose() {
    if (locked.current) return;
    locked.current = true; setError(null); setBusy('reading');
    try {
      if (Platform.OS !== 'web' && !requireOptionalNativeModule('ExpoDocumentPicker')) {
        throw new Error('The file chooser needs the latest Twinkle development build. Install the updated app, reconnect, then try again.');
      }
      // Load only when needed so older development builds can still open notes.
      const picker = await import('expo-document-picker');
      const selection = await picker.getDocumentAsync({ multiple: true, type: '*/*', copyToCacheDirectory: true, base64: false });
      if (selection.canceled || !active.current) {
        selection.assets?.forEach(releaseImportAsset); return;
      }
      let next: ImportItem[];
      try {
        next = await reviewImportFiles(selection.assets, readImportAsset, (state, count) => {
          if (active.current) { setItems(state); setDone(count); }
        }, () => !active.current);
      } finally { selection.assets.forEach(releaseImportAsset); }
      if (active.current) { setItems(next); setReviewed(false); }
    } catch (cause) {
      if (active.current) setError(errorMessage(cause).includes('ExpoDocumentPicker') ? 'The file chooser needs the latest Twinkle development build. Install it, then try again.' : errorMessage(cause));
    } finally {
      locked.current = false;
      if (active.current) setBusy(null);
    }
  }
  async function confirm() {
    if (locked.current) return;
    locked.current = true; controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy('importing'); setReviewed(true); setDone(0); setError(null);
    try {
      await runImport(items, draft => importNote(draft, signal), (next, count) => {
        if (active.current) { setItems(next); setDone(count); }
      }, () => signal.aborted);
    } finally { locked.current = false; if (active.current) setBusy(null); }
  }
  const ready = items.filter(item => item.status === 'ready').length;
  const retry = items.some(item => (item.status === 'failed' || item.status === 'ready') && item.draft);
  return <Screen>
    <TextAction title="Back to notes" onPress={() => router.back()} disabled={Boolean(busy)} />
    <Text accessibilityRole="header" style={styles.title}>Bring your thoughts along</Text>
    <Text style={styles.subtitle}>Choose text (.txt), Markdown (.md), or Google Keep (.json or .html) files. When both Keep formats are selected, JSON is used once.</Text>
    <Text style={styles.subtitle}>Up to 20 files, 256 KB per file and 2 MB per batch. Context analysis is available when you open a note; importing won’t start AI processing.</Text>
    <Text style={styles.message}>Keep text and checklists are supported. Attachments are not imported; affected notes are flagged below.</Text>
    {!busy ? <Action title={items.length ? 'Choose different files' : 'Choose files'} onPress={choose} secondary={items.length > 0} /> : <>
      <ActivityIndicator accessibilityLabel={busy === 'reading' ? 'Reading selected files' : 'Importing notes'} />
      <Text accessibilityLiveRegion="polite" style={styles.label}>{busy === 'reading' ? `Reading files… ${done} reviewed` : `Importing ${done} of ${items.length}…`}</Text>
    </>}
    <Message text={error} error />
    {items.length && !busy ? <Text style={styles.label}>{reviewed
      ? `${items.filter(i => i.status === 'imported').length} imported · ${items.filter(i => i.status === 'skipped').length} skipped · ${items.filter(i => i.status === 'failed').length} failed`
      : `${ready} ready · ${items.filter(i => i.status === 'skipped').length} paired files skipped · ${items.filter(i => i.status === 'failed').length} could not be read`}</Text> : null}
    {items.map((item, index) => <View key={index} style={styles.card}>
      <Text style={styles.label}>{item.draft?.metadata.title || item.filename.replace(/\.(txt|md|json|html)$/i, '')}</Text>
      <Text style={styles.subtitle}>{item.filename}</Text>
      {!reviewed && item.draft ? <>
        <Text numberOfLines={5} style={styles.subtitle}>{item.draft.content.slice(0, 700)}</Text>
        <Text style={styles.message}>{item.draft.metadata.created_at ? `Creation date supplied by file: ${item.draft.metadata.created_at}` : 'Original creation date unavailable; the import date will be used.'}</Text>
        {item.draft.metadata.original_updated_at ? <Text style={styles.message}>Last edited in Keep: {item.draft.metadata.original_updated_at}</Text> : null}
        {item.draft.metadata.source_type ? <Text style={styles.message}>Source to keep: {item.draft.metadata.source_name || item.draft.metadata.source_url} ({item.draft.metadata.source_type}){item.draft.metadata.source_context ? ` · ${item.draft.metadata.source_context}` : ''}</Text> : null}
        {item.draft.metadata.source_name && item.draft.metadata.source_url ? <Text style={styles.message}>{item.draft.metadata.source_url}</Text> : null}
      </> : null}
      {item.draft?.warnings.map((warning, i) => <Message key={i} text={warning} />)}
      <Message text={item.message ?? null} error={item.status === 'failed'} />
      {item.id && !busy ? <TextAction title="Open note" onPress={() => router.push({ pathname: '/note', params: { id: item.id } })} /> : null}
    </View>)}
    {!busy && (!reviewed && ready > 0 || reviewed && retry) ? <Action title={reviewed ? 'Retry unfinished files' : `Import ${ready} ${ready === 1 ? 'note' : 'notes'}`} onPress={confirm} /> : null}
    {!busy && items.length ? <Action title={reviewed ? 'Return to notes' : 'Cancel import'} secondary onPress={() => router.back()} /> : null}
  </Screen>;
}
