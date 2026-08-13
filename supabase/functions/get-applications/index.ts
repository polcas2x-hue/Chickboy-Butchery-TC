// Port of Code.gs's getAllApplications (Code.gs:2247). Requires role in
// {Super Admin, Admin, Staff, Instructor} — Trainees get zero access via
// this endpoint, not even their own row (matches Code.gs exactly; students
// see their own status through other student-facing flows).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireSession, AuthError } from '../_shared/session.ts';
import { canViewApplicantRecords } from '../_shared/roles.ts';
import { toLegacyApplicantShapeBatch } from '../_shared/applicantShape.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.' }, 400);
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let session;
  try {
    session = await requireSession(supabaseAdmin, body.token);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ success: false, message: err.message }, err.status);
    throw err;
  }

  if (!canViewApplicantRecords(session.role)) {
    return jsonResponse({ success: false, message: 'You do not have permission to view submitted applications.' }, 403);
  }

  const { data, error } = await supabaseAdmin.from('applicants').select('*').order('submitted_at', { ascending: false });
  if (error) {
    return jsonResponse({ success: false, message: error.message }, 500);
  }

  // getAllApplications in Code.gs returns the row array directly (or
  // throws) — the client does `applicationsCache = rows || []` with no
  // success-flag check, so this returns the bare (legacy-shaped) array too.
  const shaped = await toLegacyApplicantShapeBatch(supabaseAdmin, data ?? []);
  return jsonResponse(shaped);
});
