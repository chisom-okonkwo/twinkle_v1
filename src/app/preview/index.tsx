import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NoteCard } from '../../components/design/note-card';
import { Icon } from '../../components/design/icons';
import { BottomNav, colors, design, IconButton, Page, Sheet, SheetRow } from '../../components/design/primitives';
import { useDesignNotes, type DesignNote } from '../../providers/design-notes-provider';

export default function DesignHome() {
  const { notes, save, remove, duplicate } = useDesignNotes();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All notes');
  const [list, setList] = useState(false);
  const [menu, setMenu] = useState<DesignNote | null>(null);
  const [profile, setProfile] = useState(false);
  const filtered = notes.filter(note => (filter === 'All notes' || (filter === 'Text' ? note.kind === 'text' : filter === 'Photos' ? note.kind === 'image' : note.kind === 'audio')) && `${note.title} ${note.body} ${note.label ?? ''}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  return <Page>
    <View style={s.brandRow}><View style={[design.row, { gap: 8 }]}><View style={s.brandMark}><Icon name="sparkles" size={20} /></View><Text style={s.brand}>twinkle</Text></View><Pressable accessibilityRole="button" accessibilityLabel="About this design preview" onPress={() => setProfile(true)} style={s.avatar}><Text style={s.avatarText}>t.</Text></Pressable></View>
    <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={s.headingRow}><View style={[design.row, { gap: 10 }]}><Text accessibilityRole="header" style={design.title}>My notes</Text><Text style={s.count}>{notes.length}</Text></View><IconButton name={list ? 'grid' : 'list'} label={list ? 'Show note grid' : 'Show note list'} onPress={() => setList(!list)} /></View>
      <View style={s.search}><Icon name="search" color={colors.muted} size={20} /><TextInput accessibilityLabel="Search notes" placeholder="Find a thought…" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={s.searchInput} returnKeyType="search" />{query ? <IconButton name="close" label="Clear search" size={16} onPress={() => setQuery('')} /> : null}</View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
        {['All notes', 'Text', 'Photos', 'Audio'].map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: filter === item }} onPress={() => setFilter(item)} style={[design.chip, filter === item && design.chipActive]}><Text style={[design.chipText, filter === item && design.chipTextActive]}>{item}</Text></Pressable>)}
      </ScrollView>
      {filtered.length ? list ? filtered.map(note => <NoteCard key={note.id} note={note} onMenu={setMenu} wide />) : <View style={s.columns}>{[0, 1].map(column => <View key={column} style={s.column}>{filtered.filter((_, i) => i % 2 === column).map(note => <NoteCard key={note.id} note={note} onMenu={setMenu} />)}</View>)}</View> : <View style={s.empty}><Icon name="text" color={colors.muted} size={32} /><Text style={s.emptyTitle}>{query ? 'No thoughts found' : 'A little room for a thought'}</Text><Text style={design.muted}>{query ? 'Try a different word or another note type.' : 'Tap + to keep something here.'}</Text></View>}
      <View style={s.end}><View style={s.endLine} /><Icon name="sparkles" size={15} color={colors.faint} /><View style={s.endLine} /></View>
      <Text style={s.endText}>A little space for everything on your mind.</Text>
    </ScrollView>
    <BottomNav active="Home" />
    <Sheet visible={Boolean(menu)} onClose={() => setMenu(null)} title="Note options">
      <SheetRow icon="pin" title={menu?.pinned ? 'Unpin note' : 'Pin note'} onPress={() => { if (menu) save({ ...menu, pinned: !menu.pinned }); setMenu(null); }} />
      <SheetRow icon="copy" title="Make a copy" onPress={() => { if (menu) duplicate(menu); setMenu(null); }} />
      <SheetRow icon="trash" title="Delete note" destructive onPress={() => { if (menu) remove(menu.id); setMenu(null); }} />
    </Sheet>
    <Sheet visible={profile} onClose={() => setProfile(false)} title="A new little space">
      <Text style={[design.muted, { marginVertical: 12 }]}>You’re exploring the Twinkle design preview. These are sample notes. Changes stay in this preview and reset when you reload.</Text>
      <SheetRow icon="text" title="Open the current app" onPress={() => { setProfile(false); router.replace('/'); }} />
    </Sheet>
  </Page>;
}
const s = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  brand: { fontSize: 23, fontWeight: '600', letterSpacing: -1.1, color: colors.ink },
  brandMark: { width: 34, height: 34, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  avatar: { width: 40, height: 40, borderRadius: 21, backgroundColor: '#e4e8de', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.white },
  avatarText: { fontSize: 20, fontWeight: '600', color: colors.green, letterSpacing: -1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 145 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 19, marginBottom: 15, paddingLeft: 4 },
  count: { fontSize: 13, color: colors.muted, marginTop: 5 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#eceedf', borderRadius: 14, minHeight: 48, paddingHorizontal: 15 },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 14, minWidth: 0, outlineWidth: 0 },
  filters: { gap: 8, paddingVertical: 20 },
  columns: { flexDirection: 'row', gap: 12 },
  column: { flex: 1, minWidth: 0 },
  empty: { paddingVertical: 65, alignItems: 'center', gap: 15 },
  emptyTitle: { fontSize: 18, fontWeight: '500', color: colors.ink },
  end: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: 22 },
  endLine: { height: 1, width: 28, backgroundColor: '#dce0d5' },
  endText: { textAlign: 'center', fontSize: 11, color: colors.muted, marginTop: 10 },
});
