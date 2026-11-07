import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { designDate, type DesignNote } from '../../providers/design-notes-provider';
import { Icon } from './icons';
import { AudioBlock, colors, design, IconButton, Photo } from './primitives';

export function NoteCard({ note, onMenu, wide = false }: { note: DesignNote; onMenu?: (note: DesignNote) => void; wide?: boolean }) {
  return <View style={s.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open note: ${note.title || 'Untitled note'}`} onPress={() => router.push({ pathname: '/preview/editor', params: { id: note.id } })} style={({ pressed }) => pressed && design.pressed}>
      {note.photo ? <View><Photo name={note.photo} height={wide ? 180 : note.photo === 'lake' ? 150 : 128} />{note.pinned ? <View style={s.photoPin}><Icon name="pin" size={16} color="white" /></View> : null}</View> : null}
      <View style={s.content}>
        <View style={s.cardTop}>{!note.photo && note.pinned ? <View style={s.pinned}><Icon name="pin" size={13} color={colors.green} /><Text style={s.pinnedText}>Pinned</Text></View> : <View style={{ height: 2 }} />}</View>
        <Text style={s.title} numberOfLines={wide ? 1 : 3}>{note.title || 'Untitled note'}</Text>
        {note.body ? <Text style={s.body} numberOfLines={note.photo ? 3 : 4}>{note.body.replace(/\n/g, ' ')}</Text> : null}
        {note.checklist?.slice(0, 3).map((item, i) => <View key={i} style={s.checkRow}><View style={[s.circle, item.done && s.checked]}>{item.done ? <Icon name="check" size={10} color="white" /> : null}</View><Text numberOfLines={1} style={[s.checkText, item.done && s.completed]}>{item.text}</Text></View>)}
        {note.audio ? <View style={s.audioLabel}><Icon name="mic" size={13} color={colors.green} /><Text style={s.audioText}>Voice note · 0:47</Text></View> : null}
        {note.label ? <View style={s.label}><Text style={s.labelText}>{note.label}</Text></View> : null}
        <Text style={s.date}>{designDate(note.date, true)}</Text>
      </View>
    </Pressable>
    {onMenu ? <IconButton name="more" label={`Options for ${note.title || 'Untitled note'}`} onPress={() => onMenu(note)} style={[s.menu, note.photo && s.photoMenu]} size={17} /> : null}
  </View>;
}
// Used in the editor as well as the card so an audio note has one visual language.
export { AudioBlock };
const s = StyleSheet.create({
  card: { borderRadius: 18, backgroundColor: colors.white, overflow: 'hidden', marginBottom: 12 },
  content: { padding: 15, gap: 9 },
  cardTop: { minHeight: 8, paddingRight: 24 },
  title: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.35 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  pinned: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pinnedText: { color: colors.green, fontSize: 10, fontWeight: '500' },
  photoPin: { position: 'absolute', top: 12, left: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(20,29,20,0.35)', alignItems: 'center', justifyContent: 'center' },
  menu: { position: 'absolute', right: 3, top: 2, width: 44, height: 44 },
  photoMenu: { backgroundColor: 'rgba(255,255,255,0.9)', top: 6, right: 6, width: 40, height: 40 },
  label: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.soft, marginTop: 3 },
  labelText: { color: colors.green, fontSize: 10, fontWeight: '500' },
  date: { fontSize: 10, color: colors.muted, marginTop: 2 },
  checkRow: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  circle: { width: 13, height: 13, borderRadius: 7, borderColor: '#a9afa5', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.ink, borderColor: colors.ink },
  checkText: { color: colors.muted, fontSize: 11, lineHeight: 16, flex: 1 },
  completed: { textDecorationLine: 'line-through' },
  audioLabel: { backgroundColor: colors.soft, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8 },
  audioText: { fontSize: 10, color: colors.green },
});
