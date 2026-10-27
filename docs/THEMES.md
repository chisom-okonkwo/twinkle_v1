# Themes and shared ideas (FR-19/20)

Twinkle privately prepares saved notes for semantic comparison, retrieves a few neighbours, checks coherent groups, and saves only supported memberships. The existing **Discover thoughts → Themes in your notes** screen keeps All time / Past 90 days, original-note links, editable names and dismissal. Capture, keyword search, imports, media, contextual enrichment and push delivery keep their existing flows. The later [FR-21/22 reflection experience](REFLECTIONS.md) reuses these groups and dates.

## Representation and reuse

`private.note_embeddings` stores one `text-embedding-3-small` vector (1,536 dimensions) per note/model/input version. Input v1 is a whitespace-normalized JSON document containing the **original title and body**, user-added context/answer, and confirmed source type/name/URL/description. It does not rewrite saved content or embed operational dates, ownership or generated emotional interpretations. Text from every capture method and Keep/text imports uses the same path; generated context is not a prerequisite.

The input fingerprint includes the model, dimensions and representation version. Material title/body/included-context/source edits invalidate only affected representations and dependent relationships/jobs/memberships. Date changes, theme renaming, reopening and date filters reuse vectors. Compare-and-set input hashes and processing tokens reject delayed results after newer edits, deletion, exclusions or consent changes. A paid result is retried for persistence without another provider call; verified group output is cached before membership writes.

The observed private collection contained 28 short notes (median title/body 208 characters, maximum 751). Passage embeddings are not justified. This version explicitly marks semantic input above **7,000 UTF-8 bytes** unsupported rather than truncating it; original notes remain readable and searchable. This conservative byte bound stays below the embedding model's 8,192-token input limit even for non-English text. It is a current limitation for long notes, not a note-storage limit.

## Retrieval and coherent groups

Exact owner-scoped pgvector cosine retrieval runs **after materializing the user's eligible, current, compatible vectors**. It returns at most 12 neighbours (24 hard RPC maximum), never another user's vectors. At 1,000 synthetic vectors, latest exact retrieval took 1.19 seconds, so no approximate index was added.

`private.semantic_relations` stores canonical pairs, both input hashes, model/version and cosine similarity. FR-15 can use these as additional bounded candidates alongside its existing retrieval. Its original 85–100 validation scores and explanations remain separate; cosine is neither that score nor a probability. English-centric privacy/exclusion rules still apply.

Calibration retrieved all five expected positive pairs in the first four neighbours. Positives ranged 0.550–0.839; misleading lexical negatives ranged 0.323–0.488, and a fictional dream was 0.619. Accordingly, **0.42 is only a candidate floor**, with a **0.30 pairwise floor** and a 0.42 average connection requirement as notes are added to an anchor's group. A strong FR-15 verified connection can also supply evidence. Weak connected chains do not become a group just because A connects to B and B to C. These are evaluated heuristics, not universal confidence levels.

The planner examines up to eight outstanding anchors per pass, removes duplicate/subset candidate cores, and bundles at most four cores / 24 notes. It allows broad subjects and independently useful narrower groups, overlaps and ungrouped notes. Notes are not assigned to folders or a fixed taxonomy.

## Selective model checks

The existing Responses integration uses the efficient configured theme model (`OPENAI_THEME_MODEL`, then existing related/context model overrides, default `gpt-6-luna`), strict JSON and `store:false`. It receives actual original/user-provided text, never vector numbers. All fields, sources and known labels are untrusted data.

1. A bounded request proposes up to six groups with understandable labels and exact evidence for every member. Closed-set short note references reduce copying mistakes. The JSON schema restricts each group's members to a single coherent candidate core; local checks repeat that constraint.
2. Only when groups are proposed, a separate structured check evaluates **every** proposed membership against its subject. It rejects invented applications, generic skill advice attached to business without business context, fictional/quoted events misattributed to the user and unsupported dream interpretation. Unsupported members are removed; fewer than two remaining notes suppress the group.
3. Server validation rechecks owned note IDs, original-field evidence, current fingerprints, consent, scope, distinct notes/content and dismissals. Model responses never supply numerical counts, recurrence claims or trends.

Known generated identities/meaning are reused. A new or broader supported subject can become a new group. Near-identical memberships (>0.85 Jaccard) merge; proper narrower subsets remain distinct. User names remain separate from generated names. Dismissal evidence suppresses synonymous recreation with substantial overlap (>=0.75 Jaccard, at least two shared notes). This is conservative feedback preservation, not a learned personalization model. Significantly changed membership or a genuinely different subject may not be recognized as an old dismissal.

Model/provider/incomplete/refusal/output-validation errors remain retryable failures, never successful empty output. Safe diagnostics distinguish retrieved candidates, rejected coherence links, no qualifying candidates, AI-empty output, independent verification rejection, invalid output and persistence suppression. No raw private note, title, response, vector, secret or generated label is logged.

## Dates and recurrence

A coherent **group** needs two distinct supported notes. A **recurring theme** needs at least three reliably dated distinct notes across at least two local capture dates. A pair is useful without being called a recurring pattern. Counts and month buckets come from database records, never model estimates.

- Ordinary notes use their stored capture date.
- Imports use a supplied original date only when provenance marks it reliable (`date_basis=file`). Unknown original dates remain null for theme chronology, appear separately in All time, and are excluded from date-bounded scopes. Their import time never establishes recurrence.
- Recent means the user's current local calendar date plus the previous 89 local dates, ending at next local midnight. Stored recall-preference IANA time zone is reused, with UTC fallback. DST follows PostgreSQL time-zone rules.
- Internal custom scopes use explicit instants and a validated zone, with **start-inclusive/end-exclusive** boundaries. No new date picker is exposed. Scope fingerprints use epoch instants, so database session time zones do not change identity.
- Filtering already verified memberships is read-only. **Find/Continue** can independently discover scoped patterns from stored vectors; merely opening or changing the period does not request AI. Theme identities and feedback are shared across scopes.

Scopes are bounded to 32 per user. Non-all scopes older than seven days are eligible for cleanup when the limit is reached; uncommon custom-scope-heavy use may reach the limit and needs maintenance. No weekly recap, trend analysis or notification campaign was added.

## Durable processing, consent and budgets

Successful normal note saves enqueue derived work through database state; no mobile promise is required. Existing AI consent is respected. **Find themes** explicitly includes older/imported notes. New imports remain deferred until that choice, and import success is independent of AI. **Include older and imported notes** processes later deferred imports when the user chooses it.

`semantic_runs` leases an owner for two minutes. Each worker pass has a 90-second deadline, an embedding batch <=32, up to eight relationship refreshes and eight candidate anchors, and bounded validation jobs. Already planned work runs before further scans so slower retrieval cannot starve it. Scope work flags persist continuation, failures and due times. A throttled post-save `pg_net` wake and the **twinkle-semantic-backlog** minute Cron job invoke `semantic-worker`; it processes at most four owners concurrently, prioritizing the oldest due owner to avoid starvation. It skips empty backlog and uses a separate 256-bit Vault secret. It does not send notifications or alter recall scheduling.

Per owner/hour limits are **512 embedding-note attempts** and **24 reserved generative requests** (two reserved per proposed-group validation job; cached jobs need none). Actual request attempts and observed token usage are metered separately. Token counts are unavailable for requests that fail before a provider usage response; zero recorded tokens in those cases is not a guarantee of zero provider billing. Budget-paused work remains durable and resumes in the next hour. Failed embeddings retry with backoff up to five attempts; validation jobs up to three, and failed worker passes back off. The UI exposes Retry for exhausted/failed work. Interrupted leases can be reclaimed. Turning AI off purges derived vectors/memberships, cancels work and preserves user theme feedback.

At the [published standard rates](https://openai.com/api/pricing/), embeddings cost $0.02 per million input tokens; `gpt-6-luna` is $0.10 input / $0.50 output per million. Costs depend on note size, candidate overlap, retries and configured model. The independent membership check adds a request only for proposed groups. Reopening, renaming and unchanged repeats require no paid processing.

## Storage, migrations and deployment

Applied migration history preserves the initial theme tables, then adds the semantic foundation, neighbour integration, scoped validation jobs, versioning/diagnostics, independent membership verification, reliable time views and durable backlog. Follow-up repair migrations retain the fixes found during sequential gates. `retire_legacy_theme_engine` removes old processing RPCs and `theme_checked`; old generated memberships are invalidated while theme IDs, user labels and dismissals survive.

Private tables: `note_embeddings`, `semantic_relations`, `semantic_runs`, `semantic_usage`, `semantic_scopes`, `semantic_scope_notes`, `semantic_group_jobs`, `semantic_theme_feedback`. They have RLS enabled, no client policies and revoked client privileges. Composite owner foreign keys protect links. Public theme reads are owner-free RPCs whose private helpers derive `auth.uid()`; only label/dismissal updates are allowed directly. Vectors are absent from ordinary note payloads and public generated table types. Owner/model/status, canonical pair, job, membership and due-work indexes support bounded queries.

Deploy `note-themes`, `semantic-notes` (same authenticated handler, useful for the evaluation harness) and `semantic-worker`. They perform their own authentication with gateway JWT verification disabled: user endpoints validate the Bearer session; the worker validates its distinct Vault secret via a service-only RPC. All processing RPCs are service-only. Existing server `OPENAI_API_KEY` and Supabase service credentials are reused. No private credential is added to Expo; no new native package or Android build is required.

The migration creates `twinkle_semantic_worker` in Vault and the backlog Cron job. It reuses only the existing private project URL configured for Edge Functions, leaving the recall scheduler/secret unchanged. On a fresh environment, that URL must be configured just as documented in RECALL.md. Run hosted SQL suites after applying migrations. The security advisor's default-deny private-table INFO notices are intentional; three existing recall SECURITY DEFINER warnings and leaked-password-protection warning predate this work.

## Evidence and evaluation

See [phase gates](evaluations/semantic-theme-phases.md), the [24-note fixture](../tests/fixtures/semantic-themes-evaluation.json), and synthetic baseline/group/neighbour/scope reports in `docs/evaluations/`. The rubric accepts reasonable labels, explicitly forbids nonmembers and distinguishes the broad dream family from its narrower subset. The same notes improved from **2/4** expected families to **4/4**, with broad/narrow overlap and no unsupported final memberships. One short first-customer note was missed by the narrower established business group. An unchanged replay added zero provider calls. The old validator remains only under `tests/legacy` for baseline regression; there is one production engine.

The real 28-note collection completed with 26 evaluated, two conservatively excluded and three groups, compared with zero previously stored. An unchanged repeat added no provider calls. Full background completion took 8.7 minutes including retries and reliability fixes during evaluation; provider processing totaled about 55.5 seconds. This run used 1,966 embedding input tokens and 40,854 generative input / 5,657 output tokens across 16 generative requests, including retries. [Aggregate report](evaluations/semantic-private-aggregate-2026-10-27.json). Real-note operational results are reported as aggregates only. Actual labels/text never enter committed fixtures or reports. Synthetic quality and exact-quote checks do not prove every real theme is useful: user review of supporting notes is the final qualitative check.

Automated coverage includes stale responses, ownership, private processing access, sensitive/excluded content, original date boundaries, DST, distinct counts, two-note groups, disabled consent, cached replay, budgets and durable continuation. Existing notes/title/media/capture/context/recall/search/source/discovery/import SQL suites also pass. Larger fixtures measure exact neighbours, search, related/discovery candidates and imports without bulk model calls. The user confirmed the corrected recent-period explanation and All time navigation on Android. The focused retest does not verify every control or establish general semantic accuracy.

## Android verification

1. Save drafts and reload the installed development app through its working tunnel. No new APK is needed.
2. Open Discover thoughts → Themes in your notes → All time. If offered, choose Find themes / Include older and imported notes. Leave and return during processing; notes should stay usable.
3. Inspect broad and narrower groups. Open several supporting originals. Verify labels describe the notes without inventing emotions, symbols or outcomes.
4. Switch Past 90 days. Original historical dates should govern inclusion; unknown-date imports remain All time only. Changing periods reads cached results until you explicitly request discovery for that period.
5. Rename a group, dismiss another, and reopen. Edit one original note or title; stale memberships should disappear until updated. Names/dismissals must survive refresh.
6. Import another file: import should finish immediately with no bulk AI. Include imported notes explicitly when desired.
7. Check text/photo/audio capture, attachments, search and ordinary discovery. Turning AI off must leave these notes accessible. Do not expect a new notification from theme discovery.

## Limits

Heuristics and the efficient model can miss legitimate connections or choose an imperfect label; inspect, rename or dismiss suggestions. Retrieval is bounded, so "evaluated" does not mean every possible theme was exhaustively compared. The current short-note representation rejects long input above the stated byte limit. Existing English sensitivity/prompt-injection rules can suppress an innocent note (for example a literal sensitive word in a dream or fiction); they were not weakened to inflate results. Labels can be nondeterministic on genuinely changed inputs, though unchanged results are cached. Exact scans become slower with larger collections; approximate indexing should follow measured need. Initial background backfills may take several passes or cross an hourly budget. None of these failures blocks saving, imports or retrieval.

Official references: [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Supabase pgvector](https://supabase.com/docs/guides/database/extensions/pgvector), [scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions), [background tasks](https://supabase.com/docs/guides/functions/background-tasks), [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/).

## 90-day view follow-up — 2026-10-27

The real collection's recent scope completed normally with eight available notes checked and no verified group. Ten processed imports had unknown original dates and eight dated notes were outside the window; two additional notes were excluded by existing sensitivity rules. Each saved all-time group had fewer than two recent supporting notes, so showing those as recent groups would have inflated the evidence. Original dates, saved content and group thresholds were preserved.

The snapshot now returns owner-only `date_coverage` counts and `all_time_group_count`. Date coverage uses the current compatible semantic index states; excluded notes and historical imports still deferred for consent are omitted. The existing waiting/deferred counters describe those imports separately. A completed recent empty state explains the original-date rule and offers **View all-time themes** when saved groups exist. Hidden-group diagnostics now count partial groups below the visible two-note threshold, rather than pretending that one visible member is a displayed group.

The theme screen previously stopped observing after about 150 seconds. It now observes scheduled work for up to ten minutes with slower read-only polling, including scheduled retries and budget pauses. It stops observing in the background and refreshes when the app becomes active again. Opening, returning, polling and switching periods do not start AI. Server-owned post-save processing continues independently of the screen. Existing initial/historical consent and import deferral remain in force. Custom time-frame controls remain a future UI step; internal half-open scoped processing is unchanged.

The 1,000-note regression exposed a separate progress-query problem: poor planner estimates after fresh imports could repeatedly scan an owner's notes and evaluate date functions inside the join. Capture dates are now materialized once and embedding/coverage lookups are bounded by their primary keys. The recent snapshot measured **509 ms** on the synthetic fixture, compared with approximately eight seconds in the failing profile. This changes query execution, not note eligibility, evidence or chronology.

Verification: the new hosted `semantic_recent_view_security.sql` suite verifies that two genuinely dated supporting notes display and open, one-member partial groups stay hidden, older/unknown dates do not inflate counts, date edits update the view without re-embedding, and another owner sees no groups or date coverage. Existing group, scope and background suites also passed. Three focused presentation/polling tests passed; lint, TypeScript, 121 automated tests (five optional integrations skipped) and Android/iOS exports passed. The user confirmed on Android that the explanation and All time button work. No provider requests were added for this fix; synthetic database fixtures were rolled back.

References: [React Native AppState](https://reactnative.dev/docs/next/appstate), [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/).
