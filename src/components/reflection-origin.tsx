import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { reflectionOrigin } from "../lib/reflections";
import { noteStyles, TextAction } from "./note-ui";
export function ReflectionOrigin({ noteId }: { noteId: string }) {
  const [origin, setOrigin] = useState<
    Awaited<ReturnType<typeof reflectionOrigin>>
  >(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    setOrigin(null);
    void reflectionOrigin(noteId).then((row) => {
      if (active) setOrigin(row);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [noteId]));
  return origin
    ? (
      <View style={{ gap: 6 }}>
        <Text style={noteStyles.eyebrow}>YOUR REFLECTION</Text>
        <Text style={noteStyles.meta}>In response to: {origin.question}</Text>
        <TextAction
          title="Revisit the original thought"
          onPress={() =>
            router.push({
              pathname: "/reflect",
              params: { id: origin.original_note_id, kind: "note" },
            })}
        />
      </View>
    )
    : null;
}
