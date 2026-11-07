import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/design/icons';
import { BottomNav, colors, design, IconButton, Page, Photo } from '../../components/design/primitives';
import { designDate, useDesignNotes } from '../../providers/design-notes-provider';

export default function DesignVibe() {
  const { notes } = useDesignNotes();
  const [index, setIndex] = useState(0);
  const candidates = notes.filter(note => Boolean(note.body));
  const note = candidates.length ? candidates[(index + 3) % candidates.length] : undefined;
  return <Page>
    <View style={design.header}><Text accessibilityRole="header" style={design.title}>Vibe</Text><View style={s.vibeMark}><Icon name="sparkles" size={22} color={colors.green} /></View></View>
    <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
      <View style={s.intro}><Text style={design.eyebrow}>A LITTLE SERENDIPITY</Text><Text style={s.heading}>An old thought.{'\n'}A new possibility.</Text><Text style={s.description}>See where your notes take you.</Text></View>
      {note ? <>
        <View style={s.cardStack}><View style={s.paperBack} /><View style={s.paperMiddle} /><Pressable accessibilityRole="button" accessibilityLabel={`Revisit ${note.title || 'Untitled note'}`} onPress={() => router.push({ pathname: '/preview/editor', params: { id: note.id } })} style={({ pressed }) => [s.card, pressed && design.pressed]}>
          {note.photo ? <Photo name={note.photo} height={180} /> : <View style={s.quoteMark}><Icon name="quote" size={34} color="#bac891" /></View>}
          <View style={s.cardContent}><Text style={s.date}>{designDate(note.date, true)}{note.label ? `  ·  ${note.label}` : ''}</Text><Text style={s.noteTitle}>{note.title || 'Untitled note'}</Text><Text style={s.noteBody} numberOfLines={5}>{note.body}</Text><View style={s.revisit}><Text style={s.revisitText}>Revisit this thought</Text><Icon name="arrow" size={18} color={colors.green} /></View></View>
        </Pressable></View>
        <View style={s.shuffleRow}><Text style={s.shuffleText}>There’s more in your little universe.</Text><IconButton name="refresh" label="Discover another sample note" onPress={() => setIndex(previous => previous + 1)} style={s.shuffleButton} /></View>
      </> : <View style={s.empty}><Icon name="sparkles" size={32} color={colors.green} /><Text style={s.noteTitle}>It starts with a thought.</Text><Text style={s.description}>Your notes will find their way here.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/preview/editor')} style={s.emptyButton}><Text style={s.revisitText}>Write a note</Text></Pressable></View>}
      <Text style={s.previewNote}>A first look at Vibe · sample discoveries</Text>
    </ScrollView>
    <BottomNav active="Vibe" />
  </Page>;
}
const s = StyleSheet.create({
  vibeMark: { width: 42, height: 42, borderRadius: 22, backgroundColor: '#e7edda', alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 26, paddingBottom: 150 },
  intro: { paddingTop: 12, paddingBottom: 25 },
  heading: { fontSize: 31, lineHeight: 39, fontWeight: '500', letterSpacing: -1.2, color: colors.ink, marginTop: 17 },
  description: { color: colors.muted, fontSize: 14, marginTop: 14, lineHeight: 22 },
  cardStack: { marginHorizontal: 4, marginTop: 7, marginBottom: 16 },
  paperBack: { position: 'absolute', top: -13, bottom: 10, left: 16, right: 16, borderRadius: 21, backgroundColor: '#dfe6cc', transform: [{ rotate: '-4deg' }] },
  paperMiddle: { position: 'absolute', top: -5, bottom: 4, left: 6, right: 5, borderRadius: 21, backgroundColor: '#e7ebdf', transform: [{ rotate: '3deg' }] },
  card: { borderRadius: 20, overflow: 'hidden', backgroundColor: colors.white, boxShadow: '0 6px 24px rgba(39,51,28,0.05)' },
  cardContent: { padding: 23, gap: 12 },
  date: { fontSize: 10, letterSpacing: 0.1, color: colors.muted },
  noteTitle: { color: colors.ink, fontSize: 24, fontWeight: '500', lineHeight: 31, letterSpacing: -0.6 },
  noteBody: { color: '#62695f', fontSize: 15, lineHeight: 24 },
  revisit: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: colors.line, paddingTop: 19, marginTop: 6 },
  revisitText: { color: colors.green, fontSize: 13, fontWeight: '500' },
  quoteMark: { paddingHorizontal: 24, paddingTop: 28 },
  shuffleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 7 },
  shuffleText: { fontSize: 12, color: colors.muted, flex: 1 },
  shuffleButton: { backgroundColor: colors.white, width: 46, height: 46, borderRadius: 24 },
  previewNote: { textAlign: 'center', fontSize: 10, color: colors.muted, marginTop: 31 },
  empty: { paddingVertical: 50, gap: 18, alignItems: 'center' },
  emptyButton: { backgroundColor: colors.accent, padding: 16, borderRadius: 24 },
});
