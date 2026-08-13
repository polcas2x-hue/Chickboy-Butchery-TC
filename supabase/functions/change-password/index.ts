// Port of Code.gs's changePassword() (Code.gs:1250). Requires a valid
// session, verifies the old password, enforces the same 6-character
// minimum. Deliberately does NOT touch sessions_invalid_after — Code.gs
// only revokes other sessions on admin-initiated account changes, not on a
// user changing their own password (see plan notes).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireSession, AuthError } from '../_shared/session.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string; oldPassword?: string; newPassword?: string };
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

  const { oldPassword, newPassword } = body;
  if (!oldPassword || !newPassword) {
    return jsonResponse({ success: false, message: 'Please fill in both password fields.' });
  }
  if (String(newPassword).length < 6) {
    return jsonResponse({ success: false, message: 'New password must be at least 6 characters.' });
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, password_hash')
    .eq('id', session.userId)
    .maybeSingle();

  if (userError || !user) {
    return jsonResponse({ success: false, message: 'Account not found.' });
  }

  const { data: passwordMatches, error: verifyError } = await supabaseAdmin.rpc('verify_password', {
    plain_password: oldPassword,
    hash: user.password_hash,
  });
  if (verifyError || !passwordMatches) {
    return jsonResponse({ success: false, message: 'Current password is incorrect.' });
  }

  const { data: newHash, error: hashError } = await supabaseAdmin.rpc('hash_password', { plain_password: newPassword });
  if (hashError || !newHash) {
    return jsonResponse({ success: false, message: 'Could not update password.' }, 500);
  }

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ password_hash: newHash, password_changed_at: new Date().toISOString(), must_reset_password: false })
    .eq('id', user.id);

  if (updateError) {
    return jsonResponse({ success: false, message: 'Could not update password.' }, 500);
  }

  return jsonResponse({ success: true, message: 'Password updated successfully.' });
});
