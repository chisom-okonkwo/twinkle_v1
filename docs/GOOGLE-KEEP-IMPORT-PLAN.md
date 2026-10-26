# Google Keep import plan

Status: **plan only; no Keep importer has been implemented**. The media-in-notes feature was completed, confirmed on Android, and pushed first in commit `8f70548`.

This is a user-requested extension of FR-18. Keep the Phase 2 specification's simple capture philosophy and existing unified note architecture. Do not start other Phase 2 requirements or continuous synchronization.

## Recommended experience

**Import notes → Google Keep export → Choose archive → Select notes → Review → Import selected → Results.**

Use a one-time Google Takeout export. The review screen lists titles, a short preview, available historical dates, and attachment counts. Nothing is selected initially; users choose a few notes or select all within a bounded batch. Only selected notes and their approved attachments are uploaded. Unselected entries remain on the device and are discarded from the app's cache afterward.

Google documents exports containing note text, list items, attachments, labels, and other metadata. Its public help does not define a stable Keep export schema. The parser's fields, timestamp units, attachment references, and pairing of alternate representations must therefore be verified against a current sample export before implementation. [Google Keep export help](https://support.google.com/keep/answer/10017039?hl=en)

Google's Keep API is documented for enterprise administrators with domain-wide delegation. For this personal migration, Takeout avoids a Google account connection and administrator setup. This is an architectural recommendation based on the documented API purpose. [Keep API overview](https://developers.google.com/workspace/keep/api/guides)

## Preparing an export

1. Open [Google Takeout](https://takeout.google.com/) while signed into the correct Google account.
2. Deselect other products and select **Keep**.
3. Choose a one-time **ZIP** export and a download link.
4. Download the archive when Google finishes preparing it. Keep a backup; import will not modify Google Keep.
5. Once the importer exists, choose that ZIP in Twinkle and select only the notes wanted in Twinkle. Do not depend on Google offering selection of individual Keep notes during export.

Google documents product selection, one-time archives, ZIP downloads, and potentially split archives. Export can take time; downloading does not delete the source data. Start with a small representative export and support split archives as separate selections with duplicate protection. [Google Takeout instructions](https://support.google.com/accounts/answer/3024190?hl=en)

## Implementation sequence

### 1. Establish the actual input contract

Use a few consented, non-sensitive exported examples: plain note, titled note, checklist, archived note, Unicode/multiline note, photo note, and voice note. Inspect the export's own format information and compare parsed results with Keep. Create synthetic fixtures with the same structure; never commit personal exports.

Record which metadata is reliably present. Do not invent source IDs, dates, authors, links, or relationships. If the archive contains more than one representation of the same note, choose one canonical record and avoid importing its alternate representation again. Do not execute or render exported HTML.

### 2. Add one adapter to the existing importer

Reuse `src/app/import.tsx`, existing review/progress/result patterns, `import-contract.ts`, and `import_text_note` for compatible text records. Add a small Keep parser and a bounded ZIP reader, selected after checking installed Expo SDK documentation and memory behavior. Do not assume a general ZIP API exists in the current FileSystem module.

Scan entry metadata first. Reject path traversal, absolute paths, symlinks, encrypted/nested archives, suspicious compression ratios, excessive entry counts, and oversized expanded data. Read note entries sequentially; yield between batches. Read attachment bytes only for selected notes. Set explicit compressed and expanded archive limits after profiling representative Android exports; oversized archives receive an understandable message rather than freezing the app. Retain existing 20-note transaction batches and text limits initially, with selection/progress across batches.

### 3. Preserve content and provenance

Use one exported note per Twinkle note. Preserve text and line breaks without AI rewriting. Map checklist items to readable Markdown checkboxes while retaining item order and completion; preview this conversion. Preserve nesting only where the sample provides it reliably.

Reuse the imported title and verified export creation date. Store export modification time separately from Twinkle's modification time, so importing historical notes does not bypass the existing recall settling period. Reuse `notes.import_metadata` for bounded provenance such as provider `google_keep`, original title, available original dates, reliable source identifier, and import fingerprint. Extend the existing import validation only for fields actually needed; provide a migration and regenerate types if its RPC changes.

Treat “Imported from Google Keep” as transport provenance. It must not replace an actual book/article/conversation source or turn an uncertain reference into confirmed attribution. Preserve meaningful supplied source details only when explicit. Do not import collaborator email addresses, permissions, colors, or labels into new organizational features. Show archived/trash state in review when provided; exclude trash by default. Twinkle does not gain a new archive, reminder, or sharing system.

### 4. Handle attachments honestly

Reuse private `note_captures`, server-side file verification, and `note_attachments`. Never store public attachment URLs or send media to AI automatically.

Verify actual exported formats before promising support. The current pipeline accepts normalized JPEG images and MP4/WebM audio; other exported voice formats need separate compatibility work. Supported images can use existing normalization, with the conversion disclosed. Preserve an attachment's supported original bytes where the pipeline permits it.

Review must flag unsupported, missing, oversized, or over-limit attachments. Users can explicitly import text only, or leave that note unselected; never silently discard media. An attachment-only note with no supported media cannot become an empty imported note. Do not add broad audio conversion or bulk OCR as part of the first importer.

For notes with supported media, add a narrow atomic import operation that reuses the existing note/import validation and attachment ownership rules. Prepare uploads first; commit content, provenance, and the complete attachment set together. Failed transactions must not leave a partially imported note; release unused uploads through existing cleanup. Do not insert through the text RPC and then silently hope a second attachment transaction succeeds.

### 5. Make retries safe

Keep current owner-scoped exact-content duplicate detection for ordinary imports. For Keep, use a reliable provider identifier when actually present and a canonical import fingerprint including supported media identities, so different attachment-only notes are not collapsed into one duplicate. Exclude transient archive names/paths and import times from that fingerprint.

Do not trust filename alone as identity. Surface exact duplicates with a link to the existing note. If a matched source record changed since its previous import, show a review result rather than overwriting Twinkle edits. If the export has no reliable stable ID, document that limitation and use exact payload comparison. Extend the existing atomic import function and minimal owner-scoped indexes as needed; no separate imported-note collection or synchronization engine.

### 6. Reuse existing intelligence and privacy

Imported text becomes searchable immediately. Preserve deferred, on-demand contextual enrichment and existing AI consent. Do not enqueue every imported note for AI, emit capture suggestions for the batch, or reset notification limits. Related thoughts and discovery use existing eligibility checks. Historical creation dates must not remove the existing post-import recall settling period.

Keep selection and parsing local. Upload only confirmed selections through authenticated Supabase operations; derive ownership server-side and retain RLS. Do not log content, attachment bytes, or the full archive. Clear private temporary files on cancellation/completion, including partial failures. No Google password, session cookie, or API key is required.

### 7. Verify before committing

- Text, Unicode, line breaks, titles, dates, checklists, and supported media match reviewed export content.
- Selecting two notes from a larger archive imports only those two; cancel imports nothing.
- Unsupported attachments are disclosed before confirmation, including attachment-only notes.
- Alternate export representations, renamed archives, identical retries, interrupted uploads, and partially completed batches create no unintended duplicates.
- Existing edited Twinkle notes are never overwritten by a repeat export.
- Malformed archives, unsafe paths, compression bombs, oversized data, and invalid metadata fail safely within bounded memory.
- Cross-account note, provenance, attachment, and storage access is rejected.
- Search finds imports; optional enrichment works without starting a bulk AI run; recall and privacy rules remain intact.
- Lint, TypeScript, parser/repository tests, SQL ownership/atomicity tests, Android device import/playback, and Android/iOS exports pass to the extent available. Build a new development app only if the chosen implementation adds native code.

Then obtain Android confirmation, commit and push to `main`, following the project's existing workflow.

## Selected-note sharing alternative

Google Keep on Android supports **Send → Send via other apps**. A later Twinkle share receiver could offer a direct “Keep → Twinkle → Review → Save” path for individual notes. This is an alternative worth testing after the export importer, not part of this implementation plan's first delivery. Twinkle currently has no incoming-share receiver; do not imply that it appears as a share destination today. Shared text may omit reliable historical metadata, so receipt time must be distinguished from creation time. [Google's Android sharing instructions](https://support.google.com/keep/answer/6320648?co=GENIE.Platform%3DAndroid&hl=en)

The first implementation can proceed once the representative export format is verified. No private archive or new integration credentials are required just to review this plan.
