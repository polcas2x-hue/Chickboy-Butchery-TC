// Port of Code.gs's addScheduleEntry (Code.gs:4453). No date-range or
// slots-numeric validation in the original -- preserved as-is for parity,
// not tightened.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireRole, AuthError } from '../_shared/session.ts';
import { canApproveSchedule, canManageSchedulePricing } from '../_shared/roles.ts';

interface Entry {
  batchName?: string;
  startDate?: string;
  endDate?: string;
  venue?: string;
  slots?: number | string;
  status?: string;
  notes?: string;
  tuitionFee?: number | string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string; entry?: Entry };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.' }, 400);
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let session;
  try {
    session = await requireRole(supabaseAdmin, body.token, ['Super Admin', 'Admin', 'Staff', 'Instructor']);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ success: false, message: err.message }, err.status);
    throw err;
  }

  const entry = body.entry;
  if (!entry || !entry.batchName || !entry.startDate || !entry.endDate) {
    return jsonResponse({ success: false, message: 'Batch name, start date, and end date are required.' });
  }

  const approvalStatus = canApproveSchedule(session.role) ? 'Approved' : 'Pending Approval';
  const tuitionFee = canManageSchedulePricing(session.role) ? Number(entry.tuitionFee) || 0 : 0;

  const { error } = await supabaseAdmin.from('training_schedule').insert({
    batch_name: entry.batchName,
    start_date: entry.startDate,
    end_date: entry.endDate,
    venue: entry.venue || '',
    slots: entry.slots !== undefined && entry.slots !== null && entry.slots !== '' ? Number(entry.slots) : null,
    status: entry.status || 'Open',
    notes: entry.notes || '',
    submitted_by: session.userId,
    approval_status: approvalStatus,
    approved_by: canApproveSchedule(session.role) ? session.userId : null,
    tuition_fee: tuitionFee,
  });

  if (error) {
    return jsonResponse({ success: false, message: `Could not add schedule: ${error.message}` }, 500);
  }

  return jsonResponse({ success: true, message: 'Training schedule added.' });
});
