# Phase 2: Applications (Apps Script → Supabase Edge Functions)

Replaces Code.gs's `submitApplication`/`updateApplicationStatus`/
`getAllApplications`/`uploadMyRequirementDocument`/`getMunicipalities`/
`getBarangays` — the admissions/enrollment flow. Deferred to a later phase:
the "Reprocess Applicant Photos" admin tool.

## What this is

- `migrations/0009_applications_counters.sql` — atomic per-year sequence
  counters (Reference Number, Student ID), seeded from the real imported
  data so new numbers can't collide with existing ones.
- `functions/_shared/email.ts` — Resend API helper.
- `functions/_shared/storage.ts` — base64 file upload to Supabase Storage.
- `functions/_shared/psgc.ts` — PSGC address-lookup helpers + the Mindanao
  highly-urbanized-city short-circuit list.
- `functions/_shared/roles.ts` — role-check helpers ported from Code.gs.
- `functions/_shared/applicantShape.ts` — reshapes a Postgres `applicants`
  row back into the legacy sheet-header-string keys (`'Review Status'`,
  `'Government Valid ID (Link)'`, etc.) that `gffc-app/index.html`'s admin
  Applications panel already renders against, with reviewer/approver user
  IDs resolved to usernames and document paths turned into signed URLs.
  This is what lets that ~400-line rendering block stay completely
  unchanged.
- `functions/submit-application`, `update-application-status`,
  `get-applications`, `upload-requirement-document`, `get-document-url`,
  `get-municipalities`, `get-barangays` — one Edge Function each.
- `gffc-app/index.html` — its 7 Applications call sites now call these
  functions. Also fixed `callEdgeFunction` (from Phase 1) to route non-2xx
  responses to `withFailureHandler` — needed because `get-applications`
  either returns the row array directly or a real error status, exactly
  mirroring Code.gs's "return the array, or throw" contract.

## Deliberate change from Code.gs: private Storage + signed URLs

Code.gs's Drive folder set every uploaded document to "anyone with the
link can view," which is what let email templates and the admin table
embed direct `<img>`/`<a href>` links. The `applicant-documents` Storage
bucket here is **private** instead (these are government IDs and PSA birth
certificates) — `get-applications` mints short-lived (1 hour) signed URLs
for every document link inline before returning rows, and
`get-document-url` covers one-off refreshes. Functionally the admin UI
looks and behaves the same; a copied link just stops working after an hour
instead of forever.

## How to deploy

1. **Apply the schema**: paste `migrations/0009_applications_counters.sql`
   into the SQL Editor. Confirm in Table Editor that `counters` has a
   `reference_number_2026` row with `value = 9` (matching the real
   imported data — the next generated number will be `CHICKBOY-2026-0010`).
2. **Create the Storage bucket**: Storage → New bucket → name
   `applicant-documents` → leave it **Private**.
3. **Sign up for Resend** (resend.com, free tier) if you haven't, verify a
   sending domain (or use their test domain while testing), create an API
   key, then:
   ```bash
   supabase secrets set RESEND_API_KEY=your_key_here
   supabase secrets set SITE_URL=https://your-eventual-app-url
   ```
   (`SITE_URL` is optional — only used in the acceptance email's login
   link; safe to skip for now and set later once Phase 9/hosting happens.)
   Also update the `from` address in `functions/_shared/email.ts` — it's
   currently a placeholder (`noreply@chickboybutcherytc.com`) and Resend
   will reject sends from an unverified domain.
4. **Deploy the functions**:
   ```bash
   supabase functions deploy submit-application
   supabase functions deploy update-application-status
   supabase functions deploy get-applications
   supabase functions deploy upload-requirement-document
   supabase functions deploy get-document-url
   supabase functions deploy get-municipalities
   supabase functions deploy get-barangays
   ```

## How to test

Get a Staff-role token first (see `AUTH.md`'s login curl, using an account
from `data/import_credentials.txt`).

```bash
# Address lookup (public, no token) — Bukidnon's PSGC code is 101300000
curl -s -X POST 'https://ojwdsxsuhdtbyqrssgva.supabase.co/functions/v1/get-municipalities' \
  -H "apikey: YOUR_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"provinceCode":"101300000"}'

# Submit a test application (small placeholder base64 images are fine for
# validation testing; use a real tiny JPEG/PNG data URI to test the actual
# Storage upload). Expect success:true and a NEW reference number.
curl -s -X POST 'https://ojwdsxsuhdtbyqrssgva.supabase.co/functions/v1/submit-application' \
  -H "apikey: YOUR_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"formData": { ... full payload, see gffc-app/index.html:3193 for the exact shape ... }}'

# Submit again with the same email -> expect success:false, duplicate message

# Accept it as Staff (assign a batch first via the Schedule tables, or any text batch name)
curl -s -X POST 'https://ojwdsxsuhdtbyqrssgva.supabase.co/functions/v1/update-application-status' \
  -H "apikey: YOUR_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"token":"<staff token>","applicationId":"<id from submit response, or look it up>","fields":{"reviewStatus":"Accepted","batchNumber":"Batch 01"}}'
# -> expect success:true; check Table Editor for a new `users` row with role Trainees

# Repeat the same accept call -> still success:true, no duplicate users row

# List applications as Staff -> full array; as a Trainees-role token -> non-200 error
curl -s -X POST 'https://ojwdsxsuhdtbyqrssgva.supabase.co/functions/v1/get-applications' \
  -H "apikey: YOUR_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"token":"<staff token>"}'
```

Then in the browser: serve `gffc-app/index.html` locally, submit a real
application through the camera-capture flow, confirm the receipt screen
and a real email; log in as Staff, accept it in the admin panel with a
batch assigned, confirm the acceptance email with Digital Student ID and
temp password arrives; log in as that new student and upload whichever
document was deferred.

## Not done yet

The "Reprocess Applicant Photos" admin tool (Super Admin only), and the
other ~43 remaining `google.script.run` call sites — Schedule, Attendance,
Tool Orders, Tools Catalog, Inventory, Sales/Expenses, User management.
