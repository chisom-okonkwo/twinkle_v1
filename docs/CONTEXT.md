# Context retention — FR-07 / FR-08 / FR-09

Twinkle preserves useful context after a text, photo, or audio note is saved. Enrichment never rewrites the original note. Generated excerpts and user-provided details are stored separately and remain secondary to the writing experience.

## Consent and use

AI context is **off by default**. Open **AI context · Off** on Notes Home to read the explanation and enable it for new notes and future edits. Enabling does not analyze historical notes in bulk. To analyze an older note, explicitly choose **Analyze context** on that note while enrichment is enabled. Disabling future enrichment invalidates pending/in-flight work; already completed context remains available.

Save persists the note first and returns immediately. Opening a saved note shows **A little context**, with a relevant situation excerpt and a collapsed **View generated context** action. Pending/failed analysis never blocks the original note. Refresh/retry actions are available.

An optional question appears inline only when useful. **Add context** opens a small form; **Not now** persists dismissal. At most one question is stored per note, and edits do not replace it with new questions. Answered/dismissed questions do not reappear automatically, and prompts are hidden when the user has supplied their own context. Users can also add context voluntarily, and view, edit, or remove their additions. These actions do not change the original note or its timestamps.

## Processing and grounding

1. A private database trigger creates/invalidates a `note_contexts` row during a note write. It makes no network calls. A content hash ignores ASCII whitespace-only changes; other changes increment a revision and clear stale generated context.
2. The app starts `enrich-note` after saving without awaiting it in the save path. The function validates the session and ownership, atomically claims that content revision, returns `202`, and completes through `EdgeRuntime.waitUntil()`.
3. OpenAI Responses uses **`gpt-6-luna`**, strict JSON Schema, `store: false`, no tools, and `reasoning.effort: none`. Its compatibility was checked in official OpenAI documentation and live requests. The saved note is untrusted user data, separate from system instructions.
4. Context contains selected excerpts for topics, a situation, explicit details, intentions, concerns, open questions, and expressed feelings. Every excerpt must occur in the source, allowing only whitespace normalization. Invented/paraphrased facts are rejected. Short cues retain their surrounding conditional/negative sentence when needed; overlong ambiguous excerpts are omitted. Cues distinguish `explicit` from cautious `interpretation`.
5. Completion compares the revision and a unique processing token and rechecks consent. Delayed results cannot overwrite a newer edit or resurrect deleted context. AI never writes original note content or user additions. A failed persistence attempt is retried separately from the paid model request.

No new queue, cron, scheduling, or worker service is introduced. Undelivered work remains pending in Supabase. Notes Home resumes up to three pending/stale context jobs per focus; opening a pending note also starts it. Failed work requires explicit retry; interrupted runtime claims become retryable after two minutes. The editor polls while active for about two minutes and offers manual Refresh context. Limits are three attempts per content revision and twenty starts per user per hour. Completed unchanged notes reuse stored results.

## Minimal questions

The model may suggest one meaningful ambiguous reference, but cannot generate arbitrary questions. The server accepts only an actual **that/this/the internship, project, event, decision, or task** reference and selects a fixed brief question, such as “Which internship were you considering?”

The model is instructed to suggest nothing for simple or sufficiently detailed notes, references identified elsewhere, and sensitive/intrusive details. A conservative server-side English sensitivity/privacy guard also suppresses questions even if the model proposes one. The narrow templates favor no question and do not explicitly request names, relationships, health, location, contacts, or financial information; implicit sensitivity still needs judgment. No device metadata is collected. User additions remain explicit supplemental information and are not automatically sent back to the model.

## Data and security

- Existing `notes` supplies ID, owner, creation/modification timestamps, capture method, original content, and source references.
- `context_preferences` stores owner and future-enrichment consent.
- `note_contexts` stores parent/owner, source hash/revision, processing status/lease, generated JSONB, last successful processing time/model, the first optional question/dismissal, and separate `user_context`/`answer` fields.
- `user_version` rejects stale edits to user additions. AI regeneration does not change it or overwrite those fields.
- Owner RLS protects both public tables. Clients can change only their preference and their own context/answer/dismissal, with column privileges preventing forged AI state or ownership. Deleting the parent note cascades to its context.
- Service-only claim/finish/fail RPCs and a private default-deny budget table protect lifecycle and costs. Private trigger functions are not directly callable by clients. Consent and note eligibility use short locks to serialize concurrent opt-out/save operations.
- Diagnostic logs contain no note text, model output, answers, or credentials. No GPS, contacts, embeddings, or additional permissions are used.

## Deployment

Already applied on `lvrmixdkkdrtssdtggnw`:

- `20261023170604_add_note_context.sql`
- `20261023171921_serialize_context_consent.sql`
- `enrich-note` Edge Function

The existing server-side `OPENAI_API_KEY` is reused. Optional **server-only** `OPENAI_CONTEXT_MODEL` defaults to `gpt-6-luna`; overrides must support the same strict output/reasoning configuration. There are **no new Expo variables, dependencies, native modules, or permissions**. Privileged credentials stay out of Expo and Git.

Gateway JWT verification is disabled because the function validates Bearer tokens itself with `auth.getUser()`. Anonymous/cross-owner calls are rejected. With an authorized CLI login, deploy updates using:

```sh
npx --yes supabase functions deploy enrich-note --project-ref lvrmixdkkdrtssdtggnw --no-verify-jwt --use-api
```

For another project, apply all migrations in order, deploy both functions, configure the OpenAI secret, and regenerate database types. Local function configuration uses `[edge_runtime] policy = "per_worker"` to allow background completion after a response.

## Android checks

Reload the current Expo Go/development client; this phase needs no native rebuild.

1. Confirm AI context starts Off. Save a note and verify it stays usable. Enable AI context on Notes Home; that historical note must remain unanalyzed until you choose Analyze context or save an edit.
2. Save “Buy milk tomorrow.” Confirm saving returns immediately and no question is suggested.
3. Save “I'm thinking of applying for that internship, but I'm scared of getting rejected.” Reopen it, answer the optional question, save added context, and restart/reopen to check persistence.
4. Choose Not now on another ambiguous note, reopen/edit it, and verify the question stays dismissed. Edit/remove your own context while keeping the original note unchanged.
5. Meaningfully edit a note; old generated context should disappear during regeneration while your additions remain. Whitespace-only edits should reuse context.
6. Save photo/audio notes normally; both should use this same enrichment process after their text is saved.
7. Disable enrichment, create/edit notes, simulate a network failure/retry, and switch accounts. Notes must remain usable and private.

## Verification and limits

Run `npm run lint`, `npm run typecheck`, `npm test`, `npx expo export --platform android --platform ios`, and `npx --yes deno check supabase/functions/enrich-note/index.ts`. `supabase/tests/context_security.sql` verifies opt-in/history exclusion, owner/anonymous permissions, service-only RPCs, stale/opt-out rejection, caching, dismissal, user-field preservation, and deletion cascade. Its fixtures roll back.

The opt-in live tests use two disposable accounts from an external private JSON file (`id`, `email`, `password`) and make billed model calls:

```sh
TWINKLE_TEST_FIXTURES=/private/path/test-users.json node --env-file=.env.local --test tests/context.integration.test.mjs
TWINKLE_TEST_FIXTURES=/private/path/test-users.json TWINKLE_MEDIA_FIXTURES=/private/path/media TWINKLE_VERIFY_CONTEXT=1 node --env-file=.env.local --test tests/captures.integration.test.mjs
```

Live tests covered reminders, ambiguous internships, fully identified events/projects, conditional intentions, instruction-like data, result reuse, answer persistence/edit/removal, opt-out, and cross-account denial. Photo/audio notes completed enrichment while their capture/security tests passed. Local tests cover invalid/refused/incomplete output, unsupported excerpts, negation/qualification, and prompt restrictions. Browser checks cover immediate note save and optional answer persistence. Android/iOS exports pass; physical context UI interactions still require device checks.

The [contextual quality review](CONTEXT-EVALUATION.md) adds a repeatable eight-scenario evaluation plus ambiguity, privacy and untrusted-input controls, with recorded synthetic outputs. It documents grounding, attribution, prompting and recovery fixes within FR-07–FR-09.

AI can still misclassify which phrases matter or miss context; excerpts do not guarantee perfect semantic interpretation. Review the full note when needed. Prompts intentionally support only a few English references. Background completion is best effort; interrupted work may need foreground recovery/manual retry. Historical notes are not batch-processed. No `PROGRESS.md` exists; this guide records status. FR-10 and later requirements remain unimplemented.
