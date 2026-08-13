// No Code.gs equivalent — Drive links were already "anyone with the link"
// viewable, so the client just used them directly. Supabase Storage here
// is private (documents include government IDs and PSA birth
// certificates), so viewing one now goes through this short-lived signed
// URL endpoint instead. get-applications inlines signed URLs for the bulk
// admin list already; this covers one-off/refresh cases (a signed URL from
// that list expiring while the page is still open, or a student wanting
// their own document back).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireSession, AuthError } from '../_shared/session.ts';
import { canViewApplicantRecords } from '../_shared/roles.ts';
import { DOCUMENTS_BUCKET } from '../_shared/storage.ts';

const DOC_COLUMNS: Record<string, string> = {
  photo: 'applicant_photo_url',
  validId: 'valid_id_url',
  psa: 'psa_url',
  barangayClearance: 'barangay_clearance_url',
  drugTest: 'drug_test_url',
};

const SIGNED_URL_TTL_SECONDS = 3600;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string; applicationId?: string; docType?: string };
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

  const column = body.docType ? DOC_COLUMNS[body.docType] : undefined;
  if (!column || !body.applicationId) {
    return jsonResponse({ success: false, message: 'Missing or unknown document type.' }, 400);
  }

  const { data: appRow, error: fetchError } = await supabaseAdmin.from('applicants').select(`${column}, student_user_id`).eq('id', body.applicationId).maybeSingle();
  if (fetchError || !appRow) {
    return jsonResponse({ success: false, message: 'Application not found.' }, 404);
  }

  const isOwner = appRow.student_user_id && appRow.student_user_id === session.userId;
  if (!canViewApplicantRecords(session.role) && !isOwner) {
    return jsonResponse({ success: false, message: 'You do not have permission to view this document.' }, 403);
  }

  const path = appRow[column as keyof typeof appRow] as string | null;
  if (!path) {
    return jsonResponse({ success: false, message: 'No document on file.' }, 404);
  }

  const { data: signed, error: signError } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) {
    return jsonResponse({ success: false, message: signError?.message ?? 'Could not create a link for this document.' }, 500);
  }

  return jsonResponse({ success: true, url: signed.signedUrl });
});
