// Port of Code.gs's logout() (Code.gs:811). Called fire-and-forget by
// Index.html:2128 — the client already clears its own local session state
// before this resolves, so failures here are non-fatal on the client side.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false }, 400);
  }

  if (body.token) {
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    await supabaseAdmin.from('sessions').delete().eq('token', body.token);
  }

  return jsonResponse({ success: true });
});
