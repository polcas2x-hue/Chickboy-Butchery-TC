// Port of Code.gs's getUserLog (Code.gs:1295). Super Admin only. Richer
// per-account audit view than get-users; password hash never selected.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireRole, AuthError } from '../_shared/session.ts';

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = d.toLocaleString('en-CA', { timeZone: 'Asia/Manila', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return parts.replace(',', '');
}

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

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('username, full_name, role, active, created_at, last_login_at, password_changed_at')
    .order('full_name', { ascending: true });
  if (error) {
    return jsonResponse({ message: error.message }, 500);
  }

  const result = (data ?? []).map((row) => ({
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    active: row.active !== false,
    createdAt: formatDateTime(row.created_at),
    lastLoginAt: row.last_login_at ? formatDateTime(row.last_login_at) : 'Never',
    passwordChangedAt: row.password_changed_at ? formatDateTime(row.password_changed_at) : '',
  }));

  return jsonResponse(result);
});
