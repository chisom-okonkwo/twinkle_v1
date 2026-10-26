import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function NoteMediaMenu({ disabled, onPhoto, onAudio }: {
  disabled: boolean; onPhoto: (camera: boolean) => void; onAudio: () => void;
}) {
  const [menu, setMenu] = useState<'closed' | 'media' | 'photo'>('closed');
  const expanded = menu !== 'closed' && !disabled;
  function choose(action: () => void) { setMenu('closed'); action(); }
  return <>
    {expanded ? <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close attachment menu" onPress={() => setMenu('closed')} /> : null}
    <View pointerEvents="box-none" style={local.floating}>
      {expanded ? <View style={local.options}>
        {menu === 'photo' ? <>
          <Pressable accessibilityRole="button" style={local.option} onPress={() => choose(() => onPhoto(true))}><Text style={local.label}>Take photo</Text></Pressable>
          <Pressable accessibilityRole="button" style={local.option} onPress={() => choose(() => onPhoto(false))}><Text style={local.label}>Choose photo</Text></Pressable>
        </> : <>
          <Pressable accessibilityRole="button" style={local.option} onPress={() => setMenu('photo')}><Text style={local.label}>Photo</Text></Pressable>
          <Pressable accessibilityRole="button" style={local.option} onPress={() => choose(onAudio)}><Text style={local.label}>Audio</Text></Pressable>
        </>}
      </View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Close attachment menu' : 'Add photo or audio'} accessibilityState={{ expanded, disabled }}
        disabled={disabled} onPress={() => setMenu(expanded ? 'closed' : 'media')} style={({ pressed }) => [local.bubble, (pressed || disabled) && local.dim]}>
        <Text style={local.plus}>{expanded ? '×' : '+'}</Text>
      </Pressable>
    </View>
  </>;
}
const local = StyleSheet.create({
  floating: { position: 'absolute', right: 22, bottom: 22, alignItems: 'flex-end', gap: 12 },
  options: { gap: 10, alignItems: 'flex-end' },
  option: { minHeight: 48, minWidth: 110, borderRadius: 26, paddingHorizontal: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e1eb', elevation: 4, shadowColor: '#29263d', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6 },
  label: { color: '#55458d', fontSize: 16, fontWeight: '600' },
  bubble: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#55458d', alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#29263d', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 7 },
  plus: { color: '#fff', fontSize: 32, lineHeight: 38, fontWeight: '400' },
  dim: { opacity: 0.5 },
});
