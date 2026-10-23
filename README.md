# Twinkle V1

Private text, photo, and audio notes, built within the existing Expo SDK 58 / React Native / TypeScript project. The guiding document is [Twinkle V1 — Product & Technical Reference](./Twinkle%20V1%20%E2%80%94%20Product%20%26%20Technical%20Reference.md).

## Connected backend

- Supabase project: **Twinkle V1**, organization **Twinkle**, region **us-east-1**.
- Project reference: `lvrmixdkkdrtssdtggnw`.
- [Supabase dashboard](https://supabase.com/dashboard/project/lvrmixdkkdrtssdtggnw).
- Both notes and media-capture migrations are already applied. Local migration filenames match remote history. Do not rerun them in the SQL editor on this project.

Photo/audio capture uses a private Storage bucket and an authenticated Supabase Edge Function calling OpenAI. The function is deployed and its server-side OpenAI key is configured. See [capture setup, Android checks, and limitations](./docs/CAPTURE.md). FR-07 and subsequent requirements are not implemented.

## Local setup

Use Node.js 22.13 or newer (Node 24 recommended for the storage tests), then:

```sh
npm ci
```

This working copy already has an ignored `.env.local` containing the public client configuration. For another checkout, copy `.env.example` to `.env.local` and fill in:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://lvrmixdkkdrtssdtggnw.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

Get the publishable key from the project's **Connect** dialog or **Settings → API Keys**. Start the application:

```sh
npx expo start --clear
```

Use a development build that includes the installed native modules and camera/microphone permission configuration; rebuild an older development client after these additions. See the capture guide for device checks. No native directories were created or edited. Fully reload the app after changing environment values. Missing configuration displays setup guidance instead of contacting a dummy backend.

For EAS builds, configure the same two public values in the appropriate EAS environment. Values in an ignored local file are not a substitute for build environment configuration.

## Authentication setup and first run

1. In **Authentication → Sign In / Providers**, ensure email/password sign-in is enabled. Keep email confirmation enabled. Consider requiring at least 8 characters in the provider's password policy; the registration UI already requires 8.
2. In **Authentication → URL Configuration**, set **Site URL** to a real HTTPS confirmation landing page you control. Confirmation happens in the browser; users then return to Twinkle and sign in with their password. The default localhost redirect may show an unavailable page after the email has been confirmed. This foundation does not implement automatic sign-in from email links, OAuth, or password recovery.
3. Create an account in the app, confirm the email, return, and sign in. The built-in Supabase mail service is rate-limited and may restrict delivery to organization members; configure custom SMTP in Supabase for broader testing or real users.
4. Create a note, edit it, reload the app, and confirm it persists. Delete a note using its editor. Sign out, then sign in as a second user and confirm the first account's notes are absent.

## Privacy and ownership

- `EXPO_PUBLIC_*` values are embedded in the app and are **public**, even in `.env.local`. A Supabase publishable key is intended for this use. RLS and table permissions protect the data.
- Never put `service_role`, `sb_secret_` keys, database passwords, management access tokens, or OpenAI keys in the app, environment example, or Git. The capture function uses privileged credentials only in Supabase's server environment.
- On Android/iOS, auth sessions are encrypted with Expo SecureStore. The adapter splits large sessions into small values to support platform size limits and preserves the previous session if a replacement write fails. Tokens are available only while the device is unlocked and do not migrate with an iOS backup. iOS Keychain data can persist across reinstalls; explicitly sign out on shared test devices.
- The optional web development target uses per-tab browser `sessionStorage`, which is accessible to JavaScript and clears when the tab closes. It does not provide native SecureStore's encryption guarantees.
- Notes stay in Supabase and application memory; there is no local note cache. Sign-out removes the session and unmounts account-specific note state. Unsaved drafts are not stored offline.
- The `notes` table has an owner foreign key, editable content, capture method, optional source-capture reference, and server-managed creation/update timestamps. Photo/audio originals remain in private Storage; abandoned uploads expire and are cleaned up hourly.
- RLS restricts SELECT/INSERT/UPDATE/DELETE to the owner. Column privileges additionally prevent clients from altering ownership, IDs, capture method, or timestamps. Anonymous users have no table privileges. Deleting an auth user cascades to their notes.
- Notes reject blank content and cap content at 100,000 characters. Lists load 30 notes at a time using a timestamp/ID cursor, newest edited first. Failed saves preserve the draft for retry; successful saves return to Notes Home.

## Text notes: FR-02, FR-03, FR-04

The two primary screens are **Notes Home** and **Note Editor**. The existing calm cream/purple palette and typography are retained; authentication is unchanged. No dependencies were added for this implementation.

- Notes Home uses a virtualized list with first-line headings, content previews, and modification dates. New note is always available, including when the initial load fails. Empty, loading, refresh, and error states are distinct.
- Tap a note to read its full text, edit it, or delete it. Existing notes open without forcing the keyboard. New notes focus the editor for immediate capture. Creation and modification dates come from the database.
- Save preserves original whitespace and Unicode. The editor warns before leaving with unsaved changes, including back navigation. Deletion and conflict reloads require confirmation.
- Updates and deletes check the note's last modification timestamp. A stale operation fails rather than silently overwriting or deleting newer work. The editor retains the draft and offers a confirmed reload; copy any desired text before reloading.
- Returning to Notes Home or foregrounding the app refreshes the list. Pull to refresh and the Refresh notes action are also available. Notes are retrieved again from Supabase after a new app session.
- The initial migration `supabase/migrations/20261023045032_create_notes.sql` already supplies the schema, RLS, column privileges, owner index, and timestamp trigger. It is applied to the connected project. **No new SQL or manual Supabase configuration is needed for FR-02–FR-04.** Future metadata/media fields can be added through small migrations without changing the core note record.

To test in Expo, run `npx expo start --clear`, then:

1. Sign in, tap **+ New note**, enter several lines, and save. Confirm it appears on Notes Home.
2. Open it, edit the text, and save. Confirm it moves above older notes and its modification date changes.
3. Edit again and press **‹ Notes** or Android Back. Choose **Keep editing**, then save or explicitly discard.
4. Close and reopen the app, and verify the saved text remains. Sign out and back in to verify a fresh authenticated session.
5. Open a note, tap **Delete note**, cancel once, then confirm deletion. Verify it disappears.
6. Sign in as another account and verify that none of the first account's notes are visible.
7. Disable connectivity while editing and try saving. The draft should remain. Reconnect and retry. Re-enable connectivity before restarting; saved notes require the cloud to load.

Known limits: unsaved drafts are kept only in memory, so force-closing the app loses them. There is no offline queue, automatic save, realtime subscription, search, or rich-text editor. Refresh to see another device's changes; conflicting edits require manual reconciliation. Native TextInput's 100,000 UTF-16-unit input cap can be more restrictive for emoji than PostgreSQL's character cap.

## Code map

```text
index.ts                       Router entry and URL polyfill
src/app/_layout.tsx            Auth provider and protected routes
src/app/sign-in.tsx            Email/password registration and sign-in
src/app/index.tsx              Notes Home and paginated, virtualized list
src/app/note.tsx               Private note editor and navigation protection
src/components/note-ui.tsx     Note cards, text actions, and confirmation dialogs
src/components/capture-panel.tsx Photo/audio capture, preview, review, and retry
src/providers/auth-provider.tsx Session restoration and foreground token refresh
src/lib/supabase.ts            Typed client and public configuration validation
src/lib/session-storage*       Platform-specific auth persistence
src/lib/chunked-storage.ts     Large-session storage adapter
src/lib/database.types.ts      Generated from the live Supabase schema
src/lib/notes.ts               App-facing note operations
src/lib/notes-repository.ts    Typed, platform-independent Supabase note queries
src/lib/captures.ts            Private media staging, upload, processing, and cleanup
supabase/functions/capture/    Authenticated processing and maintenance endpoint
supabase/functions/_shared/   Validated capture contract and server OpenAI client
supabase/migrations/           Versioned schema, permissions, RLS, timestamp trigger
supabase/tests/                Transactional database security checks
```

The original starter `App.tsx` remains for reference; `index.ts` now loads Expo Router and the routes under `src/app/`.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npx expo export --platform android --platform ios
```

`npm test` runs sixteen local tests covering note validation, owner scoping, pagination, stale writes/deletes, session storage, media validation, and the OpenAI request/response contract. Live integration tests are skipped unless explicitly configured; the capture guide documents their additional fixtures.

The live test was run successfully against the connected Supabase project using two disposable, confirmed accounts. It verified real password sign-in, text CRUD, original whitespace/Unicode, automatic timestamps, persistence through a separate authenticated client, 34 notes across two pages without duplicates, stale-operation rejection, sign-out, and raw API attempts to bypass ownership. Test notes and accounts were removed afterwards.

To rerun it, create two empty disposable test accounts, confirm their emails, and put their credentials in a private JSON file **outside the repository** with permissions limited to your user. Format: an array of two objects containing `id`, `email`, and `password`. Then run:

```sh
TWINKLE_TEST_FIXTURES=/absolute/path/test-users.json node --env-file=.env.local --test tests/notes.integration.test.mjs
```

The test needs only the app's public Supabase configuration and removes its own notes in cleanup. Remove the test accounts and private fixture file after testing. Do not use real user accounts or commit the fixture.

The Expo web preview was exercised for sign-in, empty state, new-note capture, unsaved-change protection, saved-note display, opening/editing, reload persistence, deletion confirmation/cancellation, and sign-out. Actual deletion was verified through the live API test. Android and iOS bundles passed export. A native simulator was unavailable on this host, so native keyboard layout, hardware Back/swipe behavior, encrypted device storage, and physical app restarts still require device testing.

Run `supabase/tests/notes_security.sql` as the database owner in the project's SQL editor to verify owner CRUD, original content, timestamps, validation, anonymous denial, and cross-user isolation. It rolls back all test users and notes. These checks passed again for FR-02–FR-04. The security advisor reported no note-table findings; it flagged the existing Auth setting **Leaked Password Protection Disabled**. This optional authentication hardening remains outside the note implementation and was not changed.

The public client key was also checked against the live Data API: unauthenticated note reads are denied, and the Auth endpoint reports email sign-in enabled with confirmation required. Registration/email delivery and native device interactions still require the first-run checks above.

`npm audit` currently reports 19 high-severity findings in the Expo/React Native dependency tree. The two underlying advisories concern `braces` 3.0.3 and `node-forge` 1.4.0, both present at the same versions in the original starter lockfile. Supabase packages are not flagged. The suggested forced fixes include incompatible framework downgrades; the existing SDK and React Native versions were preserved. Review compatible upstream fixes before release.

For a different Supabase project, apply both migrations in order, configure the cleanup endpoint as described in the capture guide, deploy the function, and regenerate `database.types.ts` from that project's schema. Use the Supabase CLI's documented migration/link workflow; do not put management credentials into Expo variables.

## Documentation checked

- [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/)
- [Expo Router installation](https://docs.expo.dev/router/installation/)
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)
- [Expo SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/)
- [Supabase React Native authentication](https://supabase.com/docs/guides/auth/quickstarts/react-native)
- [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
