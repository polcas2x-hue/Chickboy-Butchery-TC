// Port of Code.gs's adminCreateUser (Code.gs:942). Super Admin only.
// Password hashing uses pgcrypto bcrypt (hash_password RPC, established
// since Phase 1) rather than Code.gs's static-salt SHA-256.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireRole, AuthError } from '../_shared/session.ts';
import { VALID_ROLES } from '../_shared/roles.ts';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,30}$/;

interface CreateUserInput {
  username?: string;
  password?: string;
  fullName?: string;
  role?: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string; data?: CreateUserInput };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.' }, 400);
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    await requireRole(supabaseAdmin, body.token, ['Super Admin']);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ success: false, message: err.message }, err.status);
    throw err;
  }

  const data = body.data;
  if (!data || !data.username || !data.password || !data.fullName || !data.role) {
    return jsonResponse({ success: false, message: 'Full name, username, password, and role are required.' });
  }
  if (VALID_ROLES.indexOf(data.role) === -1) {
    return jsonResponse({ success: false, message: 'Invalid role.' });
  }
  if (!USERNAME_PATTERN.test(String(data.username).trim())) {
    return jsonResponse({ success: false, message: 'Username must be 3-30 characters, using only letters, numbers, periods, and underscores.' });
  }
  if (String(data.password).length < 6) {
    return jsonResponse({ success: false, message: 'Password must be at least 6 characters.' });
  }

  const username = String(data.username).trim().toLowerCase();

  const { data: existing } = await supabaseAdmin.from('users').select('id').eq('username', username).maybeSingle();
  if (existing) {
    return jsonResponse({ success: false, message: 'An account with this username already exists.' });
  }

  const { data: passwordHash, error: hashError } = await supabaseAdmin.rpc('hash_password', { plain_password: data.password });
  if (hashError || !passwordHash) {
    return jsonResponse({ success: false, message: 'Could not create account: could not hash password.' }, 500);
  }

  const { error: insertError } = await supabaseAdmin.from('users').insert({
    username,
    password_hash: passwordHash,
    must_reset_password: true,
    role: data.role,
    full_name: String(data.fullName).trim(),
    active: true,
  });

  if (insertError) {
    return jsonResponse({ success: false, message: `Could not create account: ${insertError.message}` }, 500);
  }

  return jsonResponse({ success: true, message: 'Account created successfully.' });
});
