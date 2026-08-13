// Port of Code.gs's uploadMyRequirementDocument (Code.gs:2665). Trainees-
// only — lets a student complete a PSA/Drug Test requirement they deferred
// at application time. Uses student_user_id (a real FK in this schema) to
// find their applicants row, instead of Code.gs's case-insensitive username
// text match against "Student Username".
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireRole, AuthError } from '../_shared/session.ts';
import { uploadBase64File, estimateBase64Bytes, MAX_IMAGE_BYTES } from '../_shared/storage.ts';

const DOC_CONFIG: Record<string, { urlColumn: string; statusColumn: string; tag: string; label: string }> = {
  psa: { urlColumn: 'psa_url', statusColumn: 'psa_status', tag: 'psa', label: 'PSA Birth Certificate' },
  drugTest: { urlColumn: 'drug_test_url', statusColumn: 'drug_test_status', tag: 'drug-test', label: 'Drug Test Result' },
};

function isDrugTestDateValid(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setHours(0, 0, 0, 0);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return d.getTime() <= today.getTime() && d.getTime() >= sixMonthsAgo.getTime();
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string; docType?: string; fileDataUrl?: string; drugTestDate?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.' }, 400);
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let session;
  try {
    session = await requireRole(supabaseAdmin, body.token, ['Trainees']);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ success: false, message: err.message }, err.status);
    throw err;
  }

  const config = body.docType ? DOC_CONFIG[body.docType] : undefined;
  if (!config) {
    return jsonResponse({ success: false, message: 'Unknown document type.' });
  }
  if (!body.fileDataUrl) {
    return jsonResponse({ success: false, message: `Please upload: ${config.label}.` });
  }
  if (estimateBase64Bytes(body.fileDataUrl) > MAX_IMAGE_BYTES) {
    return jsonResponse({ success: false, message: `The uploaded ${config.label} file is too large. Please use a smaller image.` });
  }
  if (body.docType === 'drugTest') {
    if (!body.drugTestDate || !isDrugTestDateValid(body.drugTestDate)) {
      return jsonResponse({ success: false, message: 'Drug Test Result must be dated within the last 6 months (and not a future date).' });
    }
  }

  const { data: appRow, error: fetchError } = await supabaseAdmin.from('applicants').select('id').eq('student_user_id', session.userId).maybeSingle();
  if (fetchError || !appRow) {
    return jsonResponse({ success: false, message: 'Profile not found.' });
  }

  let fileUrl: string;
  try {
    fileUrl = await uploadBase64File(supabaseAdmin, body.fileDataUrl, `${appRow.id}/${config.tag}`);
  } catch (uploadErr) {
    return jsonResponse({ success: false, message: (uploadErr as Error).message }, 500);
  }

  const updates: Record<string, unknown> = { [config.urlColumn]: fileUrl, [config.statusColumn]: 'Submitted' };
  if (body.docType === 'drugTest') updates.drug_test_date = body.drugTestDate;

  const { error: updateError } = await supabaseAdmin.from('applicants').update(updates).eq('id', appRow.id);
  if (updateError) {
    return jsonResponse({ success: false, message: updateError.message }, 500);
  }

  return jsonResponse({ success: true, message: `${config.label} uploaded. Thank you for completing this requirement.` });
});
