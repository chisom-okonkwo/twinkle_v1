import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { recallRepository } from '../lib/recall';
import { Message, errorMessage } from './ui';
import { TextAction, noteStyles } from './note-ui';
export function NoteRecallControl({
  userId,
  noteId,
  disabled,
}: {
  userId: string;
  noteId: string;
  disabled: boolean;
}) {
  const [excluded, setExcluded] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void recallRepository()
      .excluded(userId, noteId)
      .then((value) => {
        if (active) {
          setExcluded(value);
          setError(null);
        }
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [userId, noteId, retry]);
  async function toggle() {
    if (excluded === null) return;
    setBusy(true);
    try {
      await recallRepository().exclude(userId, noteId, !excluded);
      setExcluded(!excluded);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 6, marginTop: 12 }}>
      {excluded !== null ? (
        <>
          <Text style={noteStyles.meta}>
            {excluded ? 'This note is excluded from flashbacks, discovery, and themes.' : 'You control which thoughts can return.'}
          </Text>
          <TextAction
            title={excluded ? 'Allow this note in flashbacks, discovery, and themes' : 'Exclude this note from flashbacks, discovery, and themes'}
            disabled={disabled || busy}
            onPress={() => void toggle()}
          />
        </>
      ) : null}
      <Message text={error} error />
      {error ? (
        <TextAction title="Reload flashback choice" onPress={() => setRetry((value) => value + 1)} />
      ) : null}
    </View>
  );
}
