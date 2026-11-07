import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/design/icons';
import { colors, design, IconButton, Page, Photo } from '../../components/design/primitives';

export default function DesignCapture() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const audio = mode === 'audio';
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(false);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  function close() { if (router.canGoBack()) router.back(); else router.replace('/preview'); }
  function useSample() { router.replace({ pathname: '/preview/editor', params: { mode: audio ? 'audio' : 'image' } }); }
  return <Page white>
    <View style={design.header}><IconButton name="back" label="Back to notes" onPress={close} style={s.softButton} /><Text style={s.headerTitle}>{audio ? 'A voice, a thought' : 'Capture a moment'}</Text><View style={{ width: 44 }} /></View>
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>{audio ? 'LET IT OUT' : 'WORTH KEEPING'}</Text><Text style={s.title}>{audio ? 'Sometimes, it’s easier\nto say it.' : 'A little piece\nof the world.'}</Text>
      {audio ? <View style={s.recordArea}><View style={s.wave}>{Array.from({ length: 39 }, (_, i) => <View key={i} style={{ width: 3, height: recording || ready ? 9 + ((i * 19 + seconds * 7) % 68) : 3 + ((i * 7) % 12), borderRadius: 2, backgroundColor: i % 3 ? '#a5b885' : colors.ink }} />)}</View><Text style={s.timer}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</Text><Text style={design.muted}>{recording ? 'A thought in motion…' : ready ? 'Ready to keep this thought?' : 'Tap the microphone to try the flow.'}</Text></View> : <View style={s.cameraFrame}><Photo name="coffee" height={350} /><View style={s.cameraCorners}><View style={[s.corner, s.topLeft]} /><View style={[s.corner, s.topRight]} /><View style={[s.corner, s.bottomLeft]} /><View style={[s.corner, s.bottomRight]} /></View><View style={s.cameraBadge}><Icon name="image" size={13} color="white" /><Text style={s.cameraBadgeText}>Sample photo</Text></View></View>}
      <Text style={s.previewHint}>{audio ? 'Recording preview · microphone stays off' : 'Camera preview · using a sample image'}</Text>
    </ScrollView>
    <View style={[s.controls, { paddingBottom: Math.max(insets.bottom, 24) }]}>
      {audio && !ready ? <Pressable accessibilityRole="button" accessibilityLabel={recording ? 'Stop recording preview' : 'Start recording preview'} onPress={() => { if (recording) { setRecording(false); setReady(true); } else setRecording(true); }} style={[s.recordButton, recording && s.recording]}>{recording ? <View style={s.stopIcon} /> : <Icon name="mic" size={30} />}</Pressable> : <Pressable accessibilityRole="button" onPress={useSample} style={s.keepButton}><Icon name={audio ? 'check' : 'camera'} size={21} color="white" /><Text style={s.keepText}>{audio ? 'Use sample audio' : 'Use this photo'}</Text></Pressable>}
      {audio && ready ? <Pressable accessibilityRole="button" onPress={() => { setSeconds(0); setReady(false); }} style={s.reset}><Text style={design.muted}>Try again</Text></Pressable> : <Text style={s.controlHint}>{audio ? 'Your own words, at your own pace.' : 'Add your thoughts on the next screen.'}</Text>}
    </View>
  </Page>;
}
const s = StyleSheet.create({
  softButton: { backgroundColor: colors.canvas },
  headerTitle: { fontSize: 15, fontWeight: '500', color: colors.ink },
  content: { paddingHorizontal: 28, paddingTop: 25, paddingBottom: 20, flexGrow: 1 },
  eyebrow: { fontSize: 10, color: colors.muted, letterSpacing: 2.1, fontWeight: '600' },
  title: { fontSize: 31, lineHeight: 39, letterSpacing: -1, fontWeight: '500', color: colors.ink, marginTop: 16, marginBottom: 30 },
  cameraFrame: { borderRadius: 22, overflow: 'hidden' },
  cameraCorners: { position: 'absolute', top: 22, left: 22, right: 22, bottom: 22 },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#fff' },
  topLeft: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 5 },
  topRight: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 5 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 5 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 5 },
  cameraBadge: { position: 'absolute', bottom: 36, alignSelf: 'center', backgroundColor: 'rgba(25,30,24,0.55)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 5 },
  cameraBadgeText: { color: 'white', fontSize: 10 },
  previewHint: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 22 },
  recordArea: { paddingVertical: 40, alignItems: 'center', gap: 28 },
  wave: { width: '100%', height: 92, alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  timer: { fontSize: 43, fontWeight: '300', letterSpacing: 2, color: colors.ink, fontVariant: ['tabular-nums'] },
  controls: { paddingHorizontal: 28, paddingTop: 16, alignItems: 'center', gap: 17 },
  recordButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: '#f1f5e5' },
  recording: { backgroundColor: '#f4e4df', borderColor: '#fbf1ec' },
  stopIcon: { width: 24, height: 24, borderRadius: 5, backgroundColor: '#b75f50' },
  keepButton: { backgroundColor: colors.ink, minHeight: 56, width: '100%', borderRadius: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  keepText: { fontSize: 15, fontWeight: '500', color: colors.white },
  controlHint: { fontSize: 12, color: colors.muted },
  reset: { minHeight: 44, justifyContent: 'center' },
});
