// Port of Code.gs's login() (Code.gs:771). Response shape is kept
// identical — {success, token, role, fullName, username} on success,
// {success: false, message} on failure — so Index.html's existing
// withSuccessHandler callback body doesn't need to change, only the call
// mechanics (see Index.html:1990-2009).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';

const SESSION_DURATION_SECONDS = 21600; // 6 hours, matching Code.gs's SESSION_DURATION_SECONDS

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.' }, 400);
  }

  const { username, password } = body;
  if (!username || !password) {
    return jsonResponse({ success: false, message: 'Username and password are required.' });
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, username, password_hash, role, full_name, active')
    .ilike('username', username)
    .maybeSingle();

  if (userError || !user) {
    return jsonResponse({ success: false, message: 'No account found with that username.' });
  }
  if (!user.active) {
    return jsonResponse({ success: false, message: 'This account has been deactivated. Please contact the administrator.' });
  }

  const { data: passwordMatches, error: verifyError } = await supabaseAdmin.rpc('verify_password', {
    plain_password: password,
    hash: user.password_hash,
  });
  if (verifyError || !passwordMatches) {
    return jsonResponse({ success: false, message: 'Incorrect password.' });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_SECONDS * 1000);

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('sessions')
    .insert({ user_id: user.id, issued_at: now.toISOString(), expires_at: expiresAt.toISOString() })
    .select('token')
    .single();

  if (sessionError || !session) {
    return jsonResponse({ success: false, message: 'Login failed: could not create session.' }, 500);
  }

  // Never let last-login tracking break an otherwise-successful login.
  await supabaseAdmin.from('users').update({ last_login_at: now.toISOString() }).eq('id', user.id);

  return jsonResponse({ success: true, token: session.token, role: user.role, fullName: user.full_name, username: user.username });
});
