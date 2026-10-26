# FR-13 — Intelligent Note Search

Implemented against the Phase 2 Functional Requirements Specification and the V1 technical reference. FR-14–FR-30 are not implemented by this change.

## Experience

Notes Home now has one **Search notes** button. Search opens a protected Expo Router screen with an automatically focused input, useful previews and direct navigation to the existing editor. Text, photo-transcribed and audio-transcribed notes use the same search path. The first line is the existing app's title; no separate title field or new editing flow was added.

Typing waits 350 ms before requesting results; submitting searches immediately. Changed queries cancel previous requests and clear old results. Request generations prevent delayed responses from replacing newer results. Clearing the input shows a quiet hint without requesting the database. Empty, no-match, loading, error/retry and load-more states are supported. Focus/foreground refreshes reflect edits and deletions after returning from the editor. Results are scoped to the authenticated account and are cleared on account changes. Pagination advances by server offset even if concurrent edits cause duplicate IDs to be deduplicated.

## Retrieval and ranking

Search uses PostgreSQL full-text search, without OpenAI calls, embeddings or another search service. English stemming handles variants such as “run” / “running.” Ordinary queries require their searchable terms to match; the final word supports prefix matching when at least three characters long (for example, “intern” finds “internship”). Common-word-only searches use the simple dictionary instead of silently dropping every word. Punctuation-only input produces no results.

Word phrases naturally rank above separated words. Optional surrounding double quotes require a word phrase, including stop words, within one original note, user-context field or prompt answer. Quoted phrases cannot accidentally join the end of one context field to the start of another. Other advanced operators are not interpreted as user-facing search syntax.

Ranking is deterministic:

1. Matches fully supported by original content precede matches requiring context.
2. A phrase within the original content receives preference.
3. Weighted full-text relevance favors the first-line title, then body text, then context.
4. Modification time and note ID break remaining ties.

Recency cannot promote an unrelated note: every result must first satisfy the query. Previews select a matching passage, including matches far into long notes, rather than always showing the beginning. Context-dependent previews are labeled **Context**. Previews are plain React Native text; database-generated highlight markup is disabled.

Context includes the user's separately saved context and prompt answer. Existing completed AI context contributes only explicitly grounded excerpts from topics, situation, details, intentions, concerns and open questions. Excerpts must still occur in the current note and have its current content hash. JSON field names, processing data, suggested questions, unsupported excerpts and emotional interpretations are not search terms. User-added context remains separate and is never overwritten by search.

## Database and deployment

Applied to Supabase project `lvrmixdkkdrtssdtggnw`:

- `20261026001058_add_note_search.sql`
- `20261026001943_keep_search_phrases_within_sources.sql`

`public.note_search_documents` holds a derived title, context text, weighted English vectors and a simple-dictionary vector for phrases/common words. It references the original note with delete cascade. B-tree ownership and two GIN full-text indexes support retrieval. Derived data is kept separate so ordinary note reads do not download vectors.

Private, non-client-callable trigger helpers refresh the index in the same transaction as note/context changes. The backfill only indexes existing saved data: it does not edit notes, change timestamps, enable enrichment or call an AI provider. All existing notes have a corresponding index record. Deleted notes and context removals update/cascade correctly.

`public.search_notes(search_text, page_limit, page_offset)` is an authenticated **SECURITY INVOKER** RPC. It derives ownership from `auth.uid()`, takes no caller-provided owner, and applies RLS to the index, notes and context. Clients can read only their own derived records and cannot forge or edit the index. Definer privileges are limited to private maintenance triggers following already-authorized writes. No search function bypasses RLS.

The mobile repository uses POST requests, avoiding private query text in URLs or navigation parameters. No search-history or diagnostic-content logging was added. Searches accept at most 200 characters; the client shows 20 results per page, retrieves one additional row to detect pagination, caps broad searches at 1,000 results and aborts stalled requests after 10 seconds. The RPC bounds page size/offset and configures a five-second statement budget. Original notes are loaded through the existing owner-protected editor only when opened.

No new dependencies, environment variables, Edge Functions or scheduled jobs are required. No privileged credentials are used by the app. Apply both migrations in order for another Supabase project. The current Android development build can load the JavaScript changes by reloading Metro; a new native build is not required.

## Verification — October 25, 2026

- Lint and TypeScript passed. Default automated suite: **43 passed**, five opt-in live suites skipped.
- The new live HTTP search suite separately passed using two empty disposable accounts and public app credentials. It verified retrieval, original-note access, user-context changes, edit/delete freshness, new-session retrieval, 35-result pagination, owner isolation, index-forgery denial and anonymous denial. Accounts, sessions and test notes were removed afterward.
- `supabase/tests/search_security.sql` passed using rolled-back synthetic text/photo/audio capture records. Coverage includes keyword/phrase/prefix/stemming/Unicode queries, direct-content relevance, deep matching previews, empty/special-character/oversized input, independent context fields, unsupported AI data, original timestamp preservation, immediate updates/deletions, ownership, anonymous access and 1,000-note pagination. The cross-context phrase regression failed before its fix and passed afterward.
- `supabase/tests/search_performance.sql` is a repeatable, rolled-back 1,000-note benchmark. Measured server-side searches ranged from approximately **7–300 ms**, including a broad query and pagination at offset 200. The observed synthetic plan chose the owner B-tree index; GIN indexes are available and planner choices depend on collection statistics/selectivity. These measurements exclude network latency and are not a production-scale guarantee.
- Existing note, context and recall SQL security suites were rerun and passed. Existing local capture, storage, session and AI contract/recovery tests passed. Full new on-device camera/audio/AI capture sessions were not repeated for this search-only change.
- Android and iOS exports passed. The user confirmed searching and opening the original note work on the installed Android development app. iOS interaction and every Android failure/keyboard scenario were not manually verified.
- Database advisors reported no new search security warnings or missing foreign-key indexes. Existing private default-deny/RPC advisories and disabled leaked-password protection are unchanged; see the existing recall guide for their rationale and remediation links.

## Android checks

1. Save any draft, reload the development app, then tap **Search notes**.
2. Search a word from an existing text, photo or audio note. Try a first-line title and a phrase; tap a result to open the original.
3. Try a partial final word, such as “intern,” and an optional quoted phrase such as `"software engineering"`.
4. Add a distinctive detail using the editor's existing context controls. Search it, edit/remove it, and search again. Original note content should stay unchanged.
5. Edit a note and return to search. The new words should match; removed words should stop matching. Delete a note and verify it disappears.
6. Clear the query, search an absent word, type quickly, and test a connection failure/retry. Switch accounts and verify private notes cannot be found.

## Limits and scope

This is lexical retrieval: it does not infer synonyms, paraphrases or semantic relationships. Prefixes match word starts, not arbitrary substrings or fuzzy spelling. English stemming and basic Unicode tokenization are used; accent-insensitive matching, language-specific segmentation and typo correction are not provided. Quoted phrases are word-based; punctuation is normalized by PostgreSQL. Very long notes inherit PostgreSQL's full-text token-position limits.

Pagination is stable for an unchanged collection; concurrent edits may reorder matches. The client removes duplicate IDs and advances independently, and returning to search refreshes from the first page. Broad searches stop at 1,000 matches and can be narrowed with another word. Search requires a connection. Larger production collections and unusually long notes should be profiled before expanding the limits.

No `PROGRESS.md` exists; this guide records FR-13 completion and remaining verification limits. Existing authentication, capture, context and flashback flows were preserved. FR-14/15 source compatibility is documented in [Sources and Related Thoughts](SOURCES-AND-RELATED.md).
