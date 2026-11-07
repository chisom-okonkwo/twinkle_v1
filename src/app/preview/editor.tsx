import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/design/icons';
import { AudioBlock, AutoGrowingInput, colors, design, IconButton, Page, Photo, Sheet, SheetRow } from '../../components/design/primitives';
import { designDate, useDesignNotes, type DesignNote } from '../../providers/design-notes-provider';

export default function DesignEditor() {
  const { id, mode, date } = useLocalSearchParams<{ id?: string; mode?: string; date?: string }>();
  const { notes, save, remove, duplicate, makeId } = useDesignNotes();
  const original = notes.find(note => note.id === id);
  const [note, setNote] = useState<DesignNote>(() => original ?? { id: makeId(), title: '', body: '', date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toLocaleDateString('en-CA'), kind: mode === 'image' ? 'image' : mode === 'audio' ? 'audio' : 'text', ...(mode === 'image' ? { photo: 'coffee' as const } : mode === 'audio' ? { audio: true } : {}) });
  const [sheet, setSheet] = useState<'options' | 'format' | 'image' | 'label' | 'delete' | null>(null);
  const bodyRef = useRef<ComponentRef<typeof TextInput>>(null);
  const insets = useSafeAreaInsets();
  const patch = (value: Partial<DesignNote>) => setNote(previous => ({ ...previous, ...value }));
  function finish() {
    Keyboard.dismiss();
    if (note.title.trim() || note.body.trim() || note.photo || note.audio || note.checklist?.some(item => item.text.trim())) save(note);
    if (router.canGoBack()) router.back(); else router.replace('/preview');
  }
  function openSheet(value: typeof sheet) { Keyboard.dismiss(); setSheet(value); }
  if (id && !original) return <Page white><View style={s.missing}><Text style={design.title}>This note has moved on.</Text><Pressable onPress={() => router.replace('/preview')} accessibilityRole="button"><Text style={design.muted}>Back to your notes</Text></Pressable></View></Page>;
  return <Page white>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.topbar}>
        <IconButton name="back" label="Save and go back" onPress={finish} style={s.softButton} />
        <View style={s.editorBrand}><Icon name="sparkles" size={15} color={colors.green} /><Text style={s.editorBrandText}>a little space for you</Text></View>
        <IconButton name="check" label="Save note" onPress={finish} dark />
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <AutoGrowingInput accessibilityLabel="Note title" placeholder="Title" placeholderTextColor="#b7bbb3" multiline value={note.title} onChangeText={title => patch({ title })} style={s.title} />
        <View style={s.meta}><Text style={s.metaText}>{designDate(note.date, true)}</Text>{note.label ? <><Text style={s.metaText}>·</Text><Pressable accessibilityRole="button" accessibilityLabel="Change note label" onPress={() => openSheet('label')}><Text style={s.metaText}>{note.label}</Text></Pressable></> : null}{note.pinned ? <Icon name="pin" size={13} color={colors.muted} /> : null}</View>
        <AutoGrowingInput ref={bodyRef} accessibilityLabel="Note body" placeholder="What’s on your mind?" placeholderTextColor="#a2a79e" multiline value={note.body} onChangeText={body => patch({ body })} style={[s.body, note.bold && { fontWeight: '700' }, note.italic && { fontStyle: 'italic' }, note.format === 'heading' && { fontSize: 23, lineHeight: 32, fontWeight: '600' }, note.format === 'quote' && s.quote]} textAlignVertical="top" />
        {note.photo ? <View style={s.photo}><Photo name={note.photo} height={230} /></View> : null}
        {note.audio ? <View style={s.audioWrap}><AudioBlock /><Text style={s.audioHint}>Sample audio · waveform preview</Text></View> : null}
        {note.checklist ? <View style={s.checklist}>{note.checklist.map((item, i) => <View key={i} style={s.checkRow}><Pressable accessibilityRole="checkbox" accessibilityLabel={item.text || 'Checklist item'} accessibilityState={{ checked: item.done }} onPress={() => patch({ checklist: note.checklist?.map((row, j) => j === i ? { ...row, done: !row.done } : row) })} style={s.checkTarget}><View style={[s.circle, item.done && s.checked]}>{item.done ? <Icon name="check" size={12} color="white" /> : null}</View></Pressable><TextInput accessibilityLabel={`Checklist item ${i + 1}`} value={item.text} placeholder="List item" placeholderTextColor={colors.faint} onChangeText={text => patch({ checklist: note.checklist?.map((row, j) => j === i ? { ...row, text } : row) })} style={[s.checkText, item.done && s.completed]} multiline /></View>)}<Pressable accessibilityRole="button" onPress={() => patch({ checklist: [...note.checklist!, { text: '', done: false }] })} style={s.addItem}><Icon name="plus" size={17} color={colors.muted} /><Text style={design.muted}>List item</Text></Pressable></View> : null}
      </ScrollView>
      <View style={[s.toolbarWrap, { paddingBottom: Math.max(insets.bottom, 14) }]}><View style={s.toolbar}>
        <IconButton name="image" label="Add image" onPress={() => openSheet('image')} />
        <IconButton name="mic" label="Add sample voice note" onPress={() => { Keyboard.dismiss(); patch({ audio: !note.audio }); }} style={note.audio && s.toolActive} />
        <IconButton name="checklist" label="Add checklist" onPress={() => { Keyboard.dismiss(); patch({ checklist: [...(note.checklist ?? []), { text: '', done: false }] }); }} />
        <IconButton name="heading" label="Text formatting" onPress={() => openSheet('format')} />
        <IconButton name="more" label="More note options" onPress={() => openSheet('options')} />
      </View></View>
    </KeyboardAvoidingView>
    <Sheet visible={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'options' ? 'Your note' : sheet === 'image' ? 'Add a little context' : sheet === 'format' ? 'Make it yours' : sheet === 'label' ? 'An optional label' : 'Let this thought go?'}>
      {sheet === 'options' ? <>
      <View style={s.quickActions}>{([{ name: 'Image', icon: 'image', action: () => setSheet('image') }, { name: 'Voice', icon: 'mic', action: () => { patch({ audio: !note.audio }); setSheet(null); } }, { name: 'Text style', icon: 'heading', action: () => setSheet('format') }] as const).map(item => <Pressable key={item.name} accessibilityRole="button" onPress={item.action} style={s.quickAction}><Icon name={item.icon} size={24} /><Text style={s.quickLabel}>{item.name}</Text></Pressable>)}</View>
      <SheetRow icon="pin" title={note.pinned ? 'Unpin note' : 'Pin note'} onPress={() => { patch({ pinned: !note.pinned }); setSheet(null); }} />
      <SheetRow icon="image" title={note.photo ? 'Change image' : 'Add an image'} onPress={() => setSheet('image')} />
      <SheetRow icon="tag" title="Label" detail={note.label ?? 'None'} onPress={() => setSheet('label')} />
      <SheetRow icon="copy" title="Make a copy" onPress={() => { save(note); const copy = duplicate(note); setSheet(null); router.replace({ pathname: '/preview/editor', params: { id: copy.id } }); }} />
      <SheetRow icon="trash" title="Delete note" destructive onPress={() => setSheet('delete')} />
      <Text style={s.sheetHint}>Design preview · changes stay in this session</Text>
      </> : sheet === 'image' ? <>
      <Text style={[design.muted, { marginBottom: 18 }]}>Choose a sample image for this preview.</Text><View style={s.photoChoices}>{(['books', 'lake', 'coffee'] as const).map(photo => <Pressable key={photo} accessibilityRole="button" accessibilityLabel={`Use ${photo} photo`} onPress={() => { patch({ photo }); setSheet(null); }} style={s.photoChoice}><Photo name={photo} height={100} /></Pressable>)}</View>
      {note.photo ? <SheetRow icon="trash" title="Remove image" onPress={() => { patch({ photo: undefined }); setSheet(null); }} /> : null}
      </> : sheet === 'format' ? <>
      <View style={s.formatRow}>{(['bold', 'italic'] as const).map(format => <Pressable key={format} accessibilityRole="button" accessibilityLabel={format === 'bold' ? 'Bold text' : 'Italic text'} accessibilityState={{ selected: Boolean(note[format]) }} onPress={() => patch({ [format]: !note[format] })} style={[s.formatButton, note[format] && s.toolActive]}><Icon name={format} /></Pressable>)}</View>
      {(['body', 'heading', 'quote'] as const).map(format => <SheetRow key={format} icon={format === 'body' ? 'text' : format === 'heading' ? 'heading' : 'quote'} title={format === 'body' ? 'Body text' : format === 'heading' ? 'Heading' : 'Quote'} detail={(note.format ?? 'body') === format ? 'Selected' : undefined} onPress={() => { patch({ format }); setSheet(null); bodyRef.current?.focus(); }} />)}
      </> : sheet === 'label' ? <>
      {['Personal', 'Life', 'Thoughts', 'Someday', 'Reading', 'None'].map(label => <SheetRow key={label} icon="tag" title={label} detail={(note.label ?? 'None') === label ? 'Selected' : undefined} onPress={() => { patch({ label: label === 'None' ? undefined : label }); setSheet(null); }} />)}
      </> : sheet === 'delete' ? <>
      <Text style={[design.muted, { marginBottom: 12 }]}>This removes the note from your design preview.</Text><SheetRow icon="trash" title="Delete note" destructive onPress={() => { remove(note.id); setSheet(null); router.replace('/preview'); }} /><SheetRow icon="back" title="Keep note" onPress={() => setSheet(null)} />
      </> : null}
    </Sheet>
  </Page>;
}
const s = StyleSheet.create({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 22 },
  softButton: { backgroundColor: colors.canvas },
  editorBrand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  editorBrandText: { fontSize: 11, color: colors.muted },
  content: { paddingHorizontal: 25, paddingBottom: 40, flexGrow: 1 },
  title: { fontSize: 28, lineHeight: 35, fontWeight: '600', letterSpacing: -0.8, color: colors.ink, padding: 0, minHeight: 38, includeFontPadding: false, outlineWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 28 },
  metaText: { fontSize: 11, color: colors.muted },
  body: { fontSize: 16, lineHeight: 26, color: colors.ink, minHeight: 80, padding: 0, outlineWidth: 0 },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 16, fontStyle: 'italic' },
  photo: { marginTop: 22, borderRadius: 16, overflow: 'hidden' },
  audioWrap: { marginTop: 22, gap: 8 },
  audioHint: { fontSize: 10, color: colors.muted, textAlign: 'right' },
  checklist: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 22, marginTop: 28 },
  checkRow: { flexDirection: 'row', alignItems: 'center' },
  checkTarget: { minHeight: 44, width: 36, justifyContent: 'center' },
  circle: { width: 19, height: 19, borderWidth: 1.3, borderColor: '#a4ab9d', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.ink, borderColor: colors.ink },
  checkText: { flex: 1, fontSize: 15, lineHeight: 23, color: colors.ink, paddingVertical: 8, outlineWidth: 0 },
  completed: { textDecorationLine: 'line-through', color: colors.muted },
  addItem: { flexDirection: 'row', alignItems: 'center', gap: 17, minHeight: 44 },
  toolbarWrap: { paddingHorizontal: 22, paddingTop: 10, backgroundColor: colors.white },
  toolbar: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.canvas, borderRadius: 22, padding: 5 },
  toolActive: { backgroundColor: colors.accent },
  quickActions: { flexDirection: 'row', gap: 10, marginBottom: 15 },
  quickAction: { flex: 1, minHeight: 94, borderRadius: 16, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center', gap: 10 },
  quickLabel: { color: colors.ink, fontSize: 12 },
  sheetHint: { textAlign: 'center', fontSize: 11, color: colors.muted, marginVertical: 20 },
  photoChoices: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  photoChoice: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  formatRow: { flexDirection: 'row', gap: 10, marginBottom: 15 },
  formatButton: { width: 60, height: 50, borderRadius: 12, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 },
});
