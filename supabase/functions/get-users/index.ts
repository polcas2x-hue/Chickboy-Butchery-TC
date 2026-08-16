// Port of Code.gs's getAllUsers (Code.gs:998). Super Admin only. Returns a
// bare array (not {success,...}-wrapped), every role included, password
// hash never selected at all (not just omitted from the response).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireRole, AuthError } from '../_shared/session.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    await requireRole(supabaseAdmin, body.token, ['Super Admin']);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ message: err.message }, err.status);
    throw err;
  }

  const { data, error } = await supabaseAdmin.from('users').select('username, full_name, role, active').order('full_name', { ascending: true });
  if (error) {
    return jsonResponse({ message: error.message }, 500);
  }

  const result = (data ?? []).map((row) => ({
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    active: row.active !== false,
  }));

  return jsonResponse(result);
});
