# FR-14 and FR-15 — Sources and Related Thoughts

Implemented October 25, 2026 (client time). Primary functional reference: **Twinkle — Phase 2 Functional Requirements Specification.md**, FR-14/15. The V1 technical reference, existing Expo Router architecture and calm, optional UI are preserved. This guide covers the FR-14/15 foundation. The subsequent [FR-16/17 discovery implementation](DISCOVERY.md) reuses it. No `PROGRESS.md` exists; this document records completion and remaining verification limits.

## Source attribution

Open a saved note and choose **Add a source**. A small optional form supports book, article/website, conversation, project and other, with a name/title, HTTP(S) link and descriptive detail. Save, edit or remove attribution independently of the original note. Text, photo and audio notes share the same note ID and source path. Capture does not acquire mandatory fields.

`public.note_sources` stores one attribution row per note. All persisted attribution is **user-confirmed**, not an AI claim. Literal labels already in the saved content, such as `Book: The Creative Practice` or `Website: https://example.com/essay`, can be offered inside the form as **unconfirmed** details. They are not saved until the user confirms. Generated context consists of verbatim excerpts from that content, so reusing the original literal cue also reuses its evidence without another AI request. Arbitrary mentions of a person or book are not automatically treated as the note's source. We do not generate speculative source titles, authors, citations or scraped information.

Source edits use an independent optimistic version. Concurrent changes cannot silently overwrite each other. Removing a source clears its fields while retaining the versioned empty row. User ownership and note references are immutable to the mobile client. Note edits and AI regeneration cannot overwrite the source; source-only edits do not change the note's original creation/modification timestamps. Unsaved source drafts participate in the editor's existing leave/discard protection and survive saving the main note.

Confirmed names, URLs and details join the existing derived search index. Keyword ranking and search UI remain unchanged. Exact quoted phrases stay within a single content, added-context, answer or source field; they cannot be manufactured across field boundaries. Removed/edited sources update search transactionally. Unconfirmed suggestions are not indexed as confirmed sources (their original words remain ordinary searchable note content).

## Related-note flow and ranking

1. Only opening a **saved, clean note** requests discovery. The panel is absent for a new note, while the note input is focused, and while note/context/source changes are unsaved. Nothing runs proactively during capture. Original saves remain independent of AI.
2. The existing **AI context** opt-in controls this processing. Its explanation now discloses bounded comparisons of saved notes, their added context and confirmed sources. Disabling AI stops future discovery and invalidates its results. Source attribution and ordinary search work with AI disabled. Historical collections are not bulk-processed.
3. The authenticated `related-notes` Edge Function verifies the real bearer token and derives ownership; it never trusts a client-provided owner. A service-only claim serializes concurrent requests, waits for pending contextual enrichment, and reuses a completed result for up to 24 hours when the collection is unchanged.
4. The existing efficient `gpt-6-luna` model generates up to 12 specific retrieval terms/close synonyms from an origin excerpt and its existing contextual information. These are internal query aids, never new facts or tags shown to users. PostgreSQL turns normalized English lexemes into a safely constructed OR query over the existing indexed note content and validated/user context, including confirmed sources. Rank uses `ts_rank` with the existing title/body/context weights and deterministic ID tie breaking; note age does not exclude older ideas. At most **16** candidates belonging to the same user are retrieved; the origin is excluded.
5. A second strict JSON model response evaluates those bounded candidates by actual meaning, not shared generic topics, names or source titles alone. It returns zero to three strong connections (score at least 85) and one short explanation per connection, with verbatim evidence from both original notes. Score is a selection heuristic, not a calibrated probability. Duplicate IDs, unknown IDs, self links, identical-content duplicates, fabricated quotes, excessive fields and weak scores fail validation. Evidence preserves uncertainty and reported speakers. The model treats all note/context/source content as untrusted data, not instructions. Semantic correctness of free-text explanations still depends on the model; quote validation alone does not prove a paraphrase is correct.
6. Validated links are persisted separately from original notes. Reading uses owner-protected RPC/RLS and the existing note route. No qualifying connections means no section. Loading/failure/retry text remains secondary; users can keep writing and saving.

**Why no embeddings:** a raw keyword/phrase-only candidate pass initially missed the differently worded focused-work pair in the evaluation. Allowing individual expanded lexemes for candidate recall, followed by strict semantic evaluation, retrieved the meaningful pair without a vector column, embedding backfill or another service. The eight representative cases below passed. This is sufficient evidence for this bounded V1 approach, not a claim that every conceptual relationship can be retrieved. Broader evaluation can revisit pgvector if recall later proves inadequate.

## Reliability, privacy and cost

- `note_relations` holds generated explanations and evidence with origin/target foreign keys. Composite owner foreign keys prevent cross-user relationships even for a malformed privileged write. Clients have read access only, protected by RLS; they cannot forge relationships or analysis state.
- `related_note_runs` holds state, lease token, collection revision and completion time. `private.related_library` holds an owner revision and hourly budget, with no client access. Private triggers and service functions have no PUBLIC/anon/authenticated execution grants. Public read RPC is SECURITY INVOKER.
- Material content, generated/user context, source or consent changes invalidate cached runs transactionally. Changed/deleted notes immediately lose their relationship rows; invalidated runs hide other cached rows until refreshed. Finishing work checks the original lease, collection revision and current consent under the same owner lock. Delayed responses cannot restore stale results. Deletion cascades, including account deletion, were tested.
- Initial implementation deliberately invalidates discovery caches for the owner on any material collection change. This is conservative and can cause another analysis when a different saved note is next opened. It avoids maintaining a more elaborate dependency index. It never processes the whole collection with AI or triggers discovery automatically on save.
- At most 12 new analyses per user/hour, a two-minute processing lease, 30-second failed-retry cooldown, 24-hour unchanged-cache lifetime, bounded polling and timeouts limit repeated work. Concurrent identical requests share one lease; empty results are cached too. Database persistence can retry without repeating a paid model call.
- API failures, refusals, malformed responses and timeouts fail closed. No speculative fallback connections are displayed. A failed analysis does not alter, block or prevent retrieval/editing of the original note. Retry is optional.
- Original input is bounded to 8,000 characters plus 2,000 context characters; candidates to 3,000 content characters plus 1,000 context characters each, plus the bounded source fields. Very long notes can therefore miss connections outside these excerpts. English stemming/expansion is strongest for English; multilingual accuracy is not established.
- AI credentials remain Supabase server secrets. OpenAI requests use `store:false`. No note contents, sources, prompts, model responses, headers or tokens are written to diagnostic logs. This does not claim that `store:false` changes OpenAI's separate abuse-monitoring retention policy. No GPS, contacts, device metadata, web scraping, external search, new background service or notification changes were introduced.

## Database and deployment

Applied to the connected Twinkle V1 project (`lvrmixdkkdrtssdtggnw`):

- `20261026004831_add_sources_and_related_notes.sql`: optional source table/version trigger, related run/link tables, internal revision/budget state, RLS/grants, owner-safe foreign keys, candidate/claim/finish/read functions, invalidation triggers and source-compatible search refresh/phrases. Backfills empty source rows and the derived search index only; it does not modify note content or run AI.
- `20261026005150_harden_related_processing.sql`: wait for pending context, safe auth-user cascades.
- `20261026005411_improve_related_candidate_recall.sql`: expanded lexeme OR retrieval followed by semantic validation.
- `20261026005905_index_source_and_relation_ownership.sql`: covering composite owner foreign-key indexes, alongside owner and target indexes. Reuses existing GIN search indexes.

`related-notes` is deployed. Its gateway `verify_jwt=false` matches the existing functions; **internal `auth.getUser` authentication and owner checks are mandatory**, not an anonymous endpoint. Claim/input/candidate/finish RPCs are service-role only. Keep the shared related AI/contract/context-contract files with the function deployment. For another project apply all migrations in order, deploy the function and regenerate `src/lib/database.types.ts`.

No new mobile environment variables, dependencies, native permissions, FCM settings or EAS build are required. Existing `EXPO_PUBLIC_SUPABASE_URL` and publishable key stay as configured. Existing server-only `OPENAI_API_KEY` is reused. Optional server secret `OPENAI_RELATED_MODEL` overrides the related-note model; otherwise it uses `OPENAI_CONTEXT_MODEL` or `gpt-6-luna`. Do not put either an OpenAI key or Supabase service-role key in Expo variables or the repository.

## Verification performed

- Lint and TypeScript checks pass. Default automated suite: **54 passed, 5 existing opt-in integration tests skipped**. New contract/repository tests cover source validation, dangerous URLs, exact suggestions, optimistic conflicts, exclusion of immutable saved-row fields from source edits, bounded/grounded structured model results, speculation, wrong IDs, duplicate/self links, provider failure/refusal and empty-candidate cost avoidance.
- Live authenticated synthetic evaluation: **8/8 cases passed** across an 18-note fixture collection. It also checked separate-session persistence, source CAS, foreign/anonymous denial, cached results, original content preservation and edit invalidation. The photo/audio cases use representative **already-transcribed text**, not a fresh camera/microphone session.
- A follow-up live decision case passed after removing internal “origin/candidate” vocabulary from the wording instructions. Its explanation preserved the undecided state and the other note's plan to finish a portfolio project.
- Rollback SQL suites passed for existing notes, contextual retention, recall and search, plus the new source/related security suite. New checks include owner isolation, service-RPC denial, source/search persistence/removal, dangerous URLs, timestamps, independent versions, composite cross-owner foreign keys, stale/wrong leases, cached claims, AI opt-out, pending-context wait, failure/cooldown without blocking note edits, and note/account cascades. No push notification test was sent.
- A synthetic **1,000-note** candidate-retrieval benchmark passed the two-second guard at about **14 ms** for a 16-candidate result on this hosted database. This measures database retrieval, not AI latency or production-scale throughput. Live related discovery took about **2–6 seconds** for these short fixtures. Actual latency/cost varies.
- Android and iOS production bundles exported successfully. Existing native dependencies and capture code are preserved; no new native build is needed for these JavaScript/UI changes. Physical Android UI interactions, hardware Back, keyboard layout and new camera/microphone recordings are not established by those exports; follow the device checks below.
- Security advisors show no new exposed security-definer RPC or RLS-disabled table. The new private revision/budget table intentionally has RLS with no client policy. Existing recall-definer warnings and the existing Auth leaked-password-protection setting remain unchanged. Composite FK indexes address the new performance advisories.

### Representative evaluation

| Origin | Useful result | Suppression / accuracy check |
|---|---|---|
| Creativity and showing up | Creative practice; discipline | No shopping/health/instruction-injection links |
| Quiet first hour without messages | Protected deep-work block | Different wording, specific uninterrupted-thinking connection |
| Priya conversation about Atlas checkout | Checkout reliability over extra features | A different conversation/person-name match alone is insufficient |
| Undecided Northstar internship | Portfolio preparation before applying | No claim of applying, acceptance or an outcome |
| Buy milk tomorrow | None | Another grocery reminder does not force a connection |
| “That thing we discussed” | None | No invented missing situation |
| Book/photo-transcribed creative routine | Regular writing / consistent creativity | Shared book title alone rejected |
| Audio-transcribed daily writing | Piano practice / creativity / studio routine | Explanation stays grounded in habitual creative practice |

Repeat with two empty disposable confirmed accounts in a private JSON file outside the repository (`[{"id":"…","email":"…","password":"…"}, …]`). The script makes billed calls, creates only synthetic notes, writes a synthetic report, removes its notes and globally signs out its test sessions. Delete test accounts and the private credential file afterwards. Never run against real user collections.

```sh
TWINKLE_TEST_FIXTURES=/absolute/private/test-users.json \
TWINKLE_EVAL_REPORT=/absolute/output/related-report.json \
node --env-file=.env.local scripts/evaluate-related.mjs
```

Fixtures and rubrics are in `tests/fixtures/related-evaluation.json`. The new rollback suites are `supabase/tests/source_related_security.sql` and `supabase/tests/related_performance.sql`. Model outputs vary; review explanations against both originals, not only the scripted expected IDs.

## Android testing

1. Save drafts and reload the existing Twinkle development app. Sign in and open a saved text note. Tap **Add a source**, choose Book and add a distinctive name and optional details/link. Save source. Reopen after a full app restart; confirm persistence.
2. Search by that source name. Open the result, edit/remove the source and repeat search. Attribution must stay independent of original words and added context. Try the same with an existing photo note and audio note.
3. Save a note beginning `Book: The Creative Practice`. Reopen, tap **Add a source** and inspect the unconfirmed detail. Nothing becomes a confirmed source until **Use this detail → Save source**. A vague “that book” should not invent a title.
4. Enable **AI context** on Home if desired, reading its updated explanation. Save “Creativity doesn't always come from inspiration. Sometimes it comes from showing up consistently.” and a second note about discipline being the foundation of creative work. Open either saved note, dismiss the keyboard if needed, and allow context/discovery to finish. **Related Thoughts** should offer a meaningful explanation and open the correct original.
5. Check an everyday reminder and a vague note: no forced connection should appear. A shared person/book with an unrelated subject should be suppressed. Your library determines the exact results; not every note gets a connection.
6. Edit the meaning of one related note, save and reopen. Old links should disappear until valid new analysis finishes. Delete a note and check that it cannot be opened through related results. Test returning from a related note with Android Back.
7. Try an unavailable network: source/discovery failures should offer a retry without destroying your draft or blocking ordinary note reading. Save a source draft and main-note edit in both orders; unsaved changes should remain protected.
8. Disable AI context. Confirm new related analyses stop while note capture, source editing and ordinary search remain usable. Sign in as another user and verify private attribution/connections are inaccessible.

The FR-14/15 phase did not add capture resurfacing. The later [FR-16/17 implementation](DISCOVERY.md) reuses this detector; embeddings, themes, clustering, import, knowledge graphs, analytics and new notification types remain out of scope.

## Official documentation checked

- [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/), [Expo Router](https://docs.expo.dev/versions/v58.0.0/sdk/router/), [Expo Linking](https://docs.expo.dev/versions/v58.0.0/sdk/linking/)
- [Supabase full-text search and ranking](https://supabase.com/docs/guides/database/full-text-search), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [background Edge tasks](https://supabase.com/docs/guides/functions/background-tasks)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
