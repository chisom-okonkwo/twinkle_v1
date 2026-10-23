import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { Message, errorMessage, styles } from './ui';
import { TextAction, noteStyles } from './note-ui';
import { refreshFlashback, recallRepository, type Flashback } from '../lib/recall';
export function FlashbackCard({ userId }: { userId: string }) {
  const [item, setItem] = useState<Flashback | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const request = useRef(0),
    active = useRef(false);
  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    try {
      const saved = await refreshFlashback(userId);
      if (active.current && version === request.current) {
        setItem(saved);
        setError(null);
      }
    } catch (cause) {
      if (active.current && version === request.current) setError(errorMessage(cause));
    } finally {
      if (active.current && version === request.current) setLoading(false);
    }
  }, [userId]);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      void load();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load();
      });
      return () => {
        active.current = false;
        request.current++;
        listener.remove();
      };
    }, [load]),
  );
  async function respond(feedback: 'dismissed' | 'irrelevant') {
    if (!item) return;
    setLoading(true);
    try {
      await recallRepository().feedback(item.id, feedback);
      if (active.current) {
        setItem(null);
        setError(null);
      }
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      if (active.current) setLoading(false);
    }
  }
  return (
    <View style={[styles.card, { backgroundColor: '#f1eef7', gap: 8 }]}>
      <Text style={noteStyles.eyebrow}>A THOUGHT TO REVISIT</Text>
      {loading && !item ? (
        <ActivityIndicator accessibilityLabel="Looking for a flashback" color="#55458d" />
      ) : null}
      {item ? (
        <>
          <Text style={noteStyles.preview}>{item.message}</Text>
          <TextAction
            title="Open flashback"
            disabled={loading}
            onPress={() => router.navigate({ pathname: '/flashback', params: { id: item.id } })}
          />
          <View style={{ flexDirection: 'row', gap: 20, flexWrap: 'wrap' }}>
            <TextAction title="Hide" disabled={loading} onPress={() => void respond('dismissed')} />
            <TextAction title="Not relevant" disabled={loading} onPress={() => void respond('irrelevant')} />
          </View>
        </>
      ) : !loading ? (
        <Text style={noteStyles.meta}>No flashback for now. Your thoughts have room to settle.</Text>
      ) : null}
      <Message text={error} error />
      {error ? <TextAction title="Retry flashbacks" disabled={loading} onPress={() => void load()} /> : null}
      <TextAction title="Flashback preferences" onPress={() => router.navigate('/recall-settings')} />
    </View>
  );
}
