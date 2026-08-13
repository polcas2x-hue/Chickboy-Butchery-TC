// Port of Code.gs's updateScheduleEntry (Code.gs:4494). The core-field
// approval-reset rule is the tricky part here -- see the inline comments,
// which mirror Code.gs:4517-4549 closely on purpose.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireRole, AuthError } from '../_shared/session.ts';
import { canApproveSchedule, canManageSchedulePricing } from '../_shared/roles.ts';

interface Entry {
  id?: string;
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
  if (!entry || !entry.id) {
    return jsonResponse({ success: false, message: 'Missing schedule ID.' });
  }

  const { data: oldRow, error: fetchError } = await supabaseAdmin.from('training_schedule').select('*').eq('id', entry.id).maybeSingle();
  if (fetchError || !oldRow) {
    return jsonResponse({ success: false, message: 'Schedule entry not found.' });
  }

  // The 6 "core" fields a reviewer actually approved -- notes and
  // tuitionFee are deliberately NOT part of this comparison (see below).
  const newCore = {
    batch_name: entry.batchName || '',
    start_date: entry.startDate || '',
    end_date: entry.endDate || '',
    venue: entry.venue || '',
    slots: entry.slots !== undefined && entry.slots !== null && entry.slots !== '' ? String(entry.slots) : '',
    status: entry.status || 'Open',
  };
  const oldCore = {
    batch_name: String(oldRow.batch_name || ''),
    start_date: String(oldRow.start_date || ''),
    end_date: String(oldRow.end_date || ''),
    venue: String(oldRow.venue || ''),
    slots: oldRow.slots !== null && oldRow.slots !== undefined ? String(oldRow.slots) : '',
    status: String(oldRow.status || ''),
  };
  const coreFieldsChanged = (Object.keys(newCore) as Array<keyof typeof newCore>).some((key) => oldCore[key] !== newCore[key]);

  const updates: Record<string, unknown> = {
    batch_name: newCore.batch_name,
    start_date: newCore.start_date,
    end_date: newCore.end_date,
    venue: newCore.venue,
    slots: newCore.slots !== '' ? Number(newCore.slots) : null,
    status: newCore.status,
    notes: entry.notes || '',
  };

  // Tuition Fee: Super Admin/Admin only, and only when the client actually
  // sent the key -- a true partial update, unlike add's force-to-0 for
  // non-privileged roles. Omitting the key leaves the DB value untouched.
  if (canManageSchedulePricing(session.role) && Object.prototype.hasOwnProperty.call(entry, 'tuitionFee')) {
    updates.tuition_fee = Number(entry.tuitionFee) || 0;
  }

  // An edit to an already-Approved batch's core scheduling fields used to
  // silently leave "Approved" in place no matter what changed. If a core
  // field actually changed AND the row was previously Approved: an editor
  // who can approve gets immediate re-approval under their own name;
  // one who can't gets bounced back to Pending Approval. If the row
  // wasn't previously Approved, this block doesn't fire -- status is left
  // alone regardless of what changed (that's approve-schedule-entry's job).
  if (coreFieldsChanged && oldRow.approval_status === 'Approved') {
    if (canApproveSchedule(session.role)) {
      updates.approval_status = 'Approved';
      updates.approved_by = session.userId;
    } else {
      updates.approval_status = 'Pending Approval';
      updates.approved_by = null;
    }
  }

  const { error: updateError } = await supabaseAdmin.from('training_schedule').update(updates).eq('id', entry.id);
  if (updateError) {
    return jsonResponse({ success: false, message: `Could not update schedule: ${updateError.message}` }, 500);
  }

  return jsonResponse({ success: true, message: 'Training schedule updated.' });
});
