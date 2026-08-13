# One-time data migration: Google Sheets → Supabase

This covers moving the real data out of the "GFFC Butchery TC" Google Sheet
(exported as .xlsx) into this repo's Supabase schema. It does **not** cover
rewiring the Apps Script frontend/backend itself — that's the separate,
larger effort described in the migration package's `SUPABASE_MIGRATION_PLAN.md`
and `SUPABASE_STEP_BY_STEP_GUIDE.md` (Phases 4–9). This is just Phases 2 + 10:
schema + data.

## What this is

- `migrations/0004_gffc_schema.sql` — the 11-table schema (users, applicants,
  training_schedule, attendance, tools_catalog, inventory_purchases,
  tool_orders, sales, expense_accounts, expenses, email_log), matching what
  `Code.gs` actually reads/writes.
- `../scripts/migrate-sheets-data.cjs` — reads the exported .xlsx and
  generates the INSERT statements for the rows that currently exist.

**Important correction vs. the migration docs shipped with the Apps Script
export:** those docs list roles as `Admin1/Admin2/Admin/Staff/Instructor/Student/Kiosk`.
That's stale — `Code.gs`'s actual `VALID_ROLES` (line 112) is `'Super Admin',
'Admin', 'Instructor', 'Staff', 'Kiosk', 'Trainees'`, following a rename the
app already went through (`Admin1→Super Admin`, `Admin2→Admin`,
`Student→Trainees`, per the `roleMap` in `runRenameRolesAndResetPasswords_`).
The schema and import script use the real names.

## How to run it

1. **Apply the schema.** In the Supabase dashboard → SQL Editor, paste and
   run `migrations/0004_gffc_schema.sql` (or `supabase db push` if you have
   the CLI linked). This only adds new tables — it doesn't touch anything
   from `0001_schema.sql`–`0003_rls.sql`, which belong to an earlier,
   unrelated scaffold in this repo and can be dropped later once you've
   confirmed nothing depends on them.
2. **Generate the data import**, from the repo root:
   ```bash
   node scripts/migrate-sheets-data.cjs "/path/to/GFFC  Butchery TC.xlsx"
   ```
   This writes three files into `supabase/data/` (gitignored — never
   committed, since it contains temp passwords and applicant PII):
   - `import_data.sql` — run this next, in the SQL Editor, after the schema.
   - `import_credentials.txt` — one freshly-generated temporary password per
     migrated user account. Share each one with its owner over a private
     channel, then delete the file. Every imported account has
     `must_reset_password = true`.
   - `import_report.json` — exactly which rows were skipped or couldn't be
     fully resolved, and why (see below).
3. **Run `import_data.sql`** in the SQL Editor. It's wrapped in a single
   transaction (`begin`/`commit`), so it either fully applies or fully rolls
   back.
4. **Verify**: Table Editor should show 7 users, 5 applicants, 12 catalog
   items, 7 expense accounts, 1 schedule entry, 1 email log row, and empty
   `attendance` / `tool_orders` / `inventory_purchases` / `sales` /
   `expenses` (there was no data yet in those sheets).

## Known data-quality findings (as of this export)

- **8 of 15 "Users" rows were excluded** — they have no `Username` at all
  (pre-dating that field), still carry the old role names
  (`Admin1`/`Admin2`/`Student`), and duplicate people who were later
  properly recreated with real usernames. Code.gs's own account-rename tool
  skips these same rows for the same reason. If any of these represent a
  real person who should have working login access, create their account
  fresh rather than trying to resurrect the row.
- **One unresolved reference**: `training_schedule` row "Batch 01" has
  `Submitted By = focalperson1`, but no user with that username exists
  (only `test_focalperson` does, created later — possibly the same person,
  possibly not). Imported with `submitted_by = null` and the original value
  preserved in `notes` as `[legacy submitted_by: focalperson1]`. If that's
  really `test_focalperson`, update the row by hand after import.
- **The "Schedule" sheet's own header row is stale** (columns 9–12 read
  "Created At", "", "", "" instead of the real field names) — the import
  script reads that sheet positionally against `Code.gs`'s `SCHEDULE_HEADERS`
  instead of trusting the header text, which would otherwise scramble
  Submitted By / Approval Status / Approved By / Created At.
- **Document/photo links** (Government ID, PSA, Barangay Clearance, Drug
  Test Result, Applicant Photo) are carried over as their existing Google
  Drive URLs, not copied into Supabase Storage. They'll keep working as long
  as those Drive files aren't deleted or unshared — migrating them into
  Storage is a separate follow-up (Phase 5 of the step-by-step guide).
- **Passwords are not carried over.** The sheet's password hashes use
  Code.gs's SHA-256 + salt scheme, which can't be verified via Postgres's
  `pgcrypto`/`bcrypt`. Every migrated account gets a fresh random temp
  password instead (see `import_credentials.txt`), with
  `must_reset_password = true` set for all of them.

## RLS

All eleven tables have Row Level Security **enabled with no policies yet**,
so only the Supabase service role (used above, and later by Edge Functions)
can read/write them. This is a deliberate, safe default given the data
includes biometric face descriptors and applicant personal documents.
Granular per-role policies come once there's a real login/JWT to check
against — see Phase 5 of `SUPABASE_STEP_BY_STEP_GUIDE.md`.
