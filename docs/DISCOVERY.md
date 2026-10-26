# FR-16 and FR-17 — Capture connections and intentional discovery

Implemented October 25, 2026, using the Phase 2 Functional Requirements Specification as the authoritative functional reference, alongside the V1 technical reference and existing calm UI. FR-13 search and FR-15 relationships already existed and are reused. No `PROGRESS.md` exists; this guide records completion, verification and limitations. No FR-18 or later capability is included.

## Capture connections (FR-16)

The existing editor saves the original note first, through the same path for text, photo and audio. It then announces only the saved note's identifier and version to a small, user-scoped React provider. The editor returns normally; there is no wait for enrichment, no per-keystroke relationship lookup, and no modal or mandatory action.

Back on Notes Home, a subtle section may show **“You’ve explored something similar before”**, with at most two related notes, their dates, short explanations and links. It uses the same `RelatedNotesPanel`, `related-notes` Edge Function, cached results, model, relevance threshold and evidence validation as FR-15. Pending context is allowed to finish first. There is no new detector or model. Expensive work remains behind the existing AI context opt-in and its existing hourly budget. Updated wording discloses post-save comparisons.

The passive suggestion filter requires ownership, an existing valid relationship and a target captured before the origin's latest save. It suppresses excluded/sensitive notes, recently discovered or flashed-back notes, and persistently dismissed pairs. A failed/empty lookup displays no capture suggestion; the original note stays saved and can be opened normally. The saved-note editor retains its ordinary related-thoughts loading/error/retry UI.

**Not now** persists a canonical pair dismissal: A→B and B→A represent the same dismissed connection. Dismissals are independent of generated relationships, survive reprocessing and sessions, and cascade when either note is deleted. Candidate retrieval excludes dismissed pairs before paid relevance evaluation. This is simple feedback, not a manual relationship-management interface.

Capture suggestions are tied to the latest save for ten minutes in the current signed-in app session. Their identifiers reset on sign-out/account change. A full app restart does not restore this transient Home event; original notes, relationships and feedback remain in Supabase. Relationship processing starts/resumes when Home is visible, rather than introducing a mobile background worker.

## Intentional discovery (FR-17)

Notes Home has one **Discover thoughts** entry point. The protected discovery screen offers:

- **Surprise me:** Rediscover actual saved thoughts without a search query.
- **Explore this topic:** Enter an optional topic, source name or other remembered context. This reuses FR-13 PostgreSQL keyword/phrase/prefix search and its existing ranking; it is not a new semantic search engine.

Each result shows actual original text, its creation date/capture method and **Open original note**. **Another thought** continues the round. **Not for me** records negative feedback and moves on. No AI-generated memory or summary replaces the original. Discovery itself makes **no OpenAI calls** and works when AI enrichment or push notifications are off.

### Surprise selection and small collections

The existing `rankRecallNotes` function now has an explicit discovery mode. Flashback defaults remain unchanged: seven-day age/edit minimum, original length thresholds and score threshold. Discovery reuses its grounding checks, sensitivity guard and meaningfulness signals: specific situation, intentions, open questions, concerns, details, voluntarily added context, and note age. A sufficiently detailed original reflection can also be useful without AI-generated metadata.

Discovery uses a gentler initial floor: at least 40 characters and six whitespace-delimited words; a validated situation or user context supports shorter thoughts, while plain originals need at least 60 characters and ten words plus an intact useful clause. Unsupported/malformed generated context is rejected, not made into a memory. Simple reminders such as “Buy milk tomorrow” still fail the usefulness floor.

Selection favors:

1. Meaningful older thoughts that have not been seen recently (at least a day old and not edited in the past day).
2. Meaningful newer thoughts when the older pool is insufficient.
3. Meaningful recently seen thoughts as a fallback for a small collection.

Within each tier, shared recall scoring and a small stable session-based tie variation provide relevance and variety. Recent views are a lower priority, **not a blanket seven-day ban** on intentional rediscovery. This was refined after Android feedback: a collection of eight notes was easily exhausted by the initial age, length and week-long viewing filters.

A round never repeats a note, across both discovery modes. Once it is exhausted, **Start another round** lets the user explicitly revisit available thoughts in a new round. This keeps the interaction useful without silently looping the same cards. Excluded notes, sensitive notes, recent explicit negative feedback and deleted/inaccessible notes remain protected. An empty collection, all-excluded collection or collection with insufficient substantive content can still produce no result; the app does not invent something to fill the space.

### Topic selection

The Edge Function runs `search_notes` as the actual authenticated user through a JWT-scoped client, preserving SECURITY INVOKER/RLS and the existing title/body/context/source ranking. It reserves the first available result in rank order. It checks at most four pages of 31 matches (124 results), so it does not download an entire collection or make AI requests while typing. Ordinary search behavior is unchanged and remains available separately, including direct access to the user's excluded notes when explicitly searched.

## History, ownership and reliability

Two necessary feedback/history tables were added:

- `related_note_dismissals`: canonical note pair, owner and dismissal time. Composite owner foreign keys prevent cross-user pairs. Owner RLS and the invoker `dismiss_note_connection` RPC protect writes.
- `note_discovery_history`: request ID, owner, round/session ID, note ID and modification version, mode (`surprise`, `topic`, `capture`), shown time and negative feedback. It stores no duplicate note content, source text or AI output. Unique owner/session/note and request keys prevent repeats and make lost-response retries idempotent. Clients can read their own history and update only `dismissed`; selection/history insertion is server-only.

Discovery reservations use a short per-owner transaction lock. Concurrent identical requests return the same thought and one history event. Candidate ownership and note/context versions are checked again before returning a result. Reopening a changed, deleted, excluded or dismissed result does not revive its old card. Both tables cascade with notes/accounts. All new client-callable RPCs are SECURITY INVOKER; internal retrieval/reservation/recording functions have service-role-only grants.

Passive capture suggestions avoid notes seen on another surface within seven days. Capture impressions are recorded after the card loads, without holding up saves. This acknowledgement is best effort on network failure; pair dismissals use a confirmed persisted write. A capture card can remain visible for its own latest-save event rather than hiding immediately after its own acknowledgement.

“Not for me” suppresses a discovery note for 30 days. Topic exploration also suppresses ordinary views from the past day. Surprise mode instead deprioritizes ordinary recent views, while always excluding notes already seen in the current round. A recent flashback is excluded from discovery/capture for seven days; explicit flashback exclusions apply to both new experiences. The existing note exclusion control now explains this shared behavior.

Recent discovery/capture views are also consulted by recall scan/reservation. Existing recall invalidation retires a prepared flashback and cancels a retry when the thought is seen elsewhere. Cron, delivery frequency, quiet hours, notification permissions/channels and push wording are unchanged. An already dispatched OS notification cannot be retracted by these database checks. No push test or new notification campaign was sent for this phase.

The shared sensitivity safeguard is conservative and English-based. It checks original content, user-added context and confirmed source details, and suppresses sensitive subjects rather than interpreting them. Database/JavaScript parity tests cover representative terms and substring false positives. This is not a complete multilingual sensitivity classifier; users' explicit exclusions remain important.

## Deployment and configuration

Applied to the connected Twinkle V1 project (`lvrmixdkkdrtssdtggnw`):

- `20261026020919_add_capture_resurfacing_and_discovery.sql`: feedback/history tables, RLS/grants/indexes, common eligibility, filtered related reads, discovery retrieval/card/reservation RPCs.
- `20261026021309_record_capture_rediscovery_history.sql`: shared capture-view history and service-only acknowledgement.
- `20261026022007_harden_capture_relationship_reuse.sql`: compare against the origin's latest save, and skip dismissed candidate pairs before AI evaluation.
- `20261026022500_share_discovery_history_with_recall.sql`: recent-view suppression in recall selection/reservation, sharing the short owner selection lock. Does not change delivery schedules.
- `20261026022631_invalidate_flashbacks_after_rediscovery.sql`: reuse existing recall invalidation for an already-prepared flashback/retry.
- `20261026023041_broaden_intentional_discovery_fallbacks.sql`: bounded paged candidates, gentler recency fallback and persistent in-round uniqueness.

The authenticated **`discover-notes`** Edge Function is deployed, including capture-view acknowledgement. Its gateway setting matches the existing functions (`verify_jwt=false`), but the body verifies every real bearer token through `auth.getUser` and derives ownership. It is not an anonymous data endpoint. Internal SQL functions remain service-only. Notes/query text, tokens, model output and credentials are not logged.

No new mobile variables, packages, native permissions, EAS/FCM configuration or native build are required. Existing public Supabase URL/publishable key remain as configured. Supabase injects its server URL, service-role key and anon key into the Edge runtime; the latter is used with the user's bearer token for existing RLS search. FR-16 reuses the existing server-side OpenAI configuration; FR-17 does not need an OpenAI key. For another project, apply all migrations in order, deploy `discover-notes` with its shared files and regenerate the database types. Privileged credentials never belong in Expo variables or commits.

## Verification completed

- Lint and TypeScript checks passed. Local suite: **67 tests passed, five existing opt-in integration tests skipped**. New checks cover shared scoring/default preservation, specific short context, sensitive/simple/injected-note suppression, older/newer/recent-view priorities, request bounds, owner-free POST requests, malformed/server-error handling, owner-scoped feedback and reuse of related-note reads/dismissals.
- Live authenticated synthetic checks passed: source-based topic lookup, owner/anonymous denial, separate-client persistence/replay, nonblocking original save (about **125 ms**), post-save context/related processing (about **11 seconds** separately), grounded older connection, capture-view recording, persistent dismissal, unchanged paid-result cache, surprise selection/exhaustion, edit invalidation, unchanged old original content and no-match state.
- The final fallback behavior was additionally tested live without AI: an older unseen thought was selected first, a newly saved meaningful thought next, then an empty result without an in-round repeat; a new round could intentionally revisit a recently seen safe thought. Concurrent identical discovery requests returned one card and one history event.
- New rollback SQL suites passed for discovery security and a **1,000-note** benchmark. Final broader candidate retrieval returned 100 candidates in about **446 ms** on this hosted database, within a two-second guard. This measures retrieval only; network latency and model processing for FR-16 are separate. Up to five bounded 100-note batches may be considered to avoid an empty result caused by an unhelpful first batch.
- Existing notes, contextual retention, recall, search and source/relationship SQL security suites passed. These cover all stored capture methods, original timestamps/content, RLS, stale updates, notification preference enforcement and cascading deletion. New checks include metadata/source sensitivity, reversed-pair deduplication, feedback persistence, service-RPC denial, stale/replayed reservations, shared-history recall suppression and retirement of an already-prepared card. No real user note contents were used for evaluation.
- Android and iOS bundles exported. The user confirmed that the Android discovery/topic/opening flow worked, then identified the conservative empty-state behavior; the broader selection was tested through live APIs and automated checks afterwards. New round-button interaction and native Back behavior after the refinement still warrant a quick device check. New physical camera/microphone captures and actual push delivery were not rerun; their capture/backend paths were preserved.
- Security advisors show no new RLS-disabled table or exposed security-definer RPC. Existing private default-deny tables, recall RPC notices and Auth leaked-password-protection setting are unchanged. Performance advisors show no missing foreign-key indexes.

`supabase/tests/discovery_security.sql` and `discovery_performance.sql` run as database owner and roll back all fixtures. `scripts/evaluate-discovery.mjs` is an explicit live/billed FR-16 evaluation: use only confirmed disposable accounts with `twinkle-discovery-…@example.invalid` addresses in a private JSON file outside the repository. Prepare aged synthetic notes matching the script's creativity/deep-work/writing/reminder/sensitivity/exclusion cases, added context, and one source named `AtelierBlue Creative Practice`; service-side fixture preparation is necessary because the mobile client cannot forge timestamps. Account A needs that collection, account B a separate older creative reflection. Never use real accounts/notes. The script removes only its new note and globally signs out test sessions; remove all fixture accounts/data and the credential file afterwards.

```sh
TWINKLE_TEST_FIXTURES=/absolute/private/test-users.json \
TWINKLE_EVAL_REPORT=/absolute/output/discovery-report.json \
node --env-file=.env.local scripts/evaluate-discovery.mjs
```

## Android checks

1. Save drafts and reload the existing development app. Tap **Discover thoughts**. Try **Surprise me**, open the original, return with Android Back, and ask for **Another thought**. A round should not repeat a note.
2. Exhaust a small round. **Start another round** should let you revisit safe thoughts rather than imposing a week-long blank state. Older unseen thoughts are preferred; newer/recently seen thoughts are fallbacks. A genuinely empty/all-excluded/insubstantial collection may still have nothing to show.
3. Explore a topic or distinctive source name. Open the original. Try a nonexistent topic and check the empty state. Type without submitting: there should be no discovery requests on each keystroke.
4. Use **Not for me**; that note should stay out of new rounds for 30 days. Exclude a note using the existing note control and confirm it disappears from both passive capture suggestions and discovery. Ordinary private search remains available.
5. With AI context enabled, save a new thought related to an existing one, through any capture method. Saving should return promptly. After processing, a small connection may appear on Home; no meaningful match means no section. Open it or use **Not now**. Reopen/reprocess the originating note and verify that dismissed pair stays hidden.
6. Edit a formerly related thought, delete a result, and try another signed-in account. No stale/deleted/cross-user link should become accessible. Turn off AI context: passive AI detection stops, while discovery of eligible saved thoughts, topic search and ordinary capture continue.
7. Try a temporary network failure and retry. The original saved note must remain intact. Returning to a result should revalidate its current access/version; a retried discovery request should not silently consume a different card.

## Limits and scope

There is no guarantee of a result when no safe, substantive, accessible thought exists. Source exclusions, explicit negative feedback, sensitivity guards and round uniqueness take precedence over filling the screen. Surprise examines at most 500 bounded candidates and uses existing metadata/heuristics, not a new semantic model. Topic discovery examines at most 124 ranked matches; an unusually large filtered collection can have useful matches beyond those bounds. Long original notes and the English-centric heuristics can miss useful ideas; no multilingual accuracy claim is made. These are practical V1 limits, not a reason to add embeddings, classifiers or a recommendation engine in this phase.

FR-18 import, themes/clustering, analytics, creative generation, chat assistants, knowledge graphs and new notification types remain out of scope.

Official references checked: [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/), [Router](https://docs.expo.dev/versions/v58.0.0/sdk/router/), [Crypto](https://docs.expo.dev/versions/v58.0.0/sdk/crypto/), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [full-text search](https://supabase.com/docs/guides/database/full-text-search) and the [Supabase changelog](https://supabase.com/changelog).
