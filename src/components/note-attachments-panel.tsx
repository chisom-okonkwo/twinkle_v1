import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { NoteAttachment } from '../lib/attachments-repository';
import { type CaptureDraft, type CaptureRecord, loadSavedSource } from '../lib/captures';
import { SourcePreview } from './capture-panel';
import { noteStyles, TextAction } from './note-ui';
import { Message, styles } from './ui';

export function NoteAttachmentsPanel({ saved, added, removed, disabled, onToggleRemove, onRemoveDraft }: {
  saved: NoteAttachment[]; added: CaptureDraft[]; removed: string[]; disabled: boolean;
  onToggleRemove: (id: string) => void; onRemoveDraft: (id: string) => void;
}) {
  const [preview, setPreview] = useState<{ generation?: string; id: string | null }>({ id: saved[0]?.capture_id ?? null });
  const newest = added.at(-1)?.asset.id;
  const opened = preview.generation === newest ? preview.id : newest ?? saved[0]?.capture_id ?? null;
  function togglePreview(id: string) { setPreview({ generation: newest, id: opened === id ? null : id }); }
  if (!saved.length && !added.length) return null;
  return <View style={{ gap: 12 }}>
    <Text style={styles.label}>Photos & recordings</Text>
    <Text style={noteStyles.meta}>Private to this note. Removing media leaves your written text intact. Changes take effect when you save.</Text>
    {saved.map((item, index) => <View key={item.capture_id} style={styles.card}>
      <Text style={styles.label}>{item.kind === 'image' ? 'Photo' : 'Recording'} {index + 1}{removed.includes(item.capture_id) ? ' · removed on save' : ''}</Text>
      {!removed.includes(item.capture_id) ? <>
        <TextAction title={opened === item.capture_id ? 'Hide preview' : item.kind === 'image' ? 'View photo' : 'Open recording'} disabled={disabled} onPress={() => togglePreview(item.capture_id)} />
        {opened === item.capture_id ? <SavedAttachment captureId={item.capture_id} /> : null}
      </> : null}
      <TextAction title={removed.includes(item.capture_id) ? 'Undo removal' : 'Remove attachment'} destructive={!removed.includes(item.capture_id)} disabled={disabled} onPress={() => onToggleRemove(item.capture_id)} />
    </View>)}
    {added.map((item, index) => <View key={item.asset.id} style={styles.card}>
      <Text style={styles.label}>{item.asset.kind === 'image' ? 'Photo' : 'Recording'} {saved.length + index + 1} · added, not saved</Text>
      <TextAction title={opened === item.asset.id ? 'Hide preview' : item.asset.kind === 'image' ? 'View photo' : 'Open recording'} disabled={disabled} onPress={() => togglePreview(item.asset.id)} />
      {opened === item.asset.id ? <SourcePreview kind={item.asset.kind} uri={item.asset.uri} /> : null}
      <TextAction title="Remove attachment" destructive disabled={disabled} onPress={() => onRemoveDraft(item.asset.id)} />
    </View>)}
  </View>;
}
function SavedAttachment({ captureId }: { captureId: string }) {
  const [source, setSource] = useState<{ record: CaptureRecord; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    loadSavedSource(captureId).then(value => { if (active) { setSource(value); setError(null); } }).catch(() => { if (active) setError('This private attachment could not be opened. Please retry.'); });
    return () => { active = false; };
  }, [captureId, retry]);
  return <View style={{ gap: 8 }}>
    {source ? <SourcePreview key={`${source.uri}-${retry}`} kind={source.record.kind} uri={source.uri} /> : !error ? <ActivityIndicator accessibilityLabel="Opening private attachment" color="#55458d" /> : null}
    <Message text={error} error />
    <TextAction title="Reload private source" onPress={() => { setSource(null); setError(null); setRetry(n => n + 1); }} />
  </View>;
}
