import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Switch, Text, View } from 'react-native';
import { Screen, Action, Message, errorMessage, styles } from '../components/ui';
import { TextAction } from '../components/note-ui';
import { defaultRecallSettings, recallRepository, type RecallSettings } from '../lib/recall';
import { deviceTimezone, syncRecallDevice } from '../lib/recall-notifications';
import { useAuth } from '../providers/auth-provider';
const windows = [
  { label: 'Daytime · 9 am–8 pm', start: 9, end: 20 },
  { label: 'Morning · 9 am–noon', start: 9, end: 12 },
  { label: 'Afternoon · noon–5 pm', start: 12, end: 17 },
  { label: 'Evening · 5 pm–8 pm', start: 17, end: 20 },
];
export default function RecallSettingsRoute() {
  const { session } = useAuth();
  return session ? <Settings key={session.user.id} userId={session.user.id} /> : null;
}
function Settings({ userId }: { userId: string }) {
  const [values, setValues] = useState<RecallSettings>(defaultRecallSettings(deviceTimezone()));
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [device, setDevice] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  useFocusEffect(
    useCallback(() => {
      void retry;
      let active = true;
      setLoading(true);
      setLoaded(false);
      void recallRepository()
        .preferences(userId)
        .then((saved) => {
          if (active) {
            setValues(
              saved
                ? {
                    frequency: saved.frequency,
                    timezone: deviceTimezone(),
                    window_start: saved.window_start,
                    window_end: saved.window_end,
                    detailed_previews: saved.detailed_previews,
                  }
                : defaultRecallSettings(deviceTimezone()),
            );
            setLoaded(true);
            setError(null);
            void syncRecallDevice(userId)
              .then((message) => {
                if (active) setDevice(message);
              })
              .catch(() => {});
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
    }, [userId, retry]),
  );
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await recallRepository().savePreferences(userId, { ...values, timezone: deviceTimezone() });
      setDevice(await syncRecallDevice(userId, values.frequency !== 'off'));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    setError(null);
    try {
      setDevice(await syncRecallDevice(userId, true));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <TextAction title="‹ Notes" onPress={() => router.back()} disabled={busy} />
      <Text style={styles.title}>Room for rediscovery</Text>
      <Text style={styles.subtitle}>
        Occasional thoughts worth returning to. In-app flashbacks stay available even when notifications are
        off.
      </Text>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading flashback preferences" />
      ) : (
        <>
          <Text style={styles.label}>Flashback push notifications</Text>
          {(
            [
              { value: 'off', label: 'Off' },
              { value: 'weekly', label: 'Weekly · at most once every 7 days' },
              { value: 'few', label: 'A few times per week · at most once every 3 days' },
            ] as const
          ).map((option) => (
            <TextAction
              key={option.value}
              title={`${values.frequency === option.value ? '✓ ' : ''}${option.label}`}
              disabled={busy || !loaded}
              onPress={() => setValues((old) => ({ ...old, frequency: option.value }))}
            />
          ))}
          <Text style={styles.label}>Preferred delivery window</Text>
          <Text style={styles.subtitle}>
            We stay quiet outside this window. Times follow your device’s time zone ({deviceTimezone()}) and
            daylight saving time.
          </Text>
          {windows.map((window) => (
            <TextAction
              key={window.start + '-' + window.end}
              title={`${values.window_start === window.start && values.window_end === window.end ? '✓ ' : ''}${window.label}`}
              disabled={busy || !loaded}
              onPress={() =>
                setValues((old) => ({ ...old, window_start: window.start, window_end: window.end }))
              }
            />
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Switch
              accessibilityLabel="Allow personalized lock-screen previews"
              value={values.detailed_previews}
              disabled={busy || !loaded}
              onValueChange={(value) => setValues((old) => ({ ...old, detailed_previews: value }))}
            />
            <Text style={[styles.label, { flex: 1 }]}>Personalized previews</Text>
          </View>
          <Text style={styles.subtitle}>
            {values.detailed_previews
              ? 'Your flashback’s words may appear on the lock screen. Only enable this if you are comfortable with people nearby seeing them.'
              : 'Private by default: lock-screen previews contain no note text.'}
          </Text>
          <Text style={styles.subtitle}>
            No useful note? We skip the notification. “Not relevant” excludes that note from future
            flashbacks.
          </Text>
          <Action
            title={busy ? 'Saving…' : 'Save preferences'}
            disabled={busy || !loaded}
            onPress={() => void save()}
          />
          <TextAction
            title="Register / check this device"
            disabled={busy || !loaded || values.frequency === 'off'}
            onPress={() => void check()}
          />
        </>
      )}
      <Message text={device} />
      <Message text={error} error />
      {error && !busy ? (
        <TextAction title="Reload saved preferences" onPress={() => setRetry((value) => value + 1)} />
      ) : null}
    </Screen>
  );
}
