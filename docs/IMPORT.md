# Historical note import (FR-18)

Twinkle accepts UTF-8 `.txt`, `.md`, and selected Google Keep `.json` / `.html` files. Each supported note becomes one ordinary private text note; a selected Keep JSON/HTML pair becomes one note using JSON. Notes Home → **Import notes** → choose files → review → confirm → results. Markdown is preserved as text, including headings and any metadata header; it is not rendered, rewritten, executed, or split.

## Limits and processing

- 20 files per selection, including both representations of a Keep note; 256 KiB per file; 2 MiB of accepted text per batch; the existing 100,000 Unicode-character note limit also applies.
- Native DocumentPicker allows multiple selection and copies to the app's private cache for reliable access. The app checks sizes before reading, reads at most the file limit plus one byte, validates strict UTF-8, and processes sequentially. Web reads bounded File objects.
- Empty/whitespace-only files, binary/control data, malformed UTF-8, unsupported extensions, access errors, and oversized files produce individual failures. Other valid files remain importable. Oversized selections are rejected before import.
- Valid Keep JSON is read first; same-name paired HTML is reported as skipped without loading it. If JSON is unreadable, a readable paired HTML can be reviewed instead with an explicit warning. Review order follows the original selection.
- Review holds at most the bounded batch in memory. Picker cache copies are removed after review, including on errors/cancellation; original device files are never deleted. No file contents are written to logs, shared storage, or local persistent state.
- Imports use one atomic database transaction per file and a 20-second client deadline. Results report imported, skipped, and failed files; **Retry unfinished files** does not resend successful files. Leaving/restarting the app stops further processing; reselecting the files safely resumes through duplicate detection. This is not a persistent background job.

## Selected Google Keep exports

Use **Choose files → Review → Confirm → Results**, in the existing Import notes screen. Select 15–20 files from an already extracted Keep export; no ZIP reader, separate importer, Google connection, account credentials, or synchronization is involved.

- JSON uses `textContent` and `title`, not its alternate `textContentHtml`. `listContent` items become Markdown `- [ ]` / `- [x]` lines in original order; multiline item text stays within its item. This remains the existing text editor, without adding a checklist-management UI.
- JSON `createdTimestampUsec` / `userEditedTimestampUsec` are microsecond timestamps. Safe, valid past values are converted to ISO milliseconds. Creation time populates the existing historical date field; original modification time is kept separately as `import_metadata.original_updated_at`, visible during review and in the note. Twinkle's `updated_at` starts at import time, preserving the recall settling period. Invalid/missing dates are not guessed; review explains the fallback.
- Selected same-basename JSON/HTML files are paired by filename (case-insensitive extension, Unicode-normalized basename). Valid JSON wins regardless of selection order. It supplies dates and exact text while its paired HTML is listed as skipped. This is a selection-level pairing rule, not a globally stable Google note identifier. Existing owner-scoped exact-content deduplication handles subsequent imports and renamed copies without overwriting Twinkle edits.
- HTML-only files must contain the inspected Keep `.note` / `.content` export structure. `htmlparser2` 12.0.0 performs inert token parsing; no browser/WebView, resource fetching, scripts, CSS, or external entity loading. Titles, Unicode/entities, line breaks, paragraphs and checklist states become plain text. Export template whitespace outside checklist text spans is omitted. Scripts, styles, hidden elements and annotation chrome are excluded. Parsing is bounded to 20,000 elements and 64 levels. The inspected HTML exports have no reliable creation timestamp: the import date is used, explicitly disclosed, even if a filename resembles a date.
- JSON and HTML attachment references produce a persistent review/results warning: **attachments are not imported; only text will be saved**. No attachment URLs are followed. Users may cancel before confirming and can add photos/audio later through the existing note editor. Empty and attachment-only exports fail clearly rather than creating misleading blank notes. Trashed JSON notes are rejected; archived JSON notes are identified and imported as ordinary notes.
- Non-Keep JSON, ordinary websites, invalid checklist states, malformed text, unsafe names and oversized files fail individually. JSON content resembling instructions/front matter stays original note text; it cannot become confirmed source attribution or instructions to the importer. No raw personal export or its contents are logged or committed.

## Content, dates, and sources

Original whitespace, line endings, Unicode, Markdown, and metadata text remain unchanged. A leading UTF-8 BOM is treated as an encoding marker and removed. UTF-16 and legacy encodings are unsupported.

A filename without its extension supplies the display title unless an explicit `title` is available. No title is prepended to the note. Filenames are retained as import provenance, not falsely attributed as books/articles.

An optional small front-matter subset is recognized at the start of either file type. No special format is necessary for ordinary importing. Recognized scalar keys:

```
---
title: A supplied title
created_at: 2020-02-29
source_type: project
source_name: Twinkle import testing
source_url: https://example.com/reference
source_context: Optional supplied detail
---
Original note content stays here, including this header.
```

The header must close within 4,096 characters. Plain, single-quoted, and JSON double-quoted scalar strings are accepted; arbitrary YAML, nested objects, templates, authors, inferred dates, and executable directives are not interpreted. Unknown fields remain in the original text. Repeated fields are not promoted. Incomplete/unsafe source metadata stays in the original text with a review notice.

`created_at` accepts a valid past ISO date (`YYYY-MM-DD`, stored at UTC midnight with day precision retained in provenance) or ISO timestamp with seconds and an explicit time zone. Dates are **supplied by the file**, not independently authenticated historical facts. Ambiguous, impossible, future, or missing dates are not inferred from filenames or file-system timestamps. The import time is used instead, and this distinction appears in the editor. Existing `updated_at` starts at import time and advances normally on content edits.

Source types reuse FR-14: book, article, conversation, project, other. Complete explicitly supplied source details are shown before the user confirms importing and saved in the existing editable `note_sources` row. They are not AI suggestions. No web scraping or integrations are involved. Source URLs must be HTTP(S), without credentials. Existing source edit/remove controls continue to work.

## Database and security

Applied to Twinkle V1 (`lvrmixdkkdrtssdtggnw`):

1. `20261026030754_historical_note_import.sql`: nullable `notes.import_metadata` JSONB, exact-current-content hash index, unique owner/original-import hash index, atomic import operation, imported-title search indexing.
2. `20261026031057_refine_import_validation_and_search.sql`: short filenames and imported-title phrase-search compatibility.
3. `20261026031419_integrate_import_titles_with_rediscovery.sql`: imported titles in existing related-note and discovery cards; selection/privacy rules unchanged.
4. `20261026165942_import_selected_keep_files.sql`: extends the existing private import operation to parsed Keep filenames, validates provider/original modification timestamps, and retains those fields in the existing JSONB provenance. No new table, column, index, RLS policy or public RPC signature.

No separate imported-note table, new Edge Function, server secret, or additional environment variable is required. For another Supabase environment, apply migrations in order and regenerate database types.

The public `import_text_note(file_name, body, metadata)` RPC is an authenticated SECURITY INVOKER wrapper. Its private, fixed-search-path SECURITY DEFINER implementation derives ownership exclusively from `auth.uid()`, validates bounded input, and performs only this import operation. Anonymous execution is revoked. Clients cannot directly write import provenance or creation timestamps; existing owner RLS applies to imported notes, contexts, sources, search, and relationships. The private schema is not exposed through the Data API; the only private function executable by authenticated users is this narrowly scoped helper.

Exact SHA-256 content fingerprints are owner-scoped. The transaction serializes imports for one owner, checks both current note text and the original fingerprint of earlier imports, then inserts only if neither matches. Renamed copies, retries after a lost response, and re-imports after editing an imported note are skipped. Similar ideas are not duplicates. Existing content/metadata is never overwritten. Deleting an imported note removes its fingerprint, permitting an intentional later re-import. No filename-only or approximate deduplication is attempted. Line-ending/whitespace differences are intentionally distinct content.

## Existing features

- Ordinary notes/storage/RLS/editor/delete flows are reused; no second notes collection.
- Existing search indexes content, imported title, user context, and confirmed sources immediately. Content edits update the index; deletion cascades to derived data.
- Import transactions leave enrichment **disabled/deferred**, even when AI context is enabled, so Home's pending-work resume cannot enqueue a whole collection. Open a note and choose **Analyze context**, with AI context enabled, to use the existing consent, quota, failure, and stale-result safeguards. Editing an imported note uses the normal save/enrichment path. Import success does not depend on AI.
- Related-note analysis remains on demand and consent/rate limited. Imported titles are reused in results; original note content remains the analysis source.
- Batch imports do not emit FR-16 capture suggestions. Imported notes remain available to intentional discovery through existing eligibility and privacy rules.
- Existing recall requires creation and modification to be at least seven days old. Setting modification time to the import time provides the settling period even for old historical dates. Context/meaningfulness, consent, exclusions, quiet hours, cadence, and repeat guards still apply. Import sends no notification or AI request.

## Android testing

`expo-document-picker` was installed with Expo's SDK-compatible installer for SDK 58. It adds native code, so install the new development build when ready: https://expo.dev/accounts/chisom-okonkwo/projects/twinkle_v1/builds/0c644ce2-a18d-4f1f-8b25-53bc04086ece. Subsequent JavaScript-only fixes can use the existing development server/reload. Native iOS compilation and physical iOS file providers have not been tested.

1. Save a `.txt` and `.md` on the phone; include blank lines, Unicode and Markdown. Optional samples live in `tests/fixtures/import/`.
2. Open **Import notes**, select both (Android providers usually use long-press for multi-select), review content/date/source previews, and cancel once. No notes should be created.
3. Select again and confirm. Open imported notes, compare original text, edit/save, reload, search by content and filename/title, and delete a test note.
4. Import the same files again, including a renamed copy. Expect skipped results and links to the existing notes. Editing an imported note first must not make the old file create another copy.
5. Try a mixed batch with empty, unsupported, unreadable or oversized files. Valid files should import; failures should explain what happened. Turn networking off for import, then restore it and retry or reselect. Already saved files must not be duplicated.
6. With AI context enabled, importing must not start batch AI processing. Open one note and choose **Analyze context**. Related notes use the existing optional pipeline. Imported history must not immediately produce scheduled flashbacks.
7. Sign into a different account: the first account's imports, source metadata and search results must be inaccessible.

## Verification (2026-10-25)

- Lint and TypeScript checks passed; 74 automated tests passed, 5 opt-in live-account suites skipped. Seven new parser/repository/batch tests cover import behavior.
- Database `import_security.sql`: exact content, historical vs unknown dates, sources, title/phrase/content search, exact duplication including existing typed notes, retries after edits, owner isolation, immutable provenance, malicious input/limits, delete cascades, deferred vs manual context analysis and related processing compatibility. All fixtures roll back.
- Existing notes/context/recall/search/source-related/discovery security suites passed.
- `import_performance.sql`: 20 imports into a synthetic 1,000-note collection completed in approximately **65 ms database time**, with immediate search indexing and no queued AI. This excludes network and device file access.
- Android and iOS JavaScript/Hermes exports passed. User confirmed Android importing, opening notes and duplicate skipping work.
- Supabase security advisor findings unchanged from the existing baseline; no new import findings.

Limitations: no persistent batch journal across app termination (reselect to retry safely); no approximate duplicates; only UTF-8; bounded scalar metadata rather than full YAML/import-format mapping; no fresh physical photo/audio/push regression or physical iOS test. End-to-end model enrichment was not invoked for an imported collection; its existing gated database lifecycle was verified without paid AI requests. The EAS Android development build finished successfully. Its Gradle logs confirm `expo-document-picker` 58.0.4 is linked. A subsequent device report of the missing native module requires installing this replacement APK; a tunnel QR reloads JavaScript and cannot add native modules. The import screen now checks native availability before loading the picker, showing a clear app-update instruction on older builds. The user confirmed that the file chooser opens after installing the replacement build, resolving the missing-native-module error.

## Keep extension verification (2026-10-26)

- Inspected representative real JSON/HTML text, checklist and attachment exports in Downloads. Locally parsed 20 real pairs (40 files); all 20 pairs yielded matching note text after accounting for checklist template whitespace. These personal samples were never uploaded by the checks. Committed fixtures are synthetic.
- Ten new automated tests cover content/title/date preservation, both checklist formats, safe HTML extraction, attachment warnings, malformed/oversized input, 15/20-note batches, 20 paired files becoming ten notes, JSON preference without HTML reads, broken-JSON fallback, batch limits, and the existing RPC request shape. Full suite: **91 passed, 5 opt-in live-account suites skipped**.
- Applied the Keep migration to Twinkle V1. `keep_import_security.sql` and existing `import_security.sql` passed using synthetic rollback fixtures: original dates/provenance, immediate search, 20-note batch, cross-format and post-edit retries, date/metadata rejection, owner isolation, anonymous denial, deferred AI, editing/deletion and deferred constraints. No personal notes were changed by the tests. Security advisor findings stayed at the existing baseline.
- Lint, TypeScript, and Android/iOS JavaScript/Hermes exports passed. The added parser is JavaScript only; the current development build already contains DocumentPicker, so a new native build is unnecessary. Physical iOS import and the five opt-in live AI suites were not exercised.
- User confirmed on Android that the mixed Keep import, text/titles/checklists, paired-format handling, and repeat-import skipping work as expected.

### Android Keep checklist

1. Connect the installed development app to the current development server and reload. Open **Import notes → Choose files**. Select 15–20 `.json` / `.html` files from your extracted Keep folder; include a pair and an HTML-only note. The limit counts files, not pairs.
2. Review original words/title and checklist order/checkmarks. A selected pair should show JSON ready and HTML skipped. HTML-only notes should explicitly use import time; valid JSON should show original creation and modification dates. Notes with attachments must say the media will not be imported. Cancel once to confirm nothing is saved.
3. Select again and import. Open a note, compare the text/checklist, reload, and search by its title or a distinctive phrase. Check its retained original dates. Edit/save normally.
4. Select the same files again, including a renamed copy if desired. Expect exact duplicates to be skipped with links to existing notes; edits made in Twinkle must remain intact. Selecting paired formats in the opposite order must still prefer JSON.
5. Include an unsupported file, a corrupt JSON, or an attachment-only note alongside a valid note. Valid notes should remain importable. If a corrupt JSON has a valid paired HTML, review should explain the fallback. Test an offline save and retry after reconnecting.
6. Confirm import does not start bulk AI analysis. With consent enabled, analyze one opened note on demand through the existing context control.

Limits: HTML formatting is converted to readable plain text rather than preserving rich styling; checked state remains Markdown, not interactive checkboxes. Attachments and reminder/label/color/collaborator metadata are not migrated. JSON dates retain millisecond precision. No stable Keep note ID was present in the inspected export; deduplication across separate selections relies on exact extracted content, so substantively changed source notes or different text formatting are not guaranteed to deduplicate. No persistent background import journal is added.
