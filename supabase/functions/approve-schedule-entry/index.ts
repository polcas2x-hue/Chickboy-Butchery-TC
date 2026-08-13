// Port of Code.gs's approveScheduleEntry (Code.gs:4569). approved_by
// (really "decided by") is set on both Approve and Reject, not just
// approval.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireRole, AuthError } from '../_shared/session.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string; id?: string; decision?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.' }, 400);
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let session;
  try {
    session = await requireRole(supabaseAdmin, body.token, ['Super Admin', 'Admin']);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ success: false, message: err.message }, err.status);
    throw err;
  }

  if (!body.id || ['Approved', 'Rejected'].indexOf(body.decision ?? '') === -1) {
    return jsonResponse({ success: false, message: 'Invalid request.' });
  }

  const { data, error } = await supabaseAdmin
    .from('training_schedule')
    .update({ approval_status: body.decision, approved_by: session.userId })
    .eq('id', body.id)
    .select('id')
    .maybeSingle();

  if (error) {
    return jsonResponse({ success: false, message: `Could not update approval: ${error.message}` }, 500);
  }
  if (!data) {
    return jsonResponse({ success: false, message: 'Schedule entry not found.' });
  }

  return jsonResponse({ success: true, message: `Schedule ${body.decision!.toLowerCase()}.` });
});
