// Port of Code.gs's getSessionInfo() (Code.gs:857). Used by
// Index.html:2133-2147 to restore a session from client storage on page
// load. Note the token itself is never echoed back in the response — it's
// already known client-side (that's what's being validated).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireSession, AuthError } from '../_shared/session.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false }, 400);
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const session = await requireSession(supabaseAdmin, body.token);
    return jsonResponse({ success: true, role: session.role, fullName: session.fullName, username: session.username });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ success: false });
    throw err;
  }
});
