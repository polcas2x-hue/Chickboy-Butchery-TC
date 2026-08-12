# Chickboy Training Center

A business-systems app for requests with multi-step approvals (Requester → Manager → Admin), plus reports and dashboards.

- **Frontend**: Vite + React + TypeScript, Tailwind CSS, React Router, TanStack Query
- **Backend**: Supabase (Postgres, Auth, Row Level Security)
- **Hosting**: Cloudflare Pages
- **CI**: GitHub Actions (lint + build on every push/PR)

## How it works

- A requester creates a request (draft), then submits it.
- Submitting creates a two-step approval chain: their manager, then an admin.
- Each step is decided via a Postgres RPC function (`submit_request`, `decide_step` — see `supabase/migrations/0002_functions.sql`) so the workflow logic lives in the database and can't be bypassed by editing rows directly, no matter what client calls it.
- Row Level Security (`supabase/migrations/0003_rls.sql`) governs who can read/write what: requesters see their own requests, managers see their direct reports' requests, approvers see anything currently awaiting their decision, admins see everything.

## 1. Local setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` with your Supabase project's URL and anon key (see step 2).

```bash
npm run dev      # start the dev server
npm run build    # typecheck + production build
npm run lint     # oxlint
```

## 2. Create the Supabase project (you do this — needs your login)

1. Go to [supabase.com](https://supabase.com) → New project.
2. Once it's up, grab **Project URL** and **anon public key** from Settings → API, and put them in `.env.local`.
3. Apply the schema in `supabase/migrations/`, either:
   - **Supabase CLI** (recommended): `supabase login`, then `supabase link --project-ref <your-ref>`, then `supabase db push`.
   - **Or** paste the contents of `0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql` (in that order) into the SQL Editor in the Supabase dashboard and run each.
4. In Authentication → Settings, make sure "Enable email confirmations" matches your preference (the local `config.toml` disables it for faster local dev; production defaults to on).

### Promoting your first admin / setting up a manager

New sign-ups default to `role = 'requester'` with no manager. To test the full approval chain, sign up 2–3 test users through the app, then in the SQL Editor:

```sql
update profiles set role = 'admin' where id = '<admin-user-uuid>';
update profiles set role = 'manager' where id = '<manager-user-uuid>';
update profiles set manager_id = '<manager-user-uuid>' where id = '<requester-user-uuid>';
```

(Find user UUIDs under Authentication → Users.)

## 3. GitHub

This repo is set up for GitHub Actions CI (`.github/workflows/ci.yml`) — it runs lint + build on every push and PR to `main`. No secrets required.

## 4. Connect Cloudflare Pages (you do this — needs your login)

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: Workers & Pages → Create → Pages → Connect to Git → select this repo.
3. Build settings:
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Add environment variables in the Pages project settings (Settings → Environment variables), for both Production and Preview:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy. Every push to `main` will auto-deploy; PRs get preview URLs.

**If you change an environment variable later**: clicking "Retry deployment" on an existing deployment reuses the old build output (env vars baked in at build time) — it does **not** pick up the new value. Push a new commit (even a trivial one) to force a fresh build, or use "Create deployment" from the branch if your dashboard offers it.

## Project structure

```
src/
  lib/            Supabase client, hand-written DB types, API helpers
  auth/            Session + profile/role context
  components/      Shared UI (AppShell, RequestForm, StatusBadge, RoleGuard)
  routes/          Page components (Dashboard, Requests, Approvals, Reports, ...)
supabase/
  migrations/      SQL: schema, RPC functions, RLS policies
  config.toml      Supabase CLI local dev config
```

## Not yet implemented

File attachments, email notifications, and configurable per-request-type form schemas — the `type` field is currently free text. These are natural next additions on top of the current schema.
