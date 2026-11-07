import { forwardRef, useEffect, useState, type ComponentRef, type PropsWithChildren } from 'react';
import { router } from 'expo-router';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './icons';

export const colors = { ink: '#292e2d', muted: '#777c78', faint: '#a0a49e', canvas: '#f5f6f3', white: '#ffffff', line: '#e9ece6', accent: '#e2edb5', green: '#465a39', soft: '#eef0e9' };
export const design = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  frame: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 14, paddingBottom: 20 },
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -1, color: colors.ink },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 2.1, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.55 },
  chip: { paddingHorizontal: 16, minHeight: 38, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  chipActive: { backgroundColor: colors.ink },
  chipText: { fontSize: 13, color: colors.muted, fontWeight: '500' },
  chipTextActive: { color: colors.white },
});
export function IconButton({ name, label, onPress, dark, style, size = 21 }: { name: IconName; label: string; onPress: () => void; dark?: boolean; style?: StyleProp<ViewStyle>; size?: number }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [design.iconButton, dark && { backgroundColor: colors.ink }, style, pressed && design.pressed]}><Icon name={name} size={size} color={dark ? colors.white : colors.ink} /></Pressable>;
}
// A matching text layer measures wrapping on native and web, including after a viewport or font-size change.
export const AutoGrowingInput = forwardRef<ComponentRef<typeof TextInput>, TextInputProps>(function AutoGrowingInput({ style, value, placeholder, ...props }, ref) {
  return <View>
    <Text aria-hidden accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[style, { opacity: 0 }]}>{(value || placeholder || ' ') + '\u200b'}</Text>
    <TextInput {...props} ref={ref} value={value} placeholder={placeholder} multiline scrollEnabled={false} style={[style, StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
  </View>;
});
export function Sheet({ visible, onClose, children, title }: PropsWithChildren<{ visible: boolean; onClose: () => void; title?: string }>) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={s.scrim}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={s.handle} />
        {title ? <View style={s.sheetTitleRow}><Text accessibilityRole="header" style={s.sheetTitle}>{title}</Text><IconButton name="close" label="Close menu" onPress={onClose} /></View> : null}
        <ScrollView bounces={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </View>
  </Modal>;
}
export function SheetRow({ icon, title, detail, onPress, destructive }: { icon: IconName; title: string; detail?: string; onPress: () => void; destructive?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.sheetRow, pressed && design.pressed]}><Icon name={icon} size={20} color={destructive ? '#ca4d48' : colors.ink} /><Text style={[s.sheetRowText, destructive && { color: '#ca4d48' }]}>{title}</Text>{detail ? <Text style={design.muted}>{detail}</Text> : null}<Icon name="chevron" size={16} color={colors.faint} /></Pressable>;
}
export function BottomNav({ active }: { active: 'Home' | 'Calendar' | 'Vibe' }) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const tabs = [{ name: 'Home', icon: 'home', path: '/preview' }, { name: 'Calendar', icon: 'calendar', path: '/preview/calendar' }, { name: 'Vibe', icon: 'sparkles', path: '/preview/vibe' }] as const;
  return <>
    <View pointerEvents="box-none" style={[s.navPosition, { bottom: Math.max(insets.bottom, 14) + 8 }]}>
      <View style={s.nav}>
        {tabs.map(tab => <Pressable key={tab.name} accessibilityRole="tab" accessibilityLabel={tab.name} accessibilityState={{ selected: active === tab.name }} onPress={() => router.navigate(tab.path)} style={({ pressed }) => [s.tab, active === tab.name && s.activeTab, pressed && design.pressed]}><Icon name={tab.icon} size={20} color={active === tab.name ? colors.white : '#bfc2b9'} /><Text style={[s.tabLabel, active === tab.name && { color: colors.white }]}>{tab.name}</Text></Pressable>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Add a note" accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={({ pressed }) => [s.add, pressed && design.pressed]}><Icon name="plus" size={27} /></Pressable>
    </View>
    <Sheet visible={open} onClose={() => setOpen(false)} title="Keep a thought">
      <View style={s.captureOptions}>
        {([{ name: 'Text', icon: 'text', path: '/preview/editor' }, { name: 'Capture', icon: 'camera', path: '/preview/capture', mode: 'image' }, { name: 'Audio', icon: 'mic', path: '/preview/capture', mode: 'audio' }] as const).map(item => <Pressable key={item.name} accessibilityRole="button" onPress={() => { setOpen(false); router.push({ pathname: item.path, params: 'mode' in item ? { mode: item.mode } : {} }); }} style={({ pressed }) => [s.captureOption, pressed && design.pressed]}><View style={s.captureIcon}><Icon name={item.icon} size={28} /></View><Text style={s.captureLabel}>{item.name}</Text></Pressable>)}
      </View>
      <Text style={s.sheetFootnote}>A few words, a photo, or your own voice.</Text>
    </Sheet>
  </>;
}
export function Page({ children, white = false }: PropsWithChildren<{ white?: boolean }>) {
  return <SafeAreaView edges={['top', 'left', 'right']} style={[design.page, white && { backgroundColor: colors.white }]}><View style={design.frame}>{children}</View></SafeAreaView>;
}
export function AudioBlock({ compact = false }: { compact?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => setElapsed(value => value >= 46 ? 0 : value + 1), 1000);
    return () => clearInterval(interval);
  }, [playing]);
  return <View style={[s.audio, compact && s.audioCompact]}><IconButton name={playing ? 'pause' : 'play'} label={playing ? 'Pause waveform preview' : 'Play waveform preview'} onPress={() => setPlaying(!playing)} style={s.audioPlay} size={17} /><View style={s.wave}>{Array.from({ length: compact ? 20 : 40 }, (_, i) => <View key={i} style={{ width: 2, height: 4 + ((i * 13 + 7) % 24), borderRadius: 2, backgroundColor: playing && i / (compact ? 20 : 40) < elapsed / 47 ? colors.accent : '#939d91' }} />)}</View><Text style={s.duration}>{playing ? `0:${String(elapsed).padStart(2, '0')}` : '0:47'}</Text></View>;
}
export function Photo({ name, height = 150 }: { name: 'books' | 'lake' | 'coffee'; height?: number }) {
  const sources = { books: require('../../../assets/design/books.jpg'), lake: require('../../../assets/design/lake.jpg'), coffee: require('../../../assets/design/coffee.jpg') };
  return <Image source={sources[name]} style={{ width: '100%', height }} resizeMode="cover" accessibilityLabel={name === 'books' ? 'Shelves filled with books' : name === 'lake' ? 'A quiet lake surrounded by mountains' : 'A cup of coffee'} />;
}
const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(26,31,26,0.35)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 30, borderTopRightRadius: 30, width: '100%', maxWidth: 600, maxHeight: '86%', paddingHorizontal: 24 },
  handle: { width: 34, height: 4, backgroundColor: '#d7dad3', borderRadius: 3, alignSelf: 'center', marginTop: 10, marginBottom: 8 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 21, fontWeight: '600', letterSpacing: -0.5, color: colors.ink },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 15, minHeight: 57, borderBottomWidth: 1, borderColor: colors.line },
  sheetRowText: { color: colors.ink, fontSize: 15, flex: 1 },
  sheetFootnote: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 22, marginBottom: 8 },
  navPosition: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', gap: 9, alignItems: 'center' },
  nav: { flexDirection: 'row', backgroundColor: '#30362e', padding: 5, borderRadius: 40, boxShadow: '0 6px 22px rgba(32,40,27,0.15)' },
  tab: { width: 76, minHeight: 57, borderRadius: 30, alignItems: 'center', justifyContent: 'center', gap: 4 },
  activeTab: { backgroundColor: '#161b16' },
  tabLabel: { color: '#bfc2b9', fontSize: 10, fontWeight: '500' },
  add: { width: 62, height: 62, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderRadius: 32, boxShadow: '0 4px 18px rgba(32,40,27,0.1)' },
  captureOptions: { flexDirection: 'row', gap: 12 },
  captureOption: { flex: 1, alignItems: 'center', backgroundColor: colors.canvas, borderRadius: 18, paddingVertical: 22, gap: 13 },
  captureIcon: { height: 34, alignItems: 'center', justifyContent: 'center' },
  captureLabel: { fontSize: 14, color: colors.ink, fontWeight: '500' },
  audio: { backgroundColor: '#2d3530', borderRadius: 15, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  audioCompact: { borderRadius: 11, padding: 8, gap: 7, marginTop: 10 },
  audioPlay: { backgroundColor: colors.white, width: 30, height: 30, borderRadius: 16 },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 30, overflow: 'hidden' },
  duration: { fontSize: 10, color: colors.white, fontVariant: ['tabular-nums'] },
});
