# Revisiting thinking (FR-21/22)

The Phase 2 functional specification is authoritative. This implementation follows FR-21/22 and the Lila/Naomi scenarios reproduced in that specification. A separate Twinkle Scenario Spec was not found in the workspace. FR-23 and later are outside this change.

## Experience

Open a saved note → **Revisit this thought**, a flashback → **Reflect on this thought**, or a theme → **Explore these thoughts → Explore across time**. A small optional screen shows comparisons and their original dated excerpts. Nothing interrupts capture, launches a notification, or starts comparison AI merely because a note or theme is opened.

Choose **Explore across time** to prepare a comparison. Possible changes, continuing ideas, and explicitly unresolved questions have separate labels. An empty result is valid: shared subject matter alone does not prove a change in perspective. Supporting notes open in the existing editor.

For a suitable older note, **Consider a question about this thought** can offer one concise question. It can also return no question. Answer in place or choose **Not now** to dismiss. An unsaved answer is protected when leaving or dismissing; if the source changes, the draft remains visible to copy. Saving creates an ordinary private text note and preserves the original unchanged. Open the saved response to edit its title/body or delete it using the existing editor. The response links back to its original thought and question.

## Candidates and reliable chronology

There is no second relationship engine. Candidate IDs come from existing current theme memberships, FR-15 links, compatible cached semantic neighbours, and direct user-authored response links. A theme must be owned and not dismissed. A note comparison must include its originating note. The query bounds candidates to 64, then chooses at most eight dated originals spread across earlier and later moments. No collection-wide model request, new vector, or new embedding model is introduced.

Existing `semantic_captured_at` supplies dates. Ordinary notes use stored creation dates; imports qualify only when existing provenance marks their original dates reliable. Unknown-date imports remain searchable and available in all-time themes but do not establish a timeline. Future dates are excluded. Comparisons require distinct original bodies and at least 14 days between the two dates. The first version does not parse dates mentioned inside prose or expose a custom date picker.

Original title/body, user-added context, confirmed sources and current validated enrichment are reused as evidence. Each candidate's actual body must support its excerpt. Generated context alone cannot establish an event, belief, change, or resolution. Reflective questions receive the same bounded related evidence so they can avoid asking for a decision already recorded in a newer note.

## Generation and grounding

`note-reflection` authenticates the caller with Supabase Auth and claims service-only work. It returns immediately; bounded analysis runs through the existing Edge Function `waitUntil` pattern. The screen polls saved status, pauses in the background, and rereads on focus/foreground. Saving and retrieving normal notes is independent of this process.

The existing Responses helper uses strict JSON schemas, `store:false`, server-side credentials, and the configured efficient text model. Comparisons reference a closed set of temporary note IDs. Runtime validation rejects foreign IDs, reversed/insufficient chronology, duplicate pairs, invented excerpts, identical source bodies, unsupported fields and obvious personal-growth/diagnostic language. A second structured request independently checks every proposed comparison or question. It rejects unsupported classifications, changed speakers, fictional/quoted beliefs, invented outcomes, ambiguous referents and questions already answered by newer evidence. Validated IDs map back to the original owned notes before persistence. No raw notes, answers, model text, or credentials are logged.

This is evidence-based assistance, not proof that a model can never make an interpretive mistake. Original excerpts and dates remain inspectable. No fallback invents a comparison or forces a question after a provider failure.

## Persistence, ownership and consistency

- `private.reflection_runs`: one cached comparison run per owner/scope/target, with input fingerprint, source IDs, claim token, attempts, status and validated comparisons.
- `private.reflective_prompts`: one lifetime question opportunity per original note, including processing, no-question, dismissal, answer and stale states. Generated question/quote are removed after answer, dismissal or invalidation. The offered timestamp is retained for cooldown enforcement.
- `private.reflection_limits`: a small per-owner hourly claim allowance.
- `public.note_reflections`: immutable owner-scoped association between an original note, an ordinary response note, the question and its response creation date. The question is never inserted into the user's authored body.

Private tables have default-deny RLS and no client privileges. Client reads/writes use owner-derived wrappers with narrow private helpers; processing RPCs are service-only. Response links have RLS and composite owner foreign keys to both notes. User responses are normal notes, so existing RLS, search, context, media-compatible editing, semantic processing and deletion apply. Direct response links make their current text available to later comparisons without waiting for new embeddings.

Fingerprinting includes the actual candidate input and reliable dates. Relevant edits invalidate comparisons; a fresh read also recomputes the bounded input fingerprint. Completion verifies both the current input and lease token. Late responses cannot revive results after an edit, deletion, exclusion or consent change. Generated processing never overwrites user answers. Identical response retries return the same note; a changed draft after an already successful save is rejected and retained in the editor instead of silently discarded.

Deleting a response removes its link and dependent comparisons. Deleting the original removes its prompts, association and derived comparisons, while preserving the separately authored response as an ordinary note. The historical generated question/link is then unavailable. This preserves user writing while removing access to the deleted source.

## Optional prompting, privacy and limits

Existing AI consent, semantic sensitivity rules, flashback exclusions, dismissed flashbacks and recent discovery dismissals are respected. Questions require a reliably dated note at least 14 days old. At most one question is offered per user in seven days, with one active generation at a time. Dismissal survives source edits; a dismissed, answered, stale, or no-question opportunity is not regenerated for the same note. Saved answers remain accessible when AI is off. There is no new push campaign or preference.

Six analysis claims per owner/hour bound paid work; each uses at most two provider requests. Cached completed/empty results and concurrent claims do not reserve another request. Failed attempts back off for 30 seconds; up to three attempts can reclaim an expired two-minute lease. A provider error remains a failure, not successful empty output. No new worker, queue or scheduled job is required. Token usage is not separately metered by this feature; limits bound request attempts, not total monetary cost.

## Deployment and configuration

Apply the `note_reflection_and_evolution` migration followed by its ordered qualification, interrupted-lease, related-evidence and retry-text repair migrations. Local filenames match the applied hosted migration versions. They add the four tables, owner/source lookup indexes, source-ID GIN index, read/claim/finish/answer/dismiss functions, and invalidation triggers. Existing note/search/theme schemas remain in place. Public database types are regenerated.

Deploy **note-reflection**, including its relative shared dependencies. It validates Bearer sessions itself; gateway JWT verification is disabled for the existing publishable-key pattern. No scheduler can invoke privileged processing as an ordinary client. The installed deployment is active in `lvrmixdkkdrtssdtggnw`.

Reuse existing server `OPENAI_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Optional server-only `OPENAI_REFLECTION_MODEL` overrides the existing theme/context model fallback, defaulting to `gpt-6-luna`. No new mobile environment variable, permission, dependency or APK is required. Never add privileged credentials to Expo public variables.

## Verification and limitations

The [seven-scenario synthetic report](evaluations/reflection-quality-2026-10-27.json) covers a documented change, continuity, an open decision, insufficient evidence, quoted/ambiguous opinions, sensitive material and reminders. The three positive comparisons used the expected classifications; four negative cases produced no comparison. One optional question was offered, for the open decision. Other positive comparisons did not force questions. A follow-up with an explicitly resolved decision in a newer related note returned no question. Live authenticated API checks verified answer save/retry, unchanged original, new-session persistence, search, edit/delete and comparison invalidation. The report's mostly cached timings are replay measurements, not initial model latency. No actual user notes were used for AI evaluation.

Hosted rollback tests cover ownership, forbidden processing access, reliable/unknown dates, concurrent claims, stale tokens, failure isolation, lease recovery, cooldown, persistent dismissal, consent/exclusion changes, response availability in future comparisons, changed retry drafts and deletion. Nineteen existing/relevant security suites passed, plus the new lifecycle and performance suites. A 1,000-note fixture measured 1.48 seconds for a theme snapshot and 2.91 seconds for a note snapshot, within a five-second guard and an eight-note model bound. Lint, TypeScript, Deno checking, 128 unit/contract tests and Android/iOS Hermes exports pass; five opt-in live integration suites are skipped because they require separate fixtures. The deployed endpoint rejects anonymous requests (401). The security advisor found no new warnings: private default-deny INFO notices are intentional; existing recall-function and leaked-password warnings remain unchanged.

The user accepted the Android implementation for this phase, reporting that most flows work well. They observed sparse results when exploring themes across time and chose to proceed with that recorded limitation. Individual controls were not separately reconfirmed in that report. Initial AI wording can take several seconds and can fail or omit a legitimate comparison/question. Existing English-centric sensitivity rules can overexclude benign writing. Long notes beyond the existing 7,000-byte semantic input bound are excluded from this version's reflection analysis while ordinary storage/search remain available. Candidate selection is bounded and cannot establish every possible relationship. A no-question/stale opportunity does not automatically return after later edits. Replies saved offline are not supported; drafts remain in memory for retry, not across application termination. These limits do not block normal capture.

Known product observation from Android review: theme-based longitudinal exploration often finds few comparisons in the current collection. Collection size may contribute, but it has not been established as the sole cause. Reliable original dates, the 14-day separation, bounded candidate retrieval and conservative evidence checks also determine eligibility. Preserve these safeguards; revisit comparison coverage using a larger representative collection in a separately authorized evaluation. No extra feature or threshold change was made in response to this feedback.

To repeat the live synthetic evaluation, run `node scripts/prepare-reflection-evaluation.mjs`, review/apply its private `/tmp/twinkle-reflection-seed.sql` using owner tools, then run `TWINKLE_REFLECTION_FIXTURES=/tmp/twinkle-reflection-fixtures.json node --env-file=.env.local scripts/evaluate-reflection.mjs`. This intentionally uses paid calls for at most the bounded fixture scenarios. The script signs out its clients; remove those four exact generated accounts with owner tools and delete the private fixture/seed files afterward. The completed run's disposable accounts, notes and credentials were removed. Ordinary unit and rollback SQL suites require no paid provider calls.

## Android checks

1. Save drafts, then reload the installed development app using its current connection.
2. Open a theme with reliably dated supporting notes → Explore these thoughts → Explore across time. Start the comparison, leave/return if desired, and open both supporting notes. Confirm dates, uncertainty and wording match the original evidence.
3. Open a saved note or flashback → Revisit/Reflect on this thought. For a suitable note at least two weeks old, choose Consider a question. It is valid to receive none.
4. Answer a suggested question, save, reopen, edit the new response, and search for a distinctive phrase. Check the original body is unchanged. Delete the response through the usual confirmation.
5. Dismiss a different question if eligible later; reopening must not ask it again. Returning or switching screens should not generate more AI. An unsaved response should warn before discard.
6. Edit/delete a supporting note and reopen the comparison; the old result must disappear. Unknown-date imports, sensitive/excluded notes and disabled AI must not produce a fabricated timeline/question. Previously saved responses stay accessible.
7. Check ordinary text/photo/audio capture, import, search, themes and flashbacks. Notification settings and delivery frequency should be unchanged.

References verified: [Phase 2 specification](../Twinkle%20—%20Phase%202%20Functional%20Requirements%20Specification.md), [V1 reference](../Twinkle%20V1%20—%20Product%20%26%20Technical%20Reference.md), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Supabase Auth in Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/router/), [React Native TextInput](https://reactnative.dev/docs/textinput).
