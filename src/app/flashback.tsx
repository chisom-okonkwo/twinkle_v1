import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native';
import { Screen, Action, Message, errorMessage, styles } from '../components/ui';
import { TextAction } from '../components/note-ui';
import { recallRepository, type Flashback } from '../lib/recall';
import { useAuth } from '../providers/auth-provider';
export default function FlashbackRoute() {
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [item, setItem] = useState<Flashback | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  useFocusEffect(
    useCallback(() => {
      void retry;
      let active = true;
      setLoading(true);
      setItem(null);
      if (!session || !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        setLoading(false);
        return;
      }
      void recallRepository()
        .get(session.user.id, id)
        .then((value) => {
          if (active) {
            setItem(value);
            setError(null);
          }
        })
        .catch((cause) => {
          if (active) setError(errorMessage(cause));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [session, id, retry]),
  );
  async function feedback(value: 'dismissed' | 'irrelevant') {
    if (!item) return;
    try {
      await recallRepository().feedback(item.id, value);
      router.replace('/');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <Screen>
      <TextAction title="‹ Notes" onPress={() => router.replace('/')} />
      <Text style={styles.title}>A thought to revisit</Text>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Opening flashback" />
      ) : item ? (
        <>
          <Text style={styles.subtitle}>{item.message}</Text>
          <Action
            title="Open original note"
            onPress={() => router.navigate({ pathname: '/note', params: { id: item.note_id } })}
          />
          <Text style={styles.subtitle}>
            Your original words and any added context are kept with the note.
          </Text>
          <TextAction title="Hide this flashback" onPress={() => void feedback('dismissed')} />
          <TextAction title="Not relevant · exclude this note" onPress={() => void feedback('irrelevant')} />
        </>
      ) : (
        <Text style={styles.subtitle}>
          This flashback is no longer available. It may have been hidden or its note changed.
        </Text>
      )}
      <Message text={error} error />
      {error ? <TextAction title="Try again" onPress={() => setRetry((value) => value + 1)} /> : null}
    </Screen>
  );
}
