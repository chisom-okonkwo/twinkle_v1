# Twinkle V1

Minimal authentication and private text notes, built within the existing Expo SDK 58 / React Native / TypeScript project. The guiding document is [Twinkle V1 — Product & Technical Reference](./Twinkle%20V1%20%E2%80%94%20Product%20%26%20Technical%20Reference.md).

## Connected backend

- Supabase project: **Twinkle V1**, organization **Twinkle**, region **us-east-1**.
- Project reference: `lvrmixdkkdrtssdtggnw`.
- [Supabase dashboard](https://supabase.com/dashboard/project/lvrmixdkkdrtssdtggnw).
- Initial notes migration is already applied. Local migration filenames match remote history. Do not rerun it in the SQL editor on this project.

No separate backend, media buckets, AI integrations, or notification services are required for this foundation.

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

Open on Android or iOS using an Expo Go version compatible with SDK 58, or a development build that includes the installed native modules. New development builds must include SecureStore and the Router dependencies. No native directories were created or edited. Fully reload the app after changing environment values. Missing configuration displays setup guidance instead of contacting a dummy backend.

For EAS builds, configure the same two public values in the appropriate EAS environment. Values in an ignored local file are not a substitute for build environment configuration.

## Authentication setup and first run

1. In **Authentication → Sign In / Providers**, ensure email/password sign-in is enabled. Keep email confirmation enabled. Consider requiring at least 8 characters in the provider's password policy; the registration UI already requires 8.
2. In **Authentication → URL Configuration**, set **Site URL** to a real HTTPS confirmation landing page you control. Confirmation happens in the browser; users then return to Twinkle and sign in with their password. The default localhost redirect may show an unavailable page after the email has been confirmed. This foundation does not implement automatic sign-in from email links, OAuth, or password recovery.
3. Create an account in the app, confirm the email, return, and sign in. The built-in Supabase mail service is rate-limited and may restrict delivery to organization members; configure custom SMTP in Supabase for broader testing or real users.
4. Create a note, edit it, reload the app, and confirm it persists. Delete a note using its editor. Sign out, then sign in as a second user and confirm the first account's notes are absent.

## Privacy and ownership

- `EXPO_PUBLIC_*` values are embedded in the app and are **public**, even in `.env.local`. A Supabase publishable key is intended for this use. RLS and table permissions protect the data.
- Never put `service_role`, `sb_secret_` keys, database passwords, management access tokens, or OpenAI keys in the app, environment example, or Git. No privileged credentials were needed or written for this integration.
- On Android/iOS, auth sessions are encrypted with Expo SecureStore. The adapter splits large sessions into small values to support platform size limits and preserves the previous session if a replacement write fails. Tokens are available only while the device is unlocked and do not migrate with an iOS backup. iOS Keychain data can persist across reinstalls; explicitly sign out on shared test devices.
- The optional web development target uses per-tab browser `sessionStorage`, which is accessible to JavaScript and clears when the tab closes. It does not provide native SecureStore's encryption guarantees.
- Notes stay in Supabase and application memory; there is no local note cache. Sign-out removes the session and unmounts account-specific note state. Unsaved drafts are not stored offline.
- The `notes` table has an owner foreign key, original content, capture method, and server-managed creation/update timestamps. Only text creation is implemented. Optional media/context fields can be added in later migrations.
- RLS restricts SELECT/INSERT/UPDATE/DELETE to the owner. Column privileges additionally prevent clients from altering ownership, IDs, capture method, or timestamps. Anonymous users have no table privileges. Deleting an auth user cascades to their notes.
- Notes reject blank content and cap content at 100,000 characters. Lists load 30 notes at a time, newest edited first. Failed saves preserve the draft for retry; successful saves clear it.

## Code map

```text
index.ts                       Router entry and URL polyfill
src/app/_layout.tsx            Auth provider and protected routes
src/app/sign-in.tsx            Email/password registration and sign-in
src/app/index.tsx              Private note list and text editor
src/providers/auth-provider.tsx Session restoration and foreground token refresh
src/lib/supabase.ts            Typed client and public configuration validation
src/lib/session-storage*       Platform-specific auth persistence
src/lib/chunked-storage.ts     Large-session storage adapter
src/lib/database.types.ts      Generated from the live Supabase schema
src/lib/notes.ts               Typed note operations
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

`npm test` verifies large Unicode session round-trips, replacement failure recovery, cleanup on sign-out, and missing-chunk handling using a simulated storage backend. Native encryption, device lifecycle behavior, and keyboard layout still need device testing.

Run `supabase/tests/notes_security.sql` as the database owner in the project's SQL editor to verify owner CRUD, original content, timestamps, validation, anonymous denial, and cross-user isolation. It rolls back all test users and notes. These tests already passed against the connected project, and the Supabase security advisor returned no findings after the migration.

The public client key was also checked against the live Data API: unauthenticated note reads return HTTP 401 / PostgreSQL `42501`, and the Auth endpoint reports email sign-in enabled with confirmation required. Full account registration, email delivery, and native device interactions still require the first-run checks above.

`npm audit` currently reports 19 high-severity findings in the Expo/React Native dependency tree. The two underlying advisories concern `braces` 3.0.3 and `node-forge` 1.4.0, both present at the same versions in the original starter lockfile. Supabase packages are not flagged. The suggested forced fixes include incompatible framework downgrades; the existing SDK and React Native versions were preserved. Review compatible upstream fixes before release.

For a different Supabase project, apply the migration once before using the app and regenerate `database.types.ts` from that project's schema. Use the Supabase CLI's documented migration/link workflow; do not put management credentials into Expo variables.

## Documentation checked

- [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/)
- [Expo Router installation](https://docs.expo.dev/router/installation/)
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)
- [Expo SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/)
- [Supabase React Native authentication](https://supabase.com/docs/guides/auth/quickstarts/react-native)
- [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
