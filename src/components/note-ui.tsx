import { memo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Note } from '../lib/notes';
import { Action, styles } from './ui';

export function TextAction({ title, onPress, disabled, destructive = false }: {
  title: string; onPress: () => void; disabled?: boolean; destructive?: boolean;
}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
    accessibilityState={{ disabled: Boolean(disabled) }}
    style={({ pressed }) => [noteStyles.textAction, (disabled || pressed) && styles.dim]}>
    <Text style={[noteStyles.actionText, destructive && styles.error]}>{title}</Text>
  </Pressable>;
}

export function Confirmation({ visible, title, description, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }: {
  visible: boolean; title: string; description: string; confirmLabel: string; cancelLabel?: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  return <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
    <View style={noteStyles.backdrop}>
      <View accessibilityViewIsModal style={noteStyles.dialog}>
        <Text accessibilityRole="header" style={noteStyles.heading}>{title}</Text>
        <Text style={styles.subtitle}>{description}</Text>
        <Action title={cancelLabel} onPress={onCancel} secondary />
        <Action title={confirmLabel} onPress={onConfirm} destructive />
      </View>
    </View>
  </Modal>;
}

export const NoteCard = memo(function NoteCard({ note, onOpen }: { note: Note; onOpen: (id: string) => void }) {
  const lines = note.content.trim().split(/\r?\n/);
  const title = lines[0].slice(0, 160) + (lines[0].length > 160 ? '…' : '');
  const preview = lines.slice(1).join('\n').trim().slice(0, 500);
  return <Pressable onPress={() => onOpen(note.id)} accessibilityRole="button"
    accessibilityLabel={`Open note: ${title.slice(0, 100)}`}
    style={({ pressed }) => [noteStyles.card, pressed && noteStyles.cardPressed]}>
    <Text style={noteStyles.noteTitle} numberOfLines={2}>{title}</Text>
    {preview ? <Text style={noteStyles.preview} numberOfLines={3}>{preview}</Text> : null}
    <Text style={noteStyles.meta}>Edited {formatNoteDate(note.updated_at)}</Text>
  </Pressable>;
});

export function formatNoteDate(value: string) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const noteStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#faf9f6' },
  container: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center' },
  toolbar: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { color: '#55458d', fontWeight: '700', fontSize: 21, letterSpacing: -0.5 },
  hero: { gap: 12, paddingTop: 20, paddingBottom: 24 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.8, color: '#6d637f' },
  heading: { fontSize: 23, lineHeight: 30, fontWeight: '600', color: '#29263d' },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  separator: { height: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12, borderWidth: 1, borderColor: '#e5e1eb' },
  cardPressed: { backgroundColor: '#f1eef7' },
  noteTitle: { fontSize: 19, lineHeight: 27, fontWeight: '600', color: '#29263d' },
  preview: { fontSize: 16, lineHeight: 24, color: '#585466' },
  meta: { fontSize: 12, lineHeight: 19, color: '#6d637f' },
  textAction: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  actionText: { fontSize: 15, fontWeight: '600', color: '#55458d' },
  state: { paddingVertical: 48, gap: 14, alignItems: 'center' },
  stateText: { fontSize: 16, lineHeight: 25, color: '#585466', textAlign: 'center', maxWidth: 300 },
  banner: { paddingVertical: 12, gap: 8 },
  footer: { paddingVertical: 20, gap: 10 },
  editorBody: { flexGrow: 1, padding: 24, gap: 16 },
  editor: { flex: 1, minHeight: 300, padding: 0, paddingTop: 8, fontSize: 20, lineHeight: 31, color: '#29263d', textAlignVertical: 'top' },
  editorMeta: { gap: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e5e1eb' },
  backdrop: { flex: 1, backgroundColor: 'rgba(32, 27, 45, 0.35)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialog: { backgroundColor: '#faf9f6', width: '100%', maxWidth: 400, padding: 24, borderRadius: 20, gap: 18 },
});
