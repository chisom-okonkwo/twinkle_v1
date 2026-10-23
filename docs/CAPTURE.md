# Photo and audio capture — FR-05 / FR-06

New notes offer **Text**, **Photo**, and **Audio** within the existing editor. Photo capture uses `expo-image-picker` for camera/library selection and shows a preview before extraction. Audio uses `expo-audio`, with recording duration, stop, discard, and playback before transcription. Processing is explicit. The result stays editable and is saved only when the user taps Save. Existing text CRUD, authentication, ordering, and conflict detection are preserved. Saved photo/audio notes show their original private source.

## Backend and configuration

Already configured on project `lvrmixdkkdrtssdtggnw`:

- Migrations `20261023064553_add_media_captures.sql` and `20261023160250_improve_media_uploads.sql`, after the existing notes migration.
- Private `note-media` bucket, owner RLS, source-capture metadata, atomic note/source attachment, processing claims, retry limits, and cleanup job.
- Edge Function `capture`, with `OPENAI_API_KEY` stored under **Edge Functions → Secrets**. No new client environment variables are required.

The application still needs only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These values are public. Never add an OpenAI key, service-role key, database password, or management token to an Expo variable or Git.

Server-only optional secrets:

| Name | Default / purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for processing; configured on this project |
| `OPENAI_VISION_MODEL` | `gpt-6-luna` |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-transcribe` |
| `PHOTO_EXTRACTION_INSTRUCTIONS` | Override the text-preserving vision instructions |
| `AUDIO_TRANSCRIPTION_INSTRUCTIONS` | Override the original-language transcription prompt |

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function. The vision request uses Responses with a strict JSON schema, `store: false`, and no summarization. After checking the uploaded file, the server supplies OpenAI with a private signed image URL valid for three minutes, avoiding large base64 copies in Edge Function memory. Completed recordings use the file-transcription endpoint; no language or translation is forced. Both models were accepted by the live API. Provider processing is subject to the OpenAI account's data controls; source media is sent there only when the user explicitly requests extraction/transcription.

To deploy changes with an authorized Supabase CLI login:

```sh
npx --yes supabase functions deploy capture --project-ref lvrmixdkkdrtssdtggnw --no-verify-jwt --use-api
```

Gateway JWT verification is disabled because the function verifies each normal Bearer token itself with `auth.getUser()`, supporting the project's signing keys. This does **not** enable anonymous processing. The sole maintenance path requires a separately generated private cleanup token, kept inside the database.

For another project, apply migrations in order using the CLI migration workflow. Set `private.capture_settings.function_url` to that project's `/functions/v1/capture` URL as the database owner (the migration contains this project's URL), configure the OpenAI secret in its dashboard, deploy the function, and regenerate database types. Enable `pg_cron` and `pg_net` if the project does not permit the migration to enable them. Never copy the generated cleanup token into client configuration.

## Ownership, recovery, and limits

- The client can stage only its own capture with a fixed owner/capture/file path. It cannot forge processing results, overwrite source files, or directly delete originals. For review, private signed URLs are downloaded into temporary local files, with file type/size checks and a 20-second download deadline. Temporary preview copies are removed on unmount. Reloading a private source obtains a new URL and resets the image/audio preview.
- The function validates the authenticated owner, MIME type, file signature, and size before calling OpenAI. It does not log content, transcripts, media, or provider error bodies.
- Images are normalized to full-resolution JPEG without resizing, at 92% encoding quality to reduce unnecessary upload size. The original device-library asset is untouched. Photos are limited to **20 MiB**; larger images must be replaced with a smaller image. Empty-file and oversize errors are distinct.
- Native audio is mono AAC in M4A at 96 kbps; the optional browser target uses WebM. Recording stops after **5 minutes**, with a **5 MiB** recording limit. Background recording is disabled; leaving the foreground stops recording and retains the completed file when the recorder supplies one. Playback waits for the player to load, explicitly restores the playback audio session and speaker route, and offers reload on failure.
- Sources survive processing errors. Retry refreshes the capture state and checks the Storage object's top-level `size` before uploading, so an upload that succeeded but lost its response is reused. Upload requests have a 45-second deadline and one automatic retry; metadata requests are bounded separately. The UI distinguishes uploading from extraction/transcription. An unstable connection can still fail; the source remains available for another attempt.
- Completed results are cached; the client reads that cache before invoking AI and recovers it after a lost function response, avoiding another successful model call. Server claims allow three attempts per capture and twenty processing attempts per user per hour. Stopping the UI wait can leave an in-flight server request completing; retry may report busy for up to two minutes before recovery.
- Unfinished uploaded captures can be resumed from a new editor session for 24 hours. Local previews that have not reached the cloud can be lost on force-close or cache eviction. Draft text is still in memory until saved.
- Saved originals remain linked to their notes. Note deletion attempts immediate source removal. Explicitly discarded uploads are removed through the function. Hourly cleanup (`17 * * * *`, up to 100 captures per run) removes expired abandoned uploads and orphaned sources after account deletion, retrying earlier cleanup failures. Saved sources are excluded. Processing leases prevent cleanup during active work.
- Private budget/settings tables deliberately have RLS with no client policies; only the server uses them. Cleanup metadata is deleted only after Storage confirms removal.

## Android and iOS checks

Run `npm ci`, configure the two public Supabase values, and rebuild your development client with the new Expo native modules and config plugins. Use the project's EAS development build workflow; this repository does not yet contain an EAS build profile. See [Expo development build setup](https://docs.expo.dev/develop/development-builds/create-a-build/). For a configured EAS project the command is `npx eas-cli@latest build --profile development --platform android`. Install the resulting build, then run `npx expo start --dev-client --clear`.

1. Sign in and choose New note → Photo. Test both Take photo and Choose photo, including denied camera permission and picker cancellation. Confirm the preview before tapping Extract text.
2. Test printed text, your handwriting, ambiguous text, and a blank image. Review warnings, correct the editable result, and Save. Reopen the note and confirm the private original appears. Force-close/reopen the app and verify persistence.
3. Choose New note → Audio. Grant microphone permission, record several sentences, watch the duration, stop, and play back. Tap Transcribe, edit, and Save. Repeat in another language and with normal background noise. Test denied permission, a phone/audio interruption, and foreground/background transitions.
4. Cancel/discard a capture, and confirm that it creates no note. Disconnect during processing, reconnect, and retry without recapturing. A completed cloud result should be reused. Force-close after an upload and check Resume unfinished capture in a new editor.
5. Sign in with another account and verify the first account's notes and media are absent. Edit/delete a saved media note and create a normal text note to check regressions.

Both iOS and Android bundles were exported successfully. Physical camera/microphone permissions, recording/playback, interruptions, Android Back, and actual device restarts could not be exercised on this host and remain release checks.

## Verification performed

```sh
npm run lint
npm run typecheck
npm test
npx --yes deno check supabase/functions/capture/index.ts
npx expo export --platform android --platform ios
```

Local tests cover strict media/result validation, signatures, exact configured models, structured image output, incomplete/error responses, original-language audio request construction, empty transcription, the Storage v2 size response, bounded retries, cancellation/deadlines, and lost-upload/function-response recovery. Database security scripts under `supabase/tests/` roll back their fixtures.

Live checks used two disposable confirmed accounts, synthetic images, and synthetic speech. They verified printed text, a handwriting-style font, blank-image handling, English transcription, digital silence, cached retries, private source persistence in a fresh authenticated client, media-note creation, idempotent save, anonymous/cross-owner denial, immutable originals, invalid-file recovery, source cleanup, and retention of saved originals during cleanup. The web UI was exercised for image selection, preview, extraction, editing, saving, reopening, and reload persistence. These checks do not establish real-handwriting, accent, or noisy-audio accuracy; users must review AI output before saving.

The upload-recovery fix was checked again against the live backend, including an 8,475,253-byte valid JPEG fixture (expanded using JPEG comments), extraction through a short-lived private URL, saving, and a byte-for-byte private download. A saved M4A source passed the same integrity check. Recovery tests explicitly simulate an upload committing before its response is lost, a lost function response after a completed result, repeated network errors, and platforms ignoring cancellation. The Android report showed a stalled upload of about 92 seconds, while requests reaching the processing function succeeded. No real user media or note contents were read during diagnosis.

After these fixes, the user confirmed on Android with Expo Go that recording playback and private-source loading both work. Browser playback was also observed advancing through the saved recording. Physical interruption/noisy-audio tests remain outstanding.

To rerun the billed live capture test, provide an external, private JSON file containing two disposable accounts (`id`, `email`, `password`), and a fixture directory containing `printed.jpg`, `handwriting-font.jpg`, `blank.jpg`, and `speech.m4a`. The two text images must contain the expected text defined in the test, and the recording must include its expected phrases. Run:

```sh
TWINKLE_TEST_FIXTURES=/private/path/test-users.json TWINKLE_MEDIA_FIXTURES=/private/path/media node --env-file=.env.local --test tests/captures.integration.test.mjs
```

The test removes its own notes/captures. Delete the disposable accounts and private fixture file afterwards. Never use real user accounts. No `PROGRESS.md` exists in this repository; this guide records the implementation status. FR-07+, real-time transcription, enrichment, flashbacks, and notifications remain out of scope.
