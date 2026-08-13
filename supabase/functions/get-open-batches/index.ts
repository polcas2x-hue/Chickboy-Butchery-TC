// Port of Code.gs's getOpenBatches (Code.gs:2569). Any logged-in role (no
// anonymous access, unlike get-schedule) -- used for the "assign batch"
// dropdown when Staff accept an application, and for occupancy displays.
// A batch is full once the number of non-Rejected applicants assigned to
// it (Batch Number match, set only at acceptance time) reaches its Slots.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireSession, AuthError } from '../_shared/session.ts';

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

  try {
    await requireSession(supabaseAdmin, body.token);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ message: err.message }, err.status);
    throw err;
  }

  const { data: applicants, error: applicantsError } = await supabaseAdmin
    .from('applicants')
    .select('batch_number, review_status')
    .not('batch_number', 'is', null);
  if (applicantsError) {
    return jsonResponse({ message: applicantsError.message }, 500);
  }

  const counts = new Map<string, number>();
  for (const row of applicants ?? []) {
    if (!row.batch_number || row.review_status === 'Rejected') continue;
    counts.set(row.batch_number, (counts.get(row.batch_number) ?? 0) + 1);
  }

  const { data: schedule, error: scheduleError } = await supabaseAdmin.from('training_schedule').select('*');
  if (scheduleError) {
    return jsonResponse({ message: scheduleError.message }, 500);
  }

  const result = (schedule ?? []).map((row) => {
    const slots = row.slots !== null && row.slots !== undefined ? Number(row.slots) : null;
    const status = row.status || 'Open';
    const approvalStatus = row.approval_status || 'Pending Approval';
    const acceptedCount = counts.get(row.batch_name) ?? 0;
    const isFull = slots !== null && acceptedCount >= slots;
    const eligible = approvalStatus === 'Approved' && status === 'Open' && !isFull;

    return {
      batchName: row.batch_name,
      startDate: row.start_date,
      endDate: row.end_date,
      venue: row.venue,
      slots,
      acceptedCount,
      status,
      approvalStatus,
      isFull,
      eligible,
    };
  });

  return jsonResponse(result);
});
