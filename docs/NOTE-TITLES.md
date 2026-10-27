# Editable note titles

The original `notes` table had no title column. Normal cards used the body's first line; imports displayed `import_metadata.title`. That metadata is protected provenance, so its title could not be edited in the note editor.

The editor now has a separate **Title (optional)** field above the existing body. Titles support up to 300 characters on one line. The original body is never split, moved into the title, or rewritten. A title remains optional; notes still need body text or an attachment to save. Body focus for new notes, photo/audio attachments, extraction review, and ordinary capture remain unchanged.

## Persistence and compatibility

Migration `20261027040014_separate_note_titles.sql`, applied to Twinkle V1, adds owner-protected `notes.title` with an empty default and validated title-only insert/update grants. Existing imported headings are copied into that field. The backfill preserves body text, creation/modification timestamps, source attribution and original import metadata. Existing text notes keep their full original body and an empty explicit title.

A narrow insert trigger copies validated import headings for existing import clients, so txt/Markdown/Keep JSON/HTML imports need no new format or separate importer. Updating or clearing a saved title never copies the old provenance title back. Original import titles and content fingerprints remain in metadata for history and duplicate skipping.

Text saves include title and body in one owner-scoped optimistic update. The existing attachment-save RPC adds an optional `note_title` argument, preserving older calls that omit it. Title, body and attachments save in one transaction; title changes cannot be mistaken for an unchanged attachment save. Failed/conflicting saves retain the local draft. Title edits participate in the editor's unsaved-change warning.

Cards prefer the editable title and preview the full body beneath it. An empty title uses the existing first-line or media-label fallback. Existing full-text search indexes refresh on title changes and retain their current weighting/indexes. Related/discovery links and optional theme member lists display the edited heading; their selection and analysis rules are unchanged. Clearing an imported title stops indexing its old metadata heading, although words still present in the original body remain searchable.

No new dependencies, environment variables, native permissions, Edge Function, AI call, or development build is required. AI contextual analysis and theme discovery continue to use their existing body/context inputs; adding titles to AI interpretation is outside this editor change. No historical collection is sent through AI because of the migration or a title-only edit.

## Verification

- Lint and TypeScript pass.
- Automated tests: **96 passed, five existing opt-in live suites skipped** (101 total) for the isolated title commit. New cases cover independent title/body saves, imported-title changes/clearing, Unicode/length validation, card previews/fallbacks, and atomic media title saves.
- Hosted rollback SQL tests pass: `note_titles_security.sql`, notes, search, attachment, raw attachment, Keep import, sources/related, discovery and context security suites. Coverage includes owner isolation, anonymous denial, protected provenance, stale-save conflicts, immediate search updates, stable original dates/content, duplicate skipping after renaming, raw photo retitling, preserved attachments, and older RPC callers retaining titles. Title-only edits do not change body-context revisions or queue AI.
- Android and iOS JavaScript/Hermes exports pass. The user confirmed on Android that separate titles save/reopen correctly and imported Keep titles can be renamed with body and attachments preserved. Physical iOS was not tested.
- Security/performance advisors remain at the previous baseline. No new exposed definer or disabled-RLS warning was introduced. Existing [recall definer notices](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) are unchanged.

## Android check

1. Save any draft and reload the installed development app using a running development connection.
2. Create a note with a title and a different first body line. Save/reopen; both fields must retain their own text.
3. Open an imported Keep note. Its original heading should appear in the editable title field. Rename it, save, and confirm the updated card and search result. Original checklist order, completion marks and dates must remain intact.
4. Clear its title and save. The editor should remain blank in the title field; the card should fall back to the first body line, with no old metadata title reappearing.
5. Retitle a note containing a photo or recording. Save/reopen and verify that media and body remain available.
6. Change only a title and navigate back without saving. The existing discard confirmation must appear. Saving against a newer version in another session must show a conflict and preserve the local title/body draft.

FR-19/20 theme quality remains under review separately. This change does not begin another roadmap requirement or change the theme thresholds.
