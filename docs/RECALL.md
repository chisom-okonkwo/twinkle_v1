# Intelligent recall — FR-10 / FR-11 / FR-12

Twinkle now offers one quiet flashback card on Notes Home, a protected flashback detail screen, original-note navigation, Hide and Not relevant actions, and a note-level exclusion control. Not relevant excludes the originating note until the user allows it again in the editor. Ordinary note capture and saving remain independent of recall.

Push is **off by default**. In Flashback preferences, choose Off, Weekly, or A few times per week; choose a daytime/morning/afternoon/evening delivery window; and optionally allow personalized lock-screen previews. Defaults are weekly cadence when chosen, 9 am–8 pm delivery, and a generic preview. Preferences persist in Supabase. Denying system permission never disables in-app flashbacks.

## Selection and factual wording

Eligibility is deterministic: the owner must have saved and last edited the note at least **7 days** ago. Notes with insufficient text/context, exclusions, sensitive English cues, or instruction-like material are suppressed. Previously selected notes wait **90 days** before another selection. Historical notes are not automatically enriched: recall uses already completed, validated context or sufficient voluntarily added context.

The server fetches at most 100 eligible notes, then ranks them using a small explainable score:

| Recorded signal | Points |
|---|---:|
| Useful situation excerpt | 2 |
| Explicit intention | 3 |
| Explicit open question | 3 |
| Explicit concern | 2 |
| At least two contextual details | 2 |
| At least 40 characters of user-added context | 3 |
| Age at least 30 days / at least 90 days | 1 each |

At least 5 points and a substantive intention/question/concern or user addition are required. Emotional interpretations do not contribute to the score. Ties use note age and identifier, never randomness. All capture methods use the same stored note/context path. Dates remain in quoted text; this version does not infer calendar deadlines or assume an old intention was completed.

Only one card is ready per user. A new selection waits 7 days (Off/Weekly) or 3 days (Few), and the previous card can expire at that cadence. Hiding a card does not reset cooldowns. A meaningful note edit, context revision/user-addition change, exclusion, or deletion invalidates its flashback. Deleting the parent cascades to its flashbacks and delivery records.

A safe message is persisted **before** optional AI work: `You wrote: “<actual excerpt>”` plus a gentle invitation to revisit it. When existing AI consent is enabled, OpenAI Responses (`gpt-6-luna`, strict JSON, `store: false`, 12-second deadline) may select an excerpt index and one of two fixed invitations. It cannot return arbitrary prose, invent an outcome, or claim current feelings. Candidates are validated excerpts from the original note; user-added context contributes to ranking but is not sent to this model. AI failure leaves the stored fallback intact. Completed wording is reused; unchanged flashbacks do not trigger repeated model calls.

## Scheduled delivery and privacy

Supabase Cron runs `twinkle-recall-quarter-hour` every 15 minutes. A private function calls `recall-scheduler` through `pg_net`, authenticated with a generated secret held in Supabase Vault. The Edge Function rejects calls without that secret; public/publishable keys and ordinary user sessions are insufficient. The client-facing `flashbacks` function separately checks a real Supabase user session and derives the owner itself. No client date, owner, scheduler, or force override is trusted.

The scheduler claims at most five eligible users per pass, with leases and a bounded runtime. It checks opt-in, the stored IANA time zone, local delivery window, cadence, active device/session, note status, and delivery history. PostgreSQL time-zone conversion handles daylight saving time. Foreground device checks update the stored time zone when it changes. The server cannot discover a time-zone change or revoked OS permission while a device remains offline/closed; they are synchronized when the app returns.

Delivery uses the most recently registered active device, rather than notifying every device. Registration binds an Expo token to an authenticated owner, app-generated installation UUID, and active auth session. Sign-out unregisters the installation and attempts to clear displayed notifications before removing the session; if unregistering fails, sign-out remains retryable. The server also rejects devices whose auth session was revoked/expired. A token identity version stays stable during ordinary refreshes and changes on token/account/session changes, preventing old receipts from disabling a replacement token.

Default notification: **Twinkle ✨** / **A thought from your past is worth revisiting.** Only `flashbackId` is included in data. Personalized text is included only after explicit preview opt-in. The Android channel is quiet and private. Foreground banners are suppressed. Tap handling waits for authentication, validates the identifier, and checks owner access before navigating; it never follows arbitrary URLs. Changed, deleted, hidden, or wrong-owner records do not open private content.

One delivery record per flashback prevents parallel sends. Explicit rejection/rate limiting can retry up to three attempts with increasing 15-minute delays, rechecking preferences/windows each time. A lost response, interrupted send, or ambiguous server error becomes **unknown** and is not automatically resent; this favors avoiding duplicates. Expo provides no end-to-end exactly-once guarantee. Receipts are checked after 15 minutes, then periodically for at most 24 hours. Invalid tokens are deactivated only if their identity version still matches. A successful receipt means acceptance by FCM/APNs, not proof that a person saw the notification. Already accepted pushes cannot be recalled after a preference change.

## Database and deployment

Public tables: `flashbacks`, `flashback_exclusions`, `recall_preferences`, and `push_devices`. RLS restricts owner reads; generated flashbacks and raw tokens cannot be forged/read through client table permissions. Narrow authenticated RPCs handle feedback and device registration/unregistration with explicit owner/session checks. Private default-deny tables hold selection state, delivery attempts/tickets/receipts, and scheduler configuration. No new note contents or credentials are stored in diagnostic logs.

Applied migrations (local filenames match remote history):

- `20261023194022_add_flashbacks.sql`
- `20261023194513_harden_recall_delivery.sql`
- `20261023194732_fix_recall_candidates.sql`
- `20261023194753_repair_recall_aliases.sql`
- `20261023194920_stabilize_recall_token_versions.sql`
- `20261023195320_index_recall_ownership.sql`
- `20261023195422_align_recall_cadence.sql`

The `flashbacks` and `recall-scheduler` functions (version 2) and Cron job are deployed to `lvrmixdkkdrtssdtggnw`. The existing OpenAI secret is reused. Optional server-only `EXPO_ACCESS_TOKEN` is needed if Expo enhanced push security is enabled. The Cron secret was generated in Vault; do not copy it into the app or Git.

For a new Supabase project, apply **all** migrations in order, deploy both new functions with their shared dependencies (and existing capture/enrichment functions), then set the public endpoint server-side:

```sql
update private.recall_config set project_url='https://YOUR_PROJECT_REF.supabase.co' where id;
```

No privileged scheduling or testing route is exposed to the mobile client. Public function JWT gateway checks are disabled because the functions validate their respective user token or internal secret explicitly.

## Android setup still required

The EAS project is now linked in `app.json` (`34a9ef10-c1aa-4988-b869-9b2b1d332260`); that concurrent setup was preserved. Android package/FCM credentials and an installed development build have not been verified. Real remote delivery and tap behavior therefore remain **unverified**. Android Expo Go cannot test remote push on SDK 58; in-app recall and existing capture flows remain usable with `npx expo start --go`. A development build needs to include the newly installed Expo notification/localization/dev-client modules. `expo-asset` was also added as the audio module's required peer dependency, identified by Expo Doctor. No native directories were created or edited.

1. Choose the Android package name and register the same package in Firebase. The current EAS project is already linked; for another checkout/project, link with `npx eas-cli@latest init`.
2. The linked public EAS ID is read from app config; optional `EXPO_PUBLIC_EAS_PROJECT_ID` can override it. Supply `TWINKLE_ANDROID_PACKAGE` in ignored local/build environment configuration. Also supply the existing public Supabase URL and publishable key in the EAS development environment. These identifiers are public; server credentials must never use an `EXPO_PUBLIC_` name.
3. Supply the Android **client** `google-services.json` through the `GOOGLE_SERVICES_JSON` build-time path, preferably an EAS file environment variable. Local `google-services.json` is ignored. `app.config.ts` reads that path and the public identifiers.
4. Upload the separate **FCM v1 service-account key** to EAS credentials using `npx eas-cli@latest credentials --platform android`. Do not put that private key in `google-services.json`, Supabase public configuration, the app, Git, or chat. Follow the official [FCM credentials instructions](https://docs.expo.dev/push-notifications/fcm-credentials/).
5. Build/install: `npx eas-cli@latest build --platform android --profile development`; then `npx expo start --dev-client`. Notification channels and the plugin are already configured.
6. Sign in, open Flashback preferences, choose Weekly, save, and grant the OS notification permission. Register/check this device. Declining permission should leave ordinary notes and in-app flashbacks usable.

For iOS later, set `TWINKLE_IOS_BUNDLE_ID` and configure APNs/EAS credentials before a device build. The application retains its iOS export compatibility.

## Test immediately without a public test endpoint

The operator-only `scripts/recall-dev.ts` runs through Deno on a developer machine. It is excluded from mobile TypeScript compilation, is not imported by the app, and is never deployed as an HTTP route. It requires `TWINKLE_DEV_RECALL=1` plus private server credentials. Keep those in a separate ignored, access-restricted operator environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optionally `OPENAI_API_KEY` / `OPENAI_CONTEXT_MODEL` / `EXPO_ACCESS_TOKEN`. Never reuse that environment as Expo public configuration.

Use an empty disposable test account, and seed before first opening Notes Home. `seed` creates a clearly labeled synthetic note aged 35 days, with fixture context, without changing real notes or bypassing production eligibility rules:

```sh
# Environment variables are loaded privately; never paste keys into command arguments.
TWINKLE_DEV_RECALL=1 TWINKLE_DEV_SEED=1 \
  npx --yes deno run --allow-env --allow-net scripts/recall-dev.ts TEST_USER_UUID seed
TWINKLE_DEV_RECALL=1 \
  npx --yes deno run --allow-env --allow-net scripts/recall-dev.ts TEST_USER_UUID select
# Explicitly sends a real notification, respecting current preferences, window and history:
TWINKLE_DEV_RECALL=1 TWINKLE_DEV_SEND_PUSH=1 \
  npx --yes deno run --allow-env --allow-net scripts/recall-dev.ts TEST_USER_UUID send
# Check due receipts after at least 15 minutes:
TWINKLE_DEV_RECALL=1 \
  npx --yes deno run --allow-env --allow-net scripts/recall-dev.ts TEST_USER_UUID receipts
```

If Notes Home already performed an empty scan on this disposable account, an authorized database operator can clear only its one-hour scan cache before the CLI test (this does not reset selection or notification cooldowns):

```sql
update private.recall_state set last_checked_at=null where user_id='TEST_USER_UUID';
```

A second send must skip the existing delivery. To test another new notification immediately, use another disposable account/fixture rather than weakening real-user cooldowns. `seed` prints the note ID; remove that synthetic note and the disposable account after testing. An authorized database operator can also call `select private.run_recall_schedule();` to trigger the normal protected scheduled path immediately, without obtaining the Vault secret. That path still respects eligibility and delivery limits.

On Android, verify: private lock-screen wording while the app is closed; tap → sign-in if needed → correct owned flashback → original note/context; Hide and Not relevant; note exclusion/allow; note edits invalidating old flashbacks; preferences persisting after restart; Off blocking delivery; quiet-window skips; denied/revoked OS permission; token rollover; and sign-out/account switching. Do not use actual private notes for these checks.

## Verification and remaining limits

Passed: lint, Expo Doctor (20/20), mobile TypeScript checks, Deno checks for both functions and operator CLI, Android/iOS exports, local unit suite (**38 passed**, four opt-in live suites skipped by default), and a separately executed live recall integration test. The live test exercised authenticated concurrent selection (one record), AI-constrained wording, unchanged-message reuse, owner isolation/forgery denial, preference persistence, feedback/exclusion, and unauthorized scheduler rejection. A separate live check verified the AI-disabled fallback. Test data/accounts were removed after verification.

`supabase/tests/recall_security.sql` runs entirely inside a rolled-back transaction with synthetic tokens and **no push sends**. It passed owner/anonymous/service access checks, default-off/private previews, duplicate reservation/send suppression, weekly/few cadence, 90-day history, quiet-hour enforcement on retries, unknown-send suppression, terminal retry limits, tickets/receipt claims, token rollover and unchanged-token refresh, invalid-token deactivation, revoked sessions, note-edit invalidation, feedback exclusion, DST conversion and deletion cascade. The existing note and context SQL security suites were also rerun and passed.

The live integration requires an operator-seeded eligible synthetic note owned by the first of two disposable users, with existing AI preferences initially absent:

```sh
TWINKLE_TEST_FIXTURES=/private/path/disposable-users.json TWINKLE_RECALL_NOTE_ID=SEEDED_NOTE_UUID \
  node --env-file=.env.local --test tests/recall.integration.test.mjs
```

Real Expo tickets/receipts and Android permission/tap/background delivery are not verified until EAS/FCM and a suitable build exist. Browser UI verification was declined by the local origin approval gate and was not retried elsewhere. There was no physical Android/iOS device or working native simulator test in this phase. Existing photo/audio capture live suites were not rerun in full; their local contract/recovery tests passed.

V1 limits: English-sensitive-content filtering is conservative and incomplete; it may suppress useful notes or miss nuanced sensitive language. Ranking is bounded to 100 eligible notes and five scheduled users per pass; monitor capacity before scaling. The system favors skipping uncertain notes, not filling a notification quota. Metadata and excerpt choices can still be imperfect. Receipt/network uncertainty intentionally favors missed delivery over an avoidable duplicate. Stored time zone/permission state updates when the app next runs. No embeddings, semantic search, GPS, recommendations service, queues, social features or additional requirements were added.

Security advisors identify the three authenticated SECURITY DEFINER RPCs as callable by signed-in users; this is intentional for their narrowly checked owner/device operations. All private tables intentionally use default-deny RLS. See the [RPC advisory guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Existing [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains disabled. The existing Expo tooling tree still has four high-severity `node-forge`-related npm audit findings; forced framework downgrades were not applied. These require upstream/security review before release.

No `PROGRESS.md` exists; this guide records FR-10–FR-12 implementation and remaining external verification work. Stop here before further product requirements.

Official documentation checked: [Expo SDK 58 Notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/), [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Expo tickets and receipts](https://docs.expo.dev/push-notifications/sending-notifications/), [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
