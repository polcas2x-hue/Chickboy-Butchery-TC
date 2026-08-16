// Port of Code.gs's adminDeleteUser (Code.gs:1186). Super Admin only.
// Doesn't touch applicants -- a deleted Trainee's application/Student ID
// record stays intact, only the login row goes.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireRole, AuthError } from '../_shared/session.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string; targetUsername?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.' }, 400);
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let session;
  try {
    session = await requireRole(supabaseAdmin, body.token, ['Super Admin']);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ success: false, message: err.message }, err.status);
    throw err;
  }

  const targetUsername = body.targetUsername;
  if (!targetUsername) {
    return jsonResponse({ success: false, message: 'Missing account.' });
  }
  if (String(targetUsername).trim().toLowerCase() === session.username.toLowerCase().trim()) {
    return jsonResponse({ success: false, message: 'You cannot delete your own account while logged in as it.' });
  }

  const { data: target, error: fetchError } = await supabaseAdmin.from('users').select('id, role').ilike('username', targetUsername).maybeSingle();
  if (fetchError || !target) {
    return jsonResponse({ success: false, message: 'Account not found.' });
  }

  if (String(target.role || '').trim() === 'Super Admin') {
    const { count } = await supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'Super Admin')
      .eq('active', true)
      .neq('id', target.id);
    if (!count || count === 0) {
      return jsonResponse({ success: false, message: 'Cannot delete this account — it is the last active Super Admin.' });
    }
  }

  // Hygiene, not a security requirement — requireSession's user lookup
  // already fails safely once the row itself is gone.
  await supabaseAdmin.from('sessions').delete().eq('user_id', target.id);

  const { error: deleteError } = await supabaseAdmin.from('users').delete().eq('id', target.id);
  if (deleteError) {
    return jsonResponse({ success: false, message: `Could not delete account: ${deleteError.message}` }, 500);
  }

  return jsonResponse({ success: true, message: 'Account deleted.' });
});
