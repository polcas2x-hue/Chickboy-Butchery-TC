// Port of Code.gs's getTrainingSchedule (Code.gs:4420). Token is optional
// (like submit-application) — anonymous callers only see Approved rows and
// never receive tuitionFee at all (not even as 0), logged-in callers of
// any role see everything including pending/rejected, with real pricing.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { getSessionOrNull } from '../_shared/session.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string | null };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const session = await getSessionOrNull(supabaseAdmin, body.token);

  const { data: rows, error } = await supabaseAdmin.from('training_schedule').select('*').order('start_date', { ascending: true });
  if (error) {
    // getTrainingSchedule never returns an error object in Code.gs — an
    // unexpected failure there would throw and land in withFailureHandler,
    // so a non-2xx status here (not a {success:false} body) is what keeps
    // that same routing via callEdgeFunction.
    return jsonResponse({ message: error.message }, 500);
  }

  const visible = (rows ?? []).filter((row) => session || row.approval_status === 'Approved');

  const userIds = new Set<string>();
  for (const row of visible) {
    if (row.submitted_by) userIds.add(row.submitted_by);
    if (row.approved_by) userIds.add(row.approved_by);
  }
  let usernames = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: users } = await supabaseAdmin.from('users').select('id, username').in('id', Array.from(userIds));
    usernames = new Map((users ?? []).map((u: { id: string; username: string }) => [u.id, u.username]));
  }

  const result = visible.map((row) => {
    const shaped: Record<string, unknown> = {
      id: row.id,
      batchName: row.batch_name,
      startDate: row.start_date,
      endDate: row.end_date,
      venue: row.venue,
      slots: row.slots,
      status: row.status,
      notes: row.notes,
      submittedBy: row.submitted_by ? usernames.get(row.submitted_by) ?? '' : '',
      approvalStatus: row.approval_status,
      approvedBy: row.approved_by ? usernames.get(row.approved_by) ?? '' : '',
    };
    if (session) shaped.tuitionFee = Number(row.tuition_fee) || 0;
    return shaped;
  });

  return jsonResponse(result);
});
