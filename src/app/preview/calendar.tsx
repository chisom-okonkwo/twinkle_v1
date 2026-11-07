import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomNav, colors, design, IconButton, Page } from '../../components/design/primitives';
import { Icon } from '../../components/design/icons';
import { NoteCard } from '../../components/design/note-card';
import { designDate, useDesignNotes } from '../../providers/design-notes-provider';

function dateKey(year: number, month: number, day: number) { return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
export default function DesignCalendar() {
  const { notes } = useDesignNotes();
  const [month, setMonth] = useState(new Date(2026, 10, 1));
  const [selected, setSelected] = useState('2026-11-07');
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const total = Math.ceil((offset + days) / 7) * 7;
  const dayNotes = notes.filter(note => note.date === selected);
  function changeMonth(delta: number) {
    const next = new Date(year, monthIndex + delta, 1);
    setMonth(next); setSelected(dateKey(next.getFullYear(), next.getMonth(), 1));
  }
  return <Page>
    <View style={design.header}><Text accessibilityRole="header" style={design.title}>Calendar</Text><Pressable accessibilityRole="button" onPress={() => { setMonth(new Date(2026, 10, 1)); setSelected('2026-11-07'); }} style={s.today}><Text style={s.todayText}>Today</Text></Pressable></View>
    <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
      <Text style={s.intro}>Little moments, day by day.</Text>
      <View style={s.calendar}>
        <View style={s.monthRow}><Text style={s.month}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text><View style={design.row}><IconButton name="back" label="Previous month" onPress={() => changeMonth(-1)} size={17} /><IconButton name="chevron" label="Next month" onPress={() => changeMonth(1)} size={17} /></View></View>
        <View style={s.weekRow}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => <Text key={i} style={s.weekday}>{day}</Text>)}</View>
        {Array.from({ length: total / 7 }, (_, week) => <View key={week} style={s.weekRow}>{Array.from({ length: 7 }, (_, weekday) => {
          const day = week * 7 + weekday - offset + 1;
          if (day < 1 || day > days) return <View key={weekday} style={s.dayCell} />;
          const key = dateKey(year, monthIndex, day), active = selected === key, hasNotes = notes.some(note => note.date === key);
          return <Pressable key={weekday} accessibilityRole="button" accessibilityLabel={designDate(key, true) + (hasNotes ? ', has notes' : '')} accessibilityState={{ selected: active }} onPress={() => setSelected(key)} style={s.dayCell}><View style={[s.dayCircle, active && s.selected]}><Text style={[s.day, active && s.selectedText]}>{day}</Text>{hasNotes ? <View style={[s.dot, active && { backgroundColor: colors.white }]} /> : null}</View></Pressable>;
        })}</View>)}
      </View>
      <View style={s.dayHeading}><Text style={s.dayTitle}>{designDate(selected, true)}</Text><Text style={design.muted}>{dayNotes.length} {dayNotes.length === 1 ? 'note' : 'notes'}</Text></View>
      {dayNotes.length ? dayNotes.map(note => <View key={note.id} style={s.timeline}><View style={s.timelineRail}><View style={s.timelineDot} /><View style={s.timelineLine} /></View><View style={{ flex: 1 }}><NoteCard note={note} wide /></View></View>) : <View style={s.empty}><Icon name="text" size={30} color={colors.muted} /><Text style={s.emptyTitle}>A little blank space.</Text><Text style={design.muted}>No notes from this day. Start with a thought.</Text><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/preview/editor', params: { date: selected } })} style={s.newNote}><Icon name="plus" size={17} color={colors.green} /><Text style={s.todayText}>Add a note</Text></Pressable></View>}
    </ScrollView>
    <BottomNav active="Calendar" />
  </Page>;
}
const s = StyleSheet.create({
  today: { borderRadius: 20, backgroundColor: colors.white, paddingHorizontal: 17, minHeight: 40, justifyContent: 'center' },
  todayText: { fontSize: 13, color: colors.green, fontWeight: '500' },
  scroll: { paddingHorizontal: 22, paddingBottom: 140 },
  intro: { color: colors.muted, fontSize: 14, marginBottom: 25 },
  calendar: { backgroundColor: colors.white, padding: 15, borderRadius: 22 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 7, marginBottom: 12 },
  month: { fontSize: 18, color: colors.ink, fontWeight: '600', letterSpacing: -0.5 },
  weekRow: { flexDirection: 'row' },
  weekday: { width: '14.2857%', textAlign: 'center', fontSize: 11, color: colors.muted, paddingBottom: 13 },
  dayCell: { width: '14.2857%', minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  dayCircle: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  selected: { backgroundColor: colors.ink },
  day: { fontSize: 14, color: colors.ink },
  selectedText: { color: colors.white },
  dot: { position: 'absolute', bottom: 4, width: 3, height: 3, borderRadius: 2, backgroundColor: '#82945a' },
  dayHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 30, marginBottom: 20 },
  dayTitle: { fontSize: 16, fontWeight: '500', color: colors.ink },
  timeline: { flexDirection: 'row', gap: 15 },
  timelineRail: { width: 8, alignItems: 'center', paddingTop: 22 },
  timelineDot: { width: 8, height: 8, backgroundColor: '#b0bf8a', borderRadius: 4 },
  timelineLine: { width: 1, flex: 1, backgroundColor: '#dce2d2', marginTop: 8 },
  empty: { paddingVertical: 35, alignItems: 'center', gap: 15 },
  emptyTitle: { fontSize: 19, color: colors.ink, fontWeight: '500' },
  newNote: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 14, backgroundColor: '#e6eccf', borderRadius: 24, marginTop: 6 },
});
