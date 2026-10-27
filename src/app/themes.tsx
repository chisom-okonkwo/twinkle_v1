import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Action,
  Message,
  Screen,
  styles,
  errorMessage,
} from "../components/ui";
import { formatNoteDate, noteStyles, TextAction } from "../components/note-ui";
import {
  changeTheme,
  readThemes,
  readThemeMembers,
  requestThemes,
  type NoteTheme,
  type ThemeMember,
  type ThemePeriod,
  type ThemeSnapshot,
} from "../lib/themes";
import { themeEmptyState, themePollDelay } from "../lib/theme-presentation";
import { useAuth } from "../providers/auth-provider";

export default function ThemesRoute() {
  const { session } = useAuth();
  return session ? (
    <Themes key={session.user.id} userId={session.user.id} />
  ) : null;
}
function Themes({ userId }: { userId: string }) {
  const [period, setPeriod] = useState<ThemePeriod>("all");
  const [snapshot, setSnapshot] = useState<ThemeSnapshot | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [epoch, setEpoch] = useState(0);
  const foreground = useRef(
    AppState.currentState == null || AppState.currentState === "active",
  );
  const active = useRef(false),
    generation = useRef(0),
    busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    controller = useRef<AbortController | null>(null);
  const load = useCallback(
    async function refresh(started = Date.now()) {
      if (!foreground.current) return;
      if (timer.current) clearTimeout(timer.current);
      const version = generation.current;
      try {
        const result = await readThemes(period, controller.current?.signal);
        if (!active.current || version !== generation.current) return;
        setSnapshot(result);
        setLoading(false);
        setError(null);
        const delay = themePollDelay(result, Date.now() - started);
        if (delay !== null)
          timer.current = setTimeout(() => void refresh(started), delay);
      } catch (cause) {
        if (active.current && version === generation.current) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      }
    },
    [period],
  );
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      foreground.current =
        AppState.currentState == null || AppState.currentState === "active";
      generation.current++;
      controller.current = new AbortController();
      setSnapshot(null);
      setLoading(true);
      setError(null);
      setEpoch((n) => n + 1);
      void load();
      const listener = AppState.addEventListener("change", (state) => {
        foreground.current = state === "active";
        generation.current++;
        controller.current?.abort();
        if (timer.current) clearTimeout(timer.current);
        if (foreground.current) {
          controller.current = new AbortController();
          setLoading(true);
          void load();
        }
      });
      return () => {
        listener.remove();
        active.current = false;
        generation.current++;
        controller.current?.abort();
        if (timer.current) clearTimeout(timer.current);
      };
    }, [load]),
  );
  async function analyze(activate = false, retry = false) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setLoading(true);
    generation.current++;
    controller.current?.abort();
    controller.current = new AbortController();
    if (timer.current) clearTimeout(timer.current);
    const version = generation.current;
    try {
      await requestThemes({ activate, retry, period });
      if (active.current && version === generation.current) await load();
    } catch (cause) {
      if (active.current && version === generation.current)
        setError(errorMessage(cause));
    } finally {
      busy.current = false;
      if (active.current && version === generation.current) setLoading(false);
    }
  }
  async function feedback(
    theme: NoteTheme,
    change: { user_label?: string | null; dismissed?: boolean },
  ) {
    await changeTheme(userId, theme.id, change);
    if (!active.current) return;
    if (change.dismissed) setHidden({ id: theme.id, label: theme.label });
    await load();
  }
  async function undo() {
    if (!hidden || busy.current) return;
    busy.current = true;
    try {
      await changeTheme(userId, hidden.id, { dismissed: false });
      if (active.current) {
        setHidden(null);
        await load();
      }
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      busy.current = false;
    }
  }
  const processing = snapshot?.status === "processing";
  const empty = snapshot ? themeEmptyState(snapshot, period) : null;
  return (
    <Screen>
      <TextAction
        title="‹ Discover thoughts"
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace("/discover")
        }
      />
      <Text accessibilityRole="header" style={styles.title}>
        Themes in your notes
      </Text>
      <Text style={styles.subtitle}>
        Ideas you return to, and thoughts worth exploring together.
      </Text>
      <View style={{ flexDirection: "row", gap: 20 }}>
        {(["all", "recent"] as const).map((value) => (
          <TextAction
            key={value}
            title={`${period === value ? "• " : ""}${value === "all" ? "All time" : "Past 90 days"}`}
            onPress={() => setPeriod(value)}
          />
        ))}
      </View>
      <Message text={error} error />
      {error ? (
        <TextAction title="Try again" onPress={() => void load()} />
      ) : null}
      {loading || processing ? (
        <ActivityIndicator
          accessibilityLabel="Looking for themes"
          color="#55458d"
        />
      ) : null}
      {snapshot?.status === "disabled" ? (
        <Text style={styles.subtitle}>
          AI context is off. You can enable it on Notes when you want Twinkle to
          look for shared ideas. Your notes and search are always available.
        </Text>
      ) : snapshot?.status === "not_started" ? (
        <View style={styles.card}>
          <Text style={styles.label}>Find ideas you keep returning to</Text>
          <Text style={styles.subtitle}>
            Find shared subjects and ideas, even when their wording differs.
            This privately processes saved thoughts, including older imports,
            using your AI context setting. Your original words stay unchanged.
          </Text>
          <Action
            title="Find themes"
            disabled={loading}
            onPress={() => void analyze(true)}
          />
        </View>
      ) : snapshot ? (
        <>
          <Text style={noteStyles.meta}>
            {snapshot.indexed} notes indexed · {snapshot.checked} evaluated in
            this period. Indexing prepares notes for discovery; it does not
            examine every possible pattern.
          </Text>
          {processing ? (
            <Text style={noteStyles.meta}>
              Looking for shared ideas. You can keep using your notes while this
              finishes.
            </Text>
          ) : null}
          {snapshot.waiting > 0 ? (
            <Text style={noteStyles.meta}>
              {snapshot.waiting} notes await indexing
              {snapshot.deferred > 0
                ? `, including ${snapshot.deferred} older or imported notes`
                : ""}
              .
            </Text>
          ) : null}
          {snapshot.deferred > 0 ? (
            <TextAction
              title="Include older and imported notes"
              disabled={loading || processing}
              onPress={() => void analyze(true)}
            />
          ) : null}
          {snapshot.unsupported > 0 ? (
            <Text style={noteStyles.meta}>
              {snapshot.unsupported} long notes are not supported by this
              version of theme discovery. Their content is unchanged and
              searchable.
            </Text>
          ) : null}
          {snapshot.status === "paused" ? (
            <Text style={noteStyles.meta}>
              Discovery is paused at its processing limit. It resumes
              automatically
              {snapshot.budget_resume_at
                ? ` after ${new Date(snapshot.budget_resume_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                : ""}
              .
            </Text>
          ) : null}
          {snapshot.status === "pending" && !loading ? (
            <TextAction
              title="Continue finding themes"
              onPress={() => void analyze()}
            />
          ) : null}
          {snapshot.status === "failed" ? (
            <>
              <Message
                text={
                  snapshot.index_failed + snapshot.validation_failed > 0
                    ? `Discovery didn’t finish: ${snapshot.index_failed} indexing failures, ${snapshot.validation_failed} group-check failures. Your notes are safe.`
                    : "Discovery didn’t finish. Your notes are safe."
                }
                error
              />
              <TextAction
                title="Retry theme analysis"
                onPress={() => void analyze(false, true)}
              />
            </>
          ) : null}
          {!snapshot.themes.length && !processing ? (
            <View style={noteStyles.state}>
              <Text style={noteStyles.heading}>{empty?.title}</Text>
              <Text style={noteStyles.stateText}>{empty?.message}</Text>
              {empty?.showAllTime ? (
                <TextAction
                  title="View all-time themes"
                  onPress={() => setPeriod("all")}
                />
              ) : null}
            </View>
          ) : null}
          {snapshot.themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              period={period}
              epoch={epoch}
              onFeedback={(change) => feedback(theme, change)}
            />
          ))}
          {snapshot.themes.length ? (
            <Text style={noteStyles.meta}>
              Dates use reliable original capture dates. Unknown import dates
              are shown separately. Groups are suggestions, not folders.
            </Text>
          ) : null}
        </>
      ) : null}
      {hidden ? (
        <View style={styles.card}>
          <Text style={noteStyles.meta}>Hidden: {hidden.label}</Text>
          <TextAction title="Undo" onPress={() => void undo()} />
        </View>
      ) : null}
    </Screen>
  );
}
function ThemeCard({
  theme,
  period,
  epoch,
  onFeedback,
}: {
  theme: NoteTheme;
  period: ThemePeriod;
  epoch: number;
  onFeedback: (change: {
    user_label?: string | null;
    dismissed?: boolean;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState(false),
    [label, setLabel] = useState(theme.label),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
      };
    }, []),
  );
  async function save(change: {
    user_label?: string | null;
    dismissed?: boolean;
  }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onFeedback(change);
      if (active.current) setEditing(false);
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const months = theme.months.slice(-12);
  return (
    <View style={styles.card}>
      <Text style={noteStyles.eyebrow}>
        {theme.recurring ? "RECURRING THEME" : "SHARED IDEA"}
      </Text>
      <Text accessibilityRole="header" style={noteStyles.heading}>
        {theme.label}
      </Text>
      <Text style={noteStyles.preview}>{theme.description}</Text>
      <Text style={styles.label}>Found in {theme.note_count} notes</Text>
      <Text style={noteStyles.meta}>
        {theme.first_at && theme.last_at
          ? `${formatNoteDate(theme.first_at)} – ${formatNoteDate(theme.last_at)}`
          : "Original dates unavailable"}
        {theme.unknown_dates > 0
          ? ` · ${theme.unknown_dates} with unknown original dates`
          : ""}
      </Text>
      <TextAction
        title={open ? "Hide related thoughts" : "Explore these thoughts"}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <>
          <TextAction title="Explore across time" onPress={() => router.push({ pathname: '/reflect', params: { id: theme.id, kind: 'theme' } })} />
          <Text style={noteStyles.eyebrow}>RELATED THOUGHTS</Text>
          <Text style={noteStyles.meta}>
            {months
              .map(
                (m) =>
                  `${new Date(`${m.month}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" })}: ${m.note_count}`,
              )
              .join(" · ")}
            {theme.months.length > 12
              ? " · Earlier dates are available in the notes below."
              : ""}
          </Text>
          <ThemeNotes
            key={`${theme.id}:${period}:${theme.note_count}:${epoch}`}
            id={theme.id}
            period={period}
          />
        </>
      ) : null}
      <Message text={error} error />
      {editing ? (
        <>
          <TextInput
            accessibilityLabel="Group name"
            value={label}
            onChangeText={setLabel}
            maxLength={80}
            editable={!busy}
            style={styles.input}
          />
          <Action
            title="Save name"
            disabled={busy || !label.trim()}
            onPress={() => void save({ user_label: label.trim() })}
          />
          <TextAction
            title="Use suggested name"
            disabled={busy}
            onPress={() => void save({ user_label: null })}
          />
          <TextAction
            title="Cancel"
            disabled={busy}
            onPress={() => setEditing(false)}
          />
        </>
      ) : (
        <View style={{ gap: 8 }}>
          <TextAction
            title="Change name"
            disabled={busy}
            onPress={() => {
              setLabel(theme.label);
              setEditing(true);
            }}
          />
          <TextAction
            title="Dismiss group"
            disabled={busy}
            onPress={() => void save({ dismissed: true })}
          />
        </View>
      )}
    </View>
  );
}
function ThemeNotes({ id, period }: { id: string; period: ThemePeriod }) {
  const [notes, setNotes] = useState<ThemeMember[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const active = useRef(false),
    locked = useRef(false),
    generation = useRef(0),
    offset = useRef(0),
    controller = useRef<AbortController | null>(null);
  const load = useCallback(
    async (append = false) => {
      if (locked.current) return;
      locked.current = true;
      setLoading(true);
      setError(null);
      const version = generation.current;
      try {
        const result = await readThemeMembers(
          id,
          period,
          append ? offset.current : 0,
          controller.current?.signal,
        );
        if (active.current && version === generation.current) {
          const page = result.slice(0, 20);
          setNotes((previous) =>
            append
              ? [
                  ...new Map(
                    [...previous, ...page].map((note) => [note.note_id, note]),
                  ).values(),
                ]
              : page,
          );
          offset.current = (append ? offset.current : 0) + page.length;
          setMore(result.length > 20);
        }
      } catch (cause) {
        if (active.current && version === generation.current)
          setError(errorMessage(cause));
      } finally {
        if (version === generation.current) {
          locked.current = false;
          if (active.current) setLoading(false);
        }
      }
    },
    [id, period],
  );
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      generation.current++;
      locked.current = false;
      controller.current = new AbortController();
      void load();
      return () => {
        active.current = false;
        generation.current++;
        controller.current?.abort();
      };
    }, [load]),
  );
  return (
    <View style={{ gap: 16 }}>
      {notes.map((note) => (
        <View key={note.note_id} style={{ gap: 6 }}>
          <Text style={styles.label}>{note.title}</Text>
          <Text style={noteStyles.meta}>
            {note.created_at
              ? formatNoteDate(note.created_at)
              : "Original date unavailable"}
          </Text>
          <Text style={noteStyles.preview}>“{note.quote}”</Text>
          <TextAction
            title="Open original note"
            onPress={() =>
              router.push({ pathname: "/note", params: { id: note.note_id } })
            }
          />
        </View>
      ))}
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading related thoughts"
          color="#55458d"
        />
      ) : null}
      <Message text={error} error />
      {error ? (
        <TextAction
          title="Retry loading thoughts"
          onPress={() => void load(notes.length > 0)}
        />
      ) : more && !loading ? (
        <TextAction title="More thoughts" onPress={() => void load()} />
      ) : null}
      {!loading && !error && !notes.length ? (
        <Text style={noteStyles.meta}>
          These thoughts have changed or are no longer available. Refresh the
          themes to see current groups.
        </Text>
      ) : null}
    </View>
  );
}
