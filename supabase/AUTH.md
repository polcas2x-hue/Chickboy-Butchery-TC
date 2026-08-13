# Phase 1: Auth (Apps Script → Supabase Edge Functions)

Replaces Code.gs's `login`/`logout`/`getSessionInfo`/`changePassword` and
their CacheService-based session model with a custom `sessions` table and
four Edge Functions. See `../.claude` plan history for the full design
rationale — this file is just the run/deploy steps.

## What this is

- `migrations/0008_auth_sessions.sql` — `sessions` table,
  `users.sessions_invalid_after` column, `verify_password`/`hash_password`
  helper functions (pgcrypto bcrypt).
- `functions/_shared/session.ts` — `requireSession`/`requireRole`, reused by
  every future authenticated Edge Function.
- `functions/login`, `functions/logout`, `functions/session-info`,
  `functions/change-password` — one Edge Function each, response shapes
  matching Code.gs's originals exactly.
- `../gffc-app/index.html` — the real app frontend, now living in this repo
  (previously only in the Apps Script project). Its four auth call sites
  (login, logout, session restore on load, change password) now call these
  Edge Functions instead of `google.script.run`. The other ~50
  `google.script.run` call sites are untouched — later phases.

## How to deploy

1. **Apply the schema**: paste `migrations/0008_auth_sessions.sql` into the
   Supabase SQL Editor and run it (same process as `0004`).
2. **Deploy the functions.** This needs the Supabase CLI linked to your
   project (see `SUPABASE_STEP_BY_STEP_GUIDE.md` Phase 6 for one-time
   `supabase login`/`supabase link` setup), then from the repo root:
   ```bash
   supabase functions deploy login
   supabase functions deploy logout
   supabase functions deploy session-info
   supabase functions deploy change-password
   ```
   `verify_jwt = false` is already set for all four in `config.toml` — they
   implement their own auth via the `sessions` table, not Supabase's native
   JWT auth, so the platform shouldn't demand one.

## How to test

Pick a real migrated account and its temp password from
`data/import_credentials.txt` (e.g. `test_admin`). Replace
`YOUR_PUBLISHABLE_KEY` with the anon key from `.env.local`.

```bash
# 1. Login — expect {"success":true,"token":"...","role":"Admin",...}
curl -s -X POST 'https://ojwdsxsuhdtbyqrssgva.supabase.co/functions/v1/login' \
  -H "apikey: YOUR_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"username":"test_admin","password":"<temp password>"}'

# 2. Session info with that token — expect {"success":true,"role":"Admin",...}
curl -s -X POST 'https://ojwdsxsuhdtbyqrssgva.supabase.co/functions/v1/session-info' \
  -H "apikey: YOUR_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"token":"<token from step 1>"}'

# 3. Change password — expect {"success":true,"message":"Password updated successfully."}
curl -s -X POST 'https://ojwdsxsuhdtbyqrssgva.supabase.co/functions/v1/change-password' \
  -H "apikey: YOUR_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"token":"<token>","oldPassword":"<temp password>","newPassword":"<something 6+ chars>"}'

# 4. Confirm the OLD password no longer works, the new one does (repeat step 1 with each)

# 5. Logout, then confirm session-info now returns {"success":false}
curl -s -X POST 'https://ojwdsxsuhdtbyqrssgva.supabase.co/functions/v1/logout' \
  -H "apikey: YOUR_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"token":"<token>"}'
```

Then in the browser: open `gffc-app/index.html` (e.g. `npx serve gffc-app`
locally, since it's plain static HTML with no build step), log in with a
real account, confirm the admin UI appears, change the password, log out —
same behavior as the live Apps Script app today.

**Revocation check** (this is what a later user-management phase will call
from an `adminUpdateUser` equivalent): after logging in, run
```sql
update users set sessions_invalid_after = now() where username = 'test_admin';
```
then confirm `session-info` for that same token now returns
`{"success":false}` even though it hasn't expired.

## Not done yet

`gffc-app/index.html` isn't wired into any hosting/deploy pipeline yet
(it's a separate static artifact from the Vite React app this repo already
deploys to Cloudflare Pages) — that's Phase 9 of the bigger migration
(`SUPABASE_STEP_BY_STEP_GUIDE.md`), along with the other ~50
`google.script.run` call sites covering Applications, Schedule, Attendance,
Tool Orders, Tools Catalog, Inventory, and Sales/Expenses.
