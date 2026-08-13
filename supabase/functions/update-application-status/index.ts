// Port of Code.gs's updateApplicationStatus (Code.gs:2288) +
// ensureStudentAccount_ (1610) + recordGraduateTuitionSale_ (3862) +
// sendAcceptanceEmail_ (2443). Four independently-permissioned field
// groups; becoming Accepted auto-creates a Student account (idempotent).
//
// Concurrency note: Code.gs held a global script lock around this whole
// operation, mainly to protect the Reference Number / Student ID counters
// (now handled atomically by next_counter_value, see migration 0009) and to
// avoid two simultaneous edits of the same row. This app's real-world
// concurrency on a single application record is low; Postgres's own
// row-level locking during the UPDATE is sufficient here without an
// app-level mutex.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireSession, AuthError } from '../_shared/session.ts';
import { canReviewApplications, canApproveApplications, canSubmitTrainingResults, canApproveTrainingResults } from '../_shared/roles.ts';
import { sendEmail } from '../_shared/email.ts';

interface Fields {
  batchNumber?: string;
  reviewStatus?: string;
  approvalStatus?: string;
  trainingResult?: string;
  resultApprovalStatus?: string;
}

function generateTempPassword(length = 10): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string; applicationId?: string; fields?: Fields };
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

  const applicationId = body.applicationId;
  if (!applicationId) return jsonResponse({ success: false, message: 'Missing application ID.' });
  const fields = body.fields || {};

  const { data: appRow, error: fetchError } = await supabaseAdmin.from('applicants').select('*').eq('id', applicationId).maybeSingle();
  if (fetchError || !appRow) {
    return jsonResponse({ success: false, message: 'Application not found.' });
  }

  const now = new Date();
  const updates: Record<string, unknown> = {};
  const becomingAccepted = fields.reviewStatus !== undefined && fields.reviewStatus === 'Accepted';

  if (fields.batchNumber !== undefined || fields.reviewStatus !== undefined) {
    if (!canReviewApplications(session.role)) {
      return jsonResponse({ success: false, message: 'You do not have permission to update the review status or batch number.' });
    }
    const finalBatch = fields.batchNumber !== undefined ? String(fields.batchNumber || '').trim() : String(appRow.batch_number || '').trim();
    if (becomingAccepted && !finalBatch) {
      return jsonResponse({ success: false, message: 'Please assign a Batch Number when accepting an application.' });
    }
    if (fields.batchNumber !== undefined) updates.batch_number = fields.batchNumber || null;
    if (fields.reviewStatus !== undefined) {
      updates.review_status = fields.reviewStatus || 'Pending Review';
      updates.reviewed_by = session.userId;
      updates.reviewed_at = now.toISOString();
    }
  }

  if (fields.approvalStatus !== undefined) {
    if (!canApproveApplications(session.role)) {
      return jsonResponse({ success: false, message: 'You do not have permission to approve applications.' });
    }
    updates.approval_status = fields.approvalStatus || 'Pending';
    updates.approved_by = session.userId;
    updates.approved_at = now.toISOString();
  }

  if (fields.trainingResult !== undefined) {
    if (!canSubmitTrainingResults(session.role)) {
      return jsonResponse({ success: false, message: 'You do not have permission to submit training results.' });
    }
    updates.training_result = fields.trainingResult || 'Not Yet Available';
  }

  if (fields.resultApprovalStatus !== undefined) {
    if (!canApproveTrainingResults(session.role)) {
      return jsonResponse({ success: false, message: 'You do not have permission to approve training results.' });
    }
    updates.result_approval_status = fields.resultApprovalStatus || 'Pending';
    updates.result_approved_by = session.userId;
    updates.result_approved_at = now.toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse({ success: false, message: 'No changes to save.' });
  }

  const { data: updatedRow, error: updateError } = await supabaseAdmin.from('applicants').update(updates).eq('id', applicationId).select().single();
  if (updateError || !updatedRow) {
    return jsonResponse({ success: false, message: `Could not update application: ${updateError?.message}` }, 500);
  }

  // Idempotent graduate tuition sale — only fires on the call that actually
  // just set Result Approval Status to Approved, not on every save of an
  // already-approved row.
  if (updates.result_approval_status === 'Approved') {
    const effectiveTrainingResult = fields.trainingResult !== undefined ? fields.trainingResult : appRow.training_result;
    if (effectiveTrainingResult === 'Passed') {
      const batchForSale = fields.batchNumber !== undefined ? fields.batchNumber : appRow.batch_number;
      try {
        const { data: schedule } = await supabaseAdmin.from('training_schedule').select('tuition_fee').eq('batch_name', batchForSale).maybeSingle();
        const fee = schedule ? Number(schedule.tuition_fee) || 0 : 0;
        if (fee > 0) {
          const fullName = [updatedRow.last_name, updatedRow.first_name, updatedRow.middle_name].filter(Boolean).join(', ');
          const { error: saleError } = await supabaseAdmin.from('sales').insert({
            sale_type: 'Tuition',
            source_ref: applicationId,
            description: `Training completed — Batch ${batchForSale || '—'}`,
            customer_name: fullName,
            batch_number: batchForSale,
            amount: fee,
            recorded_by: session.userId,
          });
          // Ignore unique-violation on (sale_type, source_ref) — that's the
          // sales_source_ref_unique index doing its job (already recorded).
          if (saleError && saleError.code !== '23505') throw saleError;
        }
      } catch {
        // A Sales-sheet hiccup must never block the status update itself.
      }
    }
  }

  let studentAccount: { isNew: boolean; studentId: string; username: string; password: string | null } | null = null;
  let finalBatch = updatedRow.batch_number;

  if (becomingAccepted) {
    if (updatedRow.student_id_number) {
      studentAccount = { isNew: false, studentId: updatedRow.student_id_number, username: updatedRow.student_id_number.toLowerCase(), password: null };
    } else {
      const year = now.getFullYear();
      const { data: seq } = await supabaseAdmin.rpc('next_counter_value', { counter_name: `student_id_${year}` });
      const studentId = `CHICKBOY-STU-${year}-${String(seq).padStart(4, '0')}`;
      let username = studentId.toLowerCase();

      const { data: existingUser } = await supabaseAdmin.from('users').select('id').ilike('username', username).maybeSingle();
      if (existingUser) username = `${username}-${crypto.randomUUID().slice(0, 4)}`;

      const password = generateTempPassword(10);
      const { data: passwordHash } = await supabaseAdmin.rpc('hash_password', { plain_password: password });
      const fullName = [updatedRow.last_name, updatedRow.first_name, updatedRow.middle_name].filter(Boolean).join(', ');

      const { data: newUser, error: userInsertError } = await supabaseAdmin
        .from('users')
        .insert({
          username,
          password_hash: passwordHash,
          must_reset_password: true,
          role: 'Trainees',
          full_name: fullName,
          active: true,
          face_photo_url: updatedRow.applicant_photo_url,
          face_descriptor: updatedRow.face_descriptor,
          face_enrolled_at: updatedRow.face_descriptor ? now.toISOString() : null,
        })
        .select('id')
        .single();

      if (userInsertError || !newUser) {
        return jsonResponse({ success: false, message: `Could not update application: ${userInsertError?.message ?? 'failed to create student account'}` }, 500);
      }

      const { data: finalRow } = await supabaseAdmin
        .from('applicants')
        .update({ student_id_number: studentId, student_user_id: newUser.id, student_account_created_at: now.toISOString() })
        .eq('id', applicationId)
        .select()
        .single();

      studentAccount = { isNew: true, studentId, username, password };
      if (finalRow) finalBatch = finalRow.batch_number;
    }
  }

  let emailSent = false;
  if (becomingAccepted && updatedRow.email) {
    try {
      const fullName = [updatedRow.last_name, updatedRow.first_name, updatedRow.middle_name].filter(Boolean).join(', ');
      const { data: schedule } = await supabaseAdmin.from('training_schedule').select('start_date, end_date, venue').eq('batch_name', finalBatch).maybeSingle();
      const siteUrl = Deno.env.get('SITE_URL') || '';

      const subject = `Chickboy Butchery Training Center — Application Accepted (${updatedRow.reference_number})`;
      const scheduleText = schedule ? `Training Dates: ${schedule.start_date} to ${schedule.end_date}\n${schedule.venue ? `Venue: ${schedule.venue}\n` : ''}` : '';
      const credentialsText =
        studentAccount?.isNew && studentAccount.password
          ? `\nYour Student Login for this website:\nUser ID (ID Number): ${studentAccount.studentId}\nPassword: ${studentAccount.password}${siteUrl ? `\nWebsite: ${siteUrl}` : ''}\nPlease change your password after your first login.\n`
          : '\nYou can log in using your previously issued Student ID Number and password.\n';
      const text =
        `Congratulations! You have been accepted as a Butchery Trainee of Chickboy Butchery Training Center.\n\n` +
        `Reference Number: ${updatedRow.reference_number}\nBatch Number: ${finalBatch}\nStudent ID Number: ${studentAccount?.studentId || ''}\n` +
        scheduleText +
        credentialsText +
        `\nOnce logged in, you can view/print your Digital Student ID and order tools and equipment for the Butchery School.` +
        `\nPlease watch for further instructions regarding orientation and requirements.`;

      const credentialsHtml =
        studentAccount?.isNew && studentAccount.password
          ? `<div style="background:#e6f4ea;border:1px solid #b7dfc4;border-radius:8px;padding:14px 18px;margin:16px 0;">
               <strong>Your Student Login (for this website)</strong><br/>
               User ID (ID Number): <strong>${studentAccount.studentId}</strong><br/>
               Password: <strong>${studentAccount.password}</strong><br/>
               Log in through the "Login" button on the website. Please change your password after your first login (Account tab).
               ${siteUrl ? `<br/><a href="${siteUrl}">${siteUrl}</a>` : ''}
             </div>`
          : `<p>You can log in using your previously issued Student ID Number and password.</p>`;
      const html =
        `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;">` +
        `<h2>Chickboy Butchery Training Center — Application Accepted</h2>` +
        `<p>Dear ${fullName},</p>` +
        `<p>Congratulations! You have been accepted as a <strong>Butchery Trainee</strong>. Here are your batch details:</p>` +
        `<p>Reference Number: <strong>${updatedRow.reference_number}</strong><br/>Batch Number: <strong>${finalBatch}</strong><br/>Student ID Number: <strong>${studentAccount?.studentId || ''}</strong></p>` +
        (schedule ? `<p>Training Dates: ${schedule.start_date} to ${schedule.end_date}${schedule.venue ? `<br/>Venue: ${schedule.venue}` : ''}</p>` : '') +
        credentialsHtml +
        `<p>Please watch for further instructions regarding orientation and requirements before training starts.</p>` +
        `</div>`;

      await sendEmail({ to: updatedRow.email, subject, html, text });
      emailSent = true;
    } catch (emailErr) {
      await supabaseAdmin.from('email_log').insert({
        context: `Acceptance email for application ${applicationId}`,
        detail: (emailErr as Error).message,
      });
    }
  }

  return jsonResponse({ success: true, message: 'Application updated.', emailSent });
});
