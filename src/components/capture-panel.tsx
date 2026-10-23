import { AudioModule, RecordingPresets, setAudioModeAsync, setIsAudioActiveAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Platform, Text, View } from 'react-native';
import { type CaptureAsset, type CaptureDraft, type CaptureKind, type CaptureRecord, discardDraft, downloadSource, localAsset, MAX_RECORDING_SECONDS, processCapture, removeLocalAsset, sourceUrl, stageCapture, unfinishedCaptures } from '../lib/captures';
import { Confirmation, noteStyles, TextAction } from './note-ui';
import { Action, errorMessage, Message, styles } from './ui';

export function AudioPreview({ uri, onRetry }: { uri: string; onRetry: () => void }) {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (status.isLoaded) return;
    const timer = setTimeout(() => setError('Audio could not be loaded. Reload the source and try again.'), 15000);
    return () => clearTimeout(timer);
  }, [status.isLoaded]);
  async function togglePlayback() {
    setError(null); setStarting(true);
    try {
      if (status.playing) { player.pause(); return; }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldRouteThroughEarpiece: false, interruptionMode: 'doNotMix', shouldPlayInBackground: false });
      await setIsAudioActiveAsync(true);
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.1)) await player.seekTo(0);
      player.play();
    } catch { setError('Playback could not start. Reload the source and try again.'); }
    finally { setStarting(false); }
  }
  return <View style={{ gap: 8 }}>
    <Text style={noteStyles.meta}>{Math.floor(status.currentTime)}s / {Math.floor(status.duration)}s</Text>
    <Action secondary title={!status.isLoaded ? 'Loading audio…' : status.playing ? 'Pause recording' : 'Play recording'} disabled={!status.isLoaded || starting} onPress={() => void togglePlayback()} />
    <Message text={error ?? (status.error ? 'Playback failed. Reload the source and try again.' : null)} error />
    {error || status.error ? <TextAction title="Reload audio" onPress={onRetry} /> : null}
  </View>;
}
export function SourcePreview({ kind, uri }: { kind: string; uri: string }) {
  const remote = /^https:\/\//.test(uri);
  const [cached, setCached] = useState<CaptureAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  function retryPreview() { setError(null); setCached(null); setRetry((value) => value + 1); }
  useEffect(() => {
    if (!remote) return;
    const controller = new AbortController();
    let asset: CaptureAsset | null = null;
    downloadSource(kind, uri, controller.signal).then((value) => {
      asset = value;
      if (controller.signal.aborted) removeLocalAsset(value); else setCached(value);
    }).catch(() => { if (!controller.signal.aborted) setError('The private source could not be downloaded. Check your connection or tap Reload private source.'); });
    return () => { controller.abort(); if (asset) removeLocalAsset(asset); };
  }, [kind, uri, remote, retry]);
  const source = remote ? cached?.uri : uri;
  if (error) return <><Message text={error} error /><TextAction title="Retry source preview" onPress={retryPreview} /></>;
  if (!source) return <ActivityIndicator accessibilityLabel="Downloading private source" color="#55458d" />;
  return kind === 'image' ? <Image key={`${source}-${retry}`} source={{ uri: source }} onError={() => setError('The photo could not be displayed. Reload the source and try again.')} accessibilityLabel="Source photograph" resizeMode="contain" style={{ width: '100%', height: 240, borderRadius: 12 }} /> : <AudioPreview key={`${source}-${retry}`} uri={source} onRetry={retryPreview} />;
}

export function CapturePanel({ userId, draft, onDraft, onText, onBusy, disabled = false }: {
  userId: string; draft: CaptureDraft | null; disabled?: boolean; onDraft: (draft: CaptureDraft | null) => void;
  onText: (text: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<CaptureKind | 'text'>('text');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pending, setPending] = useState<CaptureRecord[]>([]);
  const [pendingError, setPendingError] = useState(false);
  const active = useRef(true);
  const recordingRef = useRef(false);
  const handledUri = useRef<string | null>(null);
  const operation = useRef(false);
  const cancel = useRef<AbortController | null>(null);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, bitRate: 96000, numberOfChannels: 1 }, (status) => {
    if (!active.current) return;
    if (status.hasError) setError('Recording was interrupted. Any available audio is kept below; review it before transcribing.');
    if (status.isFinished || status.hasError) {
      recordingRef.current = false;
      setRecording(false);
      onBusy(false);
      if (status.url) void finishAudio(status.url);
    }
  });
  const recorderState = useAudioRecorderState(recorder, 250);

  useEffect(() => {
    active.current = true;
    unfinishedCaptures(userId).then((items) => { if (active.current) setPending(items); }).catch(() => { if (active.current) setPendingError(true); });
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && recordingRef.current) {
        void stopWithRecovery().then(() => { if (active.current) setError('Recording stopped when the app left the foreground. Review any recovered audio before transcribing.'); }).catch(() => { if (active.current) setError('The recording was interrupted. Please review any recovered audio.'); });
      }
    });
    return () => { active.current = false; cancel.current?.abort(); listener.remove(); };
    // Recorder lifetime is owned by useAudioRecorder; do not re-run for callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, recorder]);

  async function run(action: () => Promise<void>) {
    if (operation.current || disabled) return;
    operation.current = true;
    setBusy(true); onBusy(true); setError(null);
    try { await action(); }
    catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { operation.current = false; if (active.current) { setBusy(false); setPhase(null); onBusy(recordingRef.current); } }
  }

  async function choosePhoto(camera: boolean) {
    await run(async () => {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Camera access is off. Enable it in your device settings or choose a photo instead.');
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: false };
      const selected = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (selected.canceled) return;
      // Normalize unsupported HEIC/AVIF and orientation without resizing or rewriting.
      const context = ImageManipulator.manipulate(selected.assets[0].uri);
      const image = await context.renderAsync();
      const normalized = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
      const asset = await localAsset(normalized.uri, 'image', 'image/jpeg', true);
      if (active.current) onDraft({ asset, processed: false, warnings: [] });
    });
  }

  async function finishAudio(uri: string) {
    if (handledUri.current === uri) return;
    handledUri.current = uri;
    recordingRef.current = false;
    if (active.current) { setRecording(false); onBusy(false); }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    try {
      const asset = await localAsset(uri, 'audio', Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4', true);
      if (active.current) onDraft({ asset, processed: false, warnings: [] });
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
  }

  async function startRecording() {
    await run(async () => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone access is off. Enable it in your device settings to record.');
      handledUri.current = null;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      await recorder.prepareToRecordAsync();
      recordingRef.current = true;
      recorder.record({ forDuration: MAX_RECORDING_SECONDS });
      setRecording(true);
    });
  }
  async function stopWithRecovery() {
    try { await recorder.stop(); }
    catch { /* A system interruption may already have stopped the recorder. */ }
    finally { recordingRef.current = false; if (active.current) { setRecording(false); onBusy(false); } }
    if (recorder.uri) await finishAudio(recorder.uri);
    else { await setAudioModeAsync({ allowsRecording: false }).catch(() => {}); throw new Error('No recording was produced. Please try again.'); }
  }
  async function stopRecording() { await run(stopWithRecovery); }

  function process() {
    if (!draft) return;
    void run(async () => {
      setPhase(draft.asset.kind === 'image' ? 'Uploading photo…' : 'Uploading recording…');
      onDraft({ ...draft, remoteAttempted: true });
      const record = await stageCapture(userId, draft, { onStaged: (record) => { if (active.current) onDraft({ ...draft, record, remoteAttempted: true }); } });
      const staged = { ...draft, record };
      if (active.current) onDraft(staged);
      const controller = new AbortController(); cancel.current = controller;
      setProcessing(true);
      setPhase(draft.asset.kind === 'image' ? 'Extracting text…' : 'Transcribing recording…');
      let result;
      try { result = await processCapture(record.id, controller.signal); }
      finally { cancel.current = null; if (active.current) setProcessing(false); }
      cancel.current = null;
      if (active.current) { onDraft({ ...staged, processed: true, warnings: result.warnings }); if (result.text) onText(result.text); }
    });
  }
  function resume(record: CaptureRecord) {
    void run(async () => {
      const uri = await sourceUrl(record);
      if (active.current) { setMode(record.kind as CaptureKind); onDraft({ asset: { id: record.id, uri, kind: record.kind as CaptureKind, mime: record.mime_type, size: record.byte_size, remote: true }, record, processed: false, warnings: [] }); }
    });
  }

  return <View style={{ gap: 12 }}>
    {!draft ? <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {(['text', 'image', 'audio'] as const).map((item) => <TextAction key={item} title={`${mode === item ? '• ' : ''}${item === 'image' ? 'Photo' : item === 'audio' ? 'Audio' : 'Text'}`} disabled={busy || disabled || recording} onPress={() => setMode(item)} />)}
      </View>
      {mode === 'image' ? <><Action title="Take a photo" disabled={busy || disabled} onPress={() => void choosePhoto(true)} /><Action title="Choose a photo" secondary disabled={busy || disabled} onPress={() => void choosePhoto(false)} /></> : null}
      {mode === 'audio' ? <View style={noteStyles.card}>
        <Text style={styles.label}>{recording ? `Recording · ${Math.floor(recorderState.durationMillis / 1000)}s / 300s` : 'A thought, in your own voice'}</Text>
        <Text style={noteStyles.meta}>Up to 5 minutes. Recording stops when you leave the app.</Text>
        <Action title={recording ? 'Stop recording' : 'Start recording'} disabled={busy || disabled} onPress={() => void (recording ? stopRecording() : startRecording())} />
      </View> : null}
      {pending.length > 0 && !recording ? <View style={{ gap: 4 }}><Text style={noteStyles.meta}>Unfinished captures · kept privately for 24 hours</Text>{pending.map((item) => <TextAction key={item.id} title={`Resume ${item.kind === 'image' ? 'photo' : 'recording'} · ${new Date(item.created_at).toLocaleTimeString()}`} disabled={busy || disabled} onPress={() => resume(item)} />)}</View> : null}
      {pendingError ? <Text style={noteStyles.meta}>Unfinished captures could not be checked. Text notes are still available.</Text> : null}
    </> : <View style={[noteStyles.card, { gap: 12 }]}>
      <Text style={styles.label}>{draft.asset.kind === 'image' ? 'Your photo' : 'Your recording'}</Text>
      <SourcePreview key={draft.asset.id} kind={draft.asset.kind} uri={draft.asset.uri} />
      <Text style={noteStyles.meta}>{draft.processed ? 'Review the generated text below before saving. It may contain mistakes.' : 'Confirm to send this source to OpenAI for text extraction. Nothing is saved as a note until you review it and tap Save.'}</Text>
      {draft.warnings.map((warning, index) => <Message key={index} text={warning} />)}
      {!draft.processed ? <Action title={busy ? phase ?? 'Preparing source…' : draft.asset.kind === 'image' ? 'Extract text' : 'Transcribe recording'} disabled={busy || disabled} onPress={process} /> : null}
      {processing ? <TextAction title="Stop waiting" onPress={() => cancel.current?.abort()} /> : null}
      <TextAction title="Discard source" destructive disabled={busy || disabled} onPress={() => setConfirmDiscard(true)} />
    </View>}
    {busy ? <ActivityIndicator accessibilityLabel={phase ?? 'Preparing capture'} color="#55458d" /> : null}
    <Message text={error} error />
    <Confirmation visible={confirmDiscard} title="Discard this source?" description="The source file will be removed. Any text already in the editor will stay."
      confirmLabel="Discard source" onCancel={() => setConfirmDiscard(false)} onConfirm={() => {
        setConfirmDiscard(false); if (draft) void run(async () => { await discardDraft(draft); if (active.current) { onDraft(null); setPending((items) => items.filter((item) => item.id !== draft.asset.id)); } });
      }} />
  </View>;
}
