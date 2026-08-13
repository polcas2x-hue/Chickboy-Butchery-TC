// Port of Code.gs's requireSession_/requireRole_ (Code.gs lines 864, 873).
// Every authenticated Edge Function in every phase imports this instead of
// re-deriving the auth check.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface Session {
  userId: string;
  username: string;
  role: string;
  fullName: string;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Mirrors getSession_: a session is invalid once it's past expires_at, OR
// once it was issued at/before the account's sessions_invalid_after marker
// (set by an admin-initiated account change — see 0008_auth_sessions.sql).
export async function requireSession(supabaseAdmin: SupabaseClient, token: string | null | undefined): Promise<Session> {
  if (!token) {
    throw new AuthError('Your session has expired. Please log in again.', 401);
  }

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('sessions')
    .select('user_id, issued_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    throw new AuthError('Your session has expired. Please log in again.', 401);
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, username, role, full_name, active, sessions_invalid_after')
    .eq('id', session.user_id)
    .maybeSingle();

  if (userError || !user || !user.active) {
    throw new AuthError('Your session has expired. Please log in again.', 401);
  }

  if (user.sessions_invalid_after && new Date(session.issued_at).getTime() <= new Date(user.sessions_invalid_after).getTime()) {
    throw new AuthError('Your session has expired. Please log in again.', 401);
  }

  return { userId: user.id, username: user.username, role: user.role, fullName: user.full_name };
}

export async function requireRole(supabaseAdmin: SupabaseClient, token: string | null | undefined, roles: string[]): Promise<Session> {
  const session = await requireSession(supabaseAdmin, token);
  if (roles.indexOf(session.role) === -1) {
    throw new AuthError('You do not have permission to perform this action.', 403);
  }
  return session;
}

// Port of Code.gs's `token ? getSession_(token) : null` pattern used by
// submitApplication (Code.gs:1383) — an optional, non-throwing session
// lookup for endpoints where being logged in changes behavior but isn't
// required (an anonymous applicant vs. Staff submitting on their behalf).
export async function getSessionOrNull(supabaseAdmin: SupabaseClient, token: string | null | undefined): Promise<Session | null> {
  try {
    return await requireSession(supabaseAdmin, token);
  } catch {
    return null;
  }
}
