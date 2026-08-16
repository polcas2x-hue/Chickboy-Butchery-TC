// Port of Code.gs's adminUpdateUser (Code.gs:1020). Super Admin only.
// Real signature is (token, targetUsername, updates), not (token, data).
// No trainee-username-sync step needed here -- this schema uses a real FK
// (applicants.student_user_id) instead of Code.gs's denormalized username
// text column, so a rename is automatically correct everywhere.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireRole, AuthError } from '../_shared/session.ts';
import { VALID_ROLES } from '../_shared/roles.ts';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,30}$/;

interface Updates {
  newUsername?: string;
  fullName?: string;
  role?: string;
  active?: boolean;
  newPassword?: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string; targetUsername?: string; updates?: Updates };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.' }, 400);
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let callerSession;
  try {
    callerSession = await requireRole(supabaseAdmin, body.token, ['Super Admin']);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ success: false, message: err.message }, err.status);
    throw err;
  }

  const targetUsername = body.targetUsername;
  const updates = body.updates;
  if (!targetUsername || !updates) {
    return jsonResponse({ success: false, message: 'Missing account or updates.' });
  }
  if (!updates.fullName || !String(updates.fullName).trim()) {
    return jsonResponse({ success: false, message: 'Full name is required.' });
  }
  if (!updates.role || VALID_ROLES.indexOf(updates.role) === -1) {
    return jsonResponse({ success: false, message: 'Invalid role.' });
  }
  if (updates.newPassword && String(updates.newPassword).length < 6) {
    return jsonResponse({ success: false, message: 'New password must be at least 6 characters.' });
  }

  const lowerTarget = String(targetUsername).trim().toLowerCase();
  let renamedUsername: string | null = null;

  if (updates.newUsername && String(updates.newUsername).trim().toLowerCase() !== lowerTarget) {
    if (lowerTarget === callerSession.username.toLowerCase().trim()) {
      return jsonResponse({
        success: false,
        message: 'You cannot rename your own account while logged in as it — use a different Super Admin account, or rename it and then log out and back in.',
      });
    }
    const candidate = String(updates.newUsername).trim();
    if (!USERNAME_PATTERN.test(candidate)) {
      return jsonResponse({ success: false, message: 'Username must be 3-30 characters, using only letters, numbers, periods, and underscores.' });
    }
    renamedUsername = candidate.toLowerCase();
  }

  const { data: target, error: fetchError } = await supabaseAdmin.from('users').select('*').ilike('username', lowerTarget).maybeSingle();
  if (fetchError || !target) {
    return jsonResponse({ success: false, message: 'Account not found.' });
  }

  if (renamedUsername) {
    const { data: collision } = await supabaseAdmin.from('users').select('id').ilike('username', renamedUsername).neq('id', target.id).maybeSingle();
    if (collision) {
      return jsonResponse({ success: false, message: 'That username is already taken by another account.' });
    }
  }

  const newActive = updates.active !== false;
  const wasSuperAdmin = String(target.role || '').trim() === 'Super Admin';
  const becomingNonSuperAdmin = updates.role !== 'Super Admin' || !newActive;

  if (wasSuperAdmin && becomingNonSuperAdmin) {
    const { count } = await supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'Super Admin')
      .eq('active', true)
      .neq('id', target.id);
    if (!count || count === 0) {
      return jsonResponse({ success: false, message: 'Cannot change this account — it is the last active Super Admin. Promote another account to Super Admin first.' });
    }
  }

  const originalRole: string = target.role;
  const originalActive: boolean = target.active;

  const rowUpdates: Record<string, unknown> = {
    full_name: String(updates.fullName).trim(),
    role: updates.role,
    active: newActive,
  };
  if (renamedUsername) rowUpdates.username = renamedUsername;
  if (updates.newPassword) {
    const { data: passwordHash, error: hashError } = await supabaseAdmin.rpc('hash_password', { plain_password: updates.newPassword });
    if (hashError || !passwordHash) {
      return jsonResponse({ success: false, message: 'Could not update account: could not hash password.' }, 500);
    }
    rowUpdates.password_hash = passwordHash;
    rowUpdates.password_changed_at = new Date().toISOString();
    rowUpdates.must_reset_password = true;
  }

  // Any already-issued session for this account should stop working
  // immediately rather than staying valid for up to its remaining 6 hours —
  // covers deactivation, role changes, forced password resets, and
  // renames. Full-name-only edits do NOT revoke. Unlike Code.gs (which
  // revokes by username string and has to touch both the old and new key
  // on a rename), this only needs one write since sessions_invalid_after
  // lives on the row itself, keyed by immutable id — a username change is
  // still the same row.
  const shouldRevoke = newActive !== originalActive || updates.role !== originalRole || !!updates.newPassword || !!renamedUsername;
  if (shouldRevoke) {
    rowUpdates.sessions_invalid_after = new Date().toISOString();
  }

  const { error: updateError } = await supabaseAdmin.from('users').update(rowUpdates).eq('id', target.id);
  if (updateError) {
    return jsonResponse({ success: false, message: `Could not update account: ${updateError.message}` }, 500);
  }

  const message = renamedUsername ? `Account updated — username changed to "${renamedUsername}".` : 'Account updated.';
  return jsonResponse({ success: true, message });
});
