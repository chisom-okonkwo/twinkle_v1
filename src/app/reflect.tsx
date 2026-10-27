import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  usePreventRemove,
} from "expo-router";
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
  errorMessage,
  Message,
  Screen,
  styles,
} from "../components/ui";
import {
  Confirmation,
  formatNoteDate,
  noteStyles,
  TextAction,
} from "../components/note-ui";
import {
  answerReflection,
  dismissReflection,
  readReflections,
  type ReflectionScope,
  type ReflectionSnapshot,
  requestReflection,
} from "../lib/reflections";
import { startSavedContext } from "../lib/context";
import { useAuth } from "../providers/auth-provider";

export default function ReflectRoute() {
  const { session } = useAuth();
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  const valid = typeof params.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      params.id,
    ) && ["note", "theme"].includes(params.kind ?? "note");
  return session && valid
    ? (
      <Reflection
        key={`${session.user.id}:${params.kind}:${params.id}`}
        userId={session.user.id}
        id={params.id!}
        kind={(params.kind ?? "note") as ReflectionScope}
      />
    )
    : (
      <Screen>
        <Text style={styles.subtitle}>
          This reflection link is unavailable.
        </Text>
        <TextAction title="Back to notes" onPress={() => router.replace("/")} />
      </Screen>
    );
}
function Reflection(
  { userId, id, kind }: { userId: string; id: string; kind: ReflectionScope },
) {
  const [snapshot, setSnapshot] = useState<ReflectionSnapshot | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [answer, setAnswer] = useState(""),
    [draftPrompt, setDraftPrompt] = useState<ReflectionSnapshot["prompt"]>(
      null,
    ),
    [confirmDismiss, setConfirmDismiss] = useState(false),
    [saved, setSaved] = useState<string | null>(null),
    [discard, setDiscard] = useState<(() => void) | null>(null);
  const active = useRef(false),
    locked = useRef(false),
    generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    controller = useRef<AbortController | null>(null);
  const disablePrevention = usePreventRemove(
    Boolean(answer) || busy,
    ({ repeat }) => {
      if (!locked.current) setDiscard(() => repeat);
    },
  );
  const load = useCallback(async function refresh(started = Date.now()) {
    const version = generation.current;
    try {
      const value = await readReflections(kind, id, controller.current?.signal);
      if (!active.current || version !== generation.current) return;
      setSnapshot(value);
      setLoading(false);
      setError(null);
      if (
        (value.status === "processing" ||
          value.prompt_status === "processing") && Date.now() - started < 150000
      ) timer.current = setTimeout(() => void refresh(started), 2500);
    } catch (cause) {
      if (active.current && version === generation.current) {
        setError(errorMessage(cause));
        setLoading(false);
      }
    }
  }, [id, kind]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    generation.current++;
    controller.current = new AbortController();
    setSnapshot(null);
    setLoading(true);
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      generation.current++;
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      if (state === "active") {
        controller.current = new AbortController();
        void load();
      } else setSnapshot(null);
    });
    return () => {
      listener.remove();
      active.current = false;
      generation.current++;
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]));
  async function generate(mode: ReflectionScope | "prompt") {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const version = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    if (timer.current) clearTimeout(timer.current);
    try {
      const result = await requestReflection(mode, id);
      if (!active.current || version !== generation.current) return;
      const messages: Record<string, string> = {
        insufficient:
          "There aren’t enough related notes with reliable dates at least two weeks apart yet.",
        unavailable:
          "No suitable evidence is available. AI context may be off, or these thoughts may be excluded.",
        too_recent: "Give this thought a little time before revisiting it.",
        cooldown:
          "Let’s leave room between questions. Your saved responses are always available.",
        budget:
          "Reflection has reached its processing limit for this hour. Try again later.",
        limited:
          "Reflection couldn’t finish. Try again later; your notes are safe.",
      };
      setNotice(messages[result.status] ?? null);
      await load();
    } catch (cause) {
      if (active.current && version === generation.current) {
        setError(errorMessage(cause));
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function respond() {
    const prompt = snapshot?.prompt ?? (answer ? draftPrompt : null);
    if (!prompt || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await answerReflection(prompt.id, answer);
      // Enrichment is optional and never part of the successful response transaction.
      void startSavedContext(userId, response).catch(() => {});
      if (active.current) {
        setAnswer("");
        setDraftPrompt(null);
        setSaved(response);
        setNotice("Your reflection is saved as a separate note.");
        await load();
      }
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function dismiss() {
    const prompt = snapshot?.prompt ?? draftPrompt;
    if (!prompt || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (snapshot?.prompt) await dismissReflection(prompt.id);
      if (active.current) {
        setAnswer("");
        setDraftPrompt(null);
        await load();
      }
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  const ongoing = snapshot?.status === "processing" ||
    snapshot?.prompt_status === "processing";
  const visiblePrompt = snapshot?.prompt ?? (answer ? draftPrompt : null);
  return (
    <Screen>
      <TextAction
        title="‹ Back"
        disabled={busy}
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace("/discover")}
      />
      <Text style={styles.title}>Revisit your thinking</Text>
      <Text style={styles.subtitle}>
        Your words from different moments, with room for what you think now.
      </Text>
      {kind === "note"
        ? (
          <TextAction
            title="Open original note"
            disabled={busy}
            onPress={() => router.push({ pathname: "/note", params: { id } })}
          />
        )
        : null}
      <Message text={error} error />
      <Message text={notice} />
      {snapshot?.prompt_status === "failed"
        ? (
          <Message
            text="A reflective question couldn’t be prepared. You can retry when available; your notes are unchanged."
            error
          />
        )
        : null}
      {loading || ongoing
        ? (
          <ActivityIndicator
            accessibilityLabel="Preparing reflection"
            color="#55458d"
          />
        )
        : null}
      {error
        ? (
          <TextAction
            title="Reload reflections"
            disabled={busy}
            onPress={() => void load()}
          />
        )
        : null}
      {snapshot?.status === "disabled"
        ? (
          <Text style={noteStyles.meta}>
            No AI reflection is available for this thought. AI context and
            existing privacy exclusions apply. Your notes and saved responses
            remain available.
          </Text>
        )
        : null}
      {snapshot?.comparisons.map((comparison, i) => (
        <View
          key={`${comparison.earlier_id}:${comparison.later_id}:${i}`}
          style={styles.card}
        >
          <Text style={noteStyles.eyebrow}>
            {comparison.kind === "change"
              ? "POSSIBLE CHANGE"
              : comparison.kind === "continuity"
              ? "A CONTINUING IDEA"
              : "A QUESTION REVISITED"}
          </Text>
          <Text style={noteStyles.preview}>{comparison.observation}</Text>
          {(["earlier", "later"] as const).map((position) => {
            const noteId = comparison[`${position}_id`],
              note = snapshot.notes.find((n) => n.id === noteId);
            return (
              <View key={position} style={{ gap: 6 }}>
                <Text style={styles.label}>
                  {note?.title || "Untitled note"}
                </Text>
                <Text style={noteStyles.meta}>
                  {note?.captured_at
                    ? formatNoteDate(note.captured_at)
                    : "Original date unavailable"}
                </Text>
                <Text style={noteStyles.preview}>
                  “{comparison[`${position}_quote`]}”
                </Text>
                <TextAction
                  title="Open supporting note"
                  disabled={busy}
                  onPress={() =>
                    router.push({ pathname: "/note", params: { id: noteId } })}
                />
              </View>
            );
          })}
        </View>
      ))}
      {snapshot?.status === "completed" && !snapshot.comparisons.length
        ? (
          <Text style={styles.subtitle}>
            No clear comparison is supported yet. Related subjects alone don’t
            establish a change or continuity in perspective.
          </Text>
        )
        : null}
      {snapshot?.status === "insufficient"
        ? (
          <Text style={noteStyles.meta}>
            A comparison needs related notes with reliable original dates at
            least two weeks apart. Imports with unknown dates remain available
            in your notes and all-time themes.
          </Text>
        )
        : null}
      {snapshot && ["not_started", "failed"].includes(snapshot.status)
        ? (
          <Action
            title={snapshot.status === "failed"
              ? "Retry comparison"
              : "Explore across time"}
            disabled={busy || Boolean(answer) || Boolean(ongoing)}
            secondary
            onPress={() => void generate(kind)}
          />
        )
        : null}
      {kind === "note" && snapshot?.can_prompt && !snapshot.prompt
        ? (
          <TextAction
            title="Consider a question about this thought"
            disabled={busy || Boolean(ongoing)}
            onPress={() => void generate("prompt")}
          />
        )
        : null}
      {visiblePrompt
        ? (
          <View style={styles.card}>
            <Text style={noteStyles.eyebrow}>A LITTLE ROOM TO REFLECT</Text>
            <Text style={noteStyles.preview}>“{visiblePrompt.quote}”</Text>
            <Text style={styles.label}>{visiblePrompt.question}</Text>
            {answer && snapshot && !snapshot.prompt
              ? (
                <Text style={noteStyles.meta}>
                  The original thought or its privacy settings changed. Your
                  draft is still here to copy; the old question can no longer
                  accept an answer.
                </Text>
              )
              : null}
            <TextInput
              accessibilityLabel="Your reflection"
              placeholder="What do you think now?"
              value={answer}
              onChangeText={(text) => {
                setAnswer(text);
                setDraftPrompt(visiblePrompt);
              }}
              multiline
              textAlignVertical="top"
              maxLength={100000}
              editable={!busy}
              style={[styles.input, { minHeight: 120 }]}
            />
            <Action
              title={busy ? "Saving…" : "Save reflection"}
              disabled={busy || !answer.trim() || !snapshot?.prompt}
              onPress={() => void respond()}
            />
            <TextAction
              title="Not now · hide this question"
              disabled={busy}
              onPress={() =>
                answer.trim() ? setConfirmDismiss(true) : void dismiss()}
            />
            <Text style={noteStyles.meta}>
              Optional. Your original note stays unchanged.
            </Text>
          </View>
        )
        : snapshot?.prompt_status === "none"
        ? (
          <Text style={noteStyles.meta}>
            No useful question is suggested for this thought.
          </Text>
        )
        : null}
      {saved
        ? (
          <TextAction
            title="Open saved reflection"
            onPress={() =>
              router.push({ pathname: "/note", params: { id: saved } })}
          />
        )
        : null}
      {snapshot?.responses.length
        ? <Text style={noteStyles.eyebrow}>YOUR REFLECTIONS</Text>
        : null}
      {snapshot?.responses.map((response) => (
        <View key={response.id} style={styles.card}>
          <Text style={noteStyles.meta}>
            {formatNoteDate(response.created_at)}
          </Text>
          <Text style={styles.label}>{response.question}</Text>
          <Text style={noteStyles.preview}>{response.preview}</Text>
          <TextAction
            title="Open or edit reflection"
            disabled={busy}
            onPress={() =>
              router.push({ pathname: "/note", params: { id: response.id } })}
          />
        </View>
      ))}
      <Confirmation
        visible={confirmDismiss}
        title="Discard this response?"
        description="This will discard your unsaved response and hide the question."
        confirmLabel="Discard and hide"
        cancelLabel="Keep writing"
        onCancel={() => setConfirmDismiss(false)}
        onConfirm={() => {
          setConfirmDismiss(false);
          void dismiss();
        }}
      />
      <Confirmation
        visible={Boolean(discard)}
        title="Leave this response?"
        description="Your response hasn’t been saved yet."
        confirmLabel="Discard response"
        cancelLabel="Keep writing"
        onCancel={() => setDiscard(null)}
        onConfirm={() => {
          const leave = discard;
          setDiscard(null);
          setAnswer("");
          disablePrevention();
          leave?.();
        }}
      />
    </Screen>
  );
}
