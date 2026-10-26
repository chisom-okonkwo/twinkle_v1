# Photos and recordings inside notes

This extends the existing text/photo/audio foundation. It does not introduce another Phase 2 requirement or a Google Keep importer.

## Experience

The note editor has a circular floating **+** button. Tap it for **Photo** and **Audio**. Photo offers camera or photo library; Audio starts recording. There is no Text mode: write directly in the note. Capture controls scroll into view when needed; the editor reserves space below its content so the button does not cover the last controls.

Choose **Add to note** to keep the original media without AI extraction. A new note may contain only media. The app never inserts placeholder words into the saved content; generic labels such as “Photo note” are display/search titles only.

Optionally choose **Extract text** or **Transcribe recording**, review and edit the result, then **Add to note**. Reviewed text is appended with a paragraph break; existing words, whitespace, Markdown, and line breaks stay intact. Clear the extracted text to retain just the media. Text remains the existing plain-text editor; this is not a rich-text or inline-positioning system.

Up to **10 photos/recordings** can belong to one note. Photos use the existing JPEG normalization with no resizing, up to 20 MiB; recordings use the existing five-minute/5 MiB limit. Audio-file import is not added; Audio records a new clip. Existing camera/microphone permissions are reused. No new native module or development build is required beyond the current SDK 58 app.

Attachments display inside the note. Only one attachment preview is expanded at once to bound memory and downloads. Signed URLs and the existing working private download/playback implementation are reused. Removing saved attachments is staged until Save and can be undone. Removing media does not remove written or transcribed text. Deleting the last attachment from an otherwise empty note requires adding text or deleting the note instead.

## Persistence and security

- `note_attachments` links existing `notes` and `note_captures`. Capture IDs are unique, so one source cannot be attached to multiple notes accidentally. Composite foreign keys enforce the same authenticated owner for note and media.
- Existing saved photo/audio originals are backfilled into the attachment table. Older single-source capture clients remain compatible. Original creation time and unrelated source/context/import metadata are preserved.
- Owners have read-only access to attachment rows. The authenticated `list_note_attachments` RPC uses caller-derived ownership and RLS. Clients cannot directly link/unlink records, alter file verification, or set `has_attachments`.
- The authenticated `save_note_with_attachments` invoker RPC calls a narrowly scoped private definer implementation. It derives the owner from `auth.uid()`, validates source state, ownership, expiry, storage existence, uniqueness, and count, and commits text plus the full attachment set in one transaction. Fixed search paths and explicit EXECUTE revocations protect privileged helpers.
- Existing-note saves use the previously read `updated_at` version. A stale save cannot overwrite a newer note. Retrying an already committed identical request returns the current note without duplicating attachments or appending text again. New media notes use a stable client-generated note ID for retry.
- `verified_at` is server-only. The existing authenticated `capture` Edge Function now accepts **prepare**: verify uploaded byte size, supported MIME type and file signature, without consulting OpenAI or consuming an AI attempt. Storage remains private and immutable to clients. AI **process** still uses its existing ownership checks, quotas, provider timeouts, and cached results.
- `has_attachments` permits genuinely media-only notes. A deferred database constraint checks it against real attachment rows at commit; an empty orphan note cannot be saved. Legacy captures set the flag within their existing attachment trigger. Metadata backfill preserves pre-existing modification timestamps.
- Removing/deleting notes releases media for existing cleanup. The client attempts source deletion after the successful note transaction; hourly cleanup retries failures. In-flight/saved sources remain protected by the existing capture deletion rules. Account-deletion cleanup was checked as well.
- Files and note contents are not logged. No privileged credential or OpenAI key is added to the app.

## AI and existing features

Adding media alone makes **no OpenAI request**. Processing is an optional, explicit action. Saved text continues through the existing opt-in contextual enrichment pipeline. Empty media-only notes do not enter AI enrichment, contextual capture suggestions, or related-note processing; there is no text from which to infer reliable context. The media itself is not silently analyzed in the background.

Extraction/transcription is offered while adding the attachment. Reprocessing an already saved attachment from its preview is not part of this change. The original remains available for viewing/playback.

Reviewed text becomes ordinary searchable note content and participates in context, related thoughts, discovery, and recall under their existing rules. Edits invalidate obsolete text-derived context as before; unchanged text does not generate another enrichment request just because media was added. Media-only display titles also work in existing search. Push scheduling, privacy, consent and frequency settings are unchanged.

## Backend changes

Migrations applied to Twinkle V1:

- `20261026040443_note_media_attachments.sql`: owner-scoped attachment table, indexes, legacy backfill, cleanup/link triggers, atomic save and list operations.
- `20261026040721_optional_media_save_version.sql`: optional version input for new notes.
- `20261026041533_preserve_capture_origin_with_attachments.sql`: server verification, media-only note invariant, preserved capture origin for notes begun with media, and empty-text AI guards.
- `20261026042221_index_media_ownership_and_titles.sql`: covering capture-owner index and readable fallback search titles for media-only notes.

The `capture` Edge Function was redeployed with its existing explicit JWT validation and cleanup authentication; gateway JWT verification remains off as before. No new environment variables, models, notification jobs, dependencies, or services are required. Apply migrations and deploy the updated function together for another environment, then regenerate database types.

## Verification

- User confirmed on Android: existing words preserved with photos/audio; saved media can be reopened/played; direct media attachment and media-only saves work without extracting text; floating + / Photo / Audio interaction matches the requested design.
- Seven attachment repository/contract tests cover content preservation, atomic requests, version checks, limits, media-only saves, conflict behavior and owner-free request shapes. Full automated suite: 81 passed, 5 opt-in live-account suites skipped.
- SQL rollback suites `attachments_security.sql` and `raw_attachments_security.sql` cover mixed media, legacy originals, media-only notes, owner isolation, private storage, immutable verification/flags, no AI attempts when attaching, atomic failures, exact retry, stale versions, duplicate-source rejection, limits, removal/delete/account cleanup and caption enrichment/search. Deferred constraints are explicitly checked.
- Existing notes, context, recall, search, source/related, discovery and historical-import SQL security suites passed with deferred constraints checked before rollback.
- Lint and TypeScript passed; Android/iOS JavaScript and Hermes exports passed. Physical iOS capture/playback and a fresh push-delivery test were not performed. Live OpenAI extraction/transcription integration suites require disposable account fixtures and were not rerun automatically; the user verified the working flows on Android.
- Supabase security findings remain at the existing baseline. The new foreign-key covering index addresses the attachment performance advisory.

## Android regression checklist

Save any draft and reload the installed development app through the current tunnel.

1. Open an existing text note. Tap + → Photo → choose/take a photo → Add to note → Save. Reopen and confirm the words and photo remain.
2. Tap + → Audio, record a short clip, stop, Add to note, Save. Reopen and play it.
3. Try optional extraction/transcription. Edit the result before Add to note; ensure it appends without replacing existing paragraphs.
4. Create a note with just a photo/recording and no text. Save and reopen it. Add a caption later and search for it.
5. Remove a saved attachment and undo; then remove and Save. Written words must stay. Try deleting the parent note.
6. Interrupt networking while preparing or saving. Retry without duplicating media or text. Edit the same note in another session and confirm the older save reports a conflict.
7. Sign into another account and confirm the first account's notes, media, sources and search results remain inaccessible.

Unfinished, uploaded captures retain the existing 24-hour recovery window. Unsaved local-only recordings and text are not a persistent draft journal. Normalized photos are stored as JPEG, not as the original HEIC/AVIF bytes. Attachment removal cleanup is eventually retried if networking fails.
