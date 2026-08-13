// Port of Code.gs's getBarangays (Code.gs:242). Public — no auth.
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { PSGC_API_BASE, fetchPsgcList } from '../_shared/psgc.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { municipalityCode?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.', barangays: [] }, 400);
  }

  const { municipalityCode } = body;
  if (!municipalityCode) {
    return jsonResponse({ success: false, message: 'Missing municipality/city.', barangays: [] });
  }

  const result = await fetchPsgcList(
    `${PSGC_API_BASE}cities-municipalities/${municipalityCode}/barangays/`,
    'Address service unavailable — please type your barangay.'
  );
  return jsonResponse({ success: result.success, message: result.message, barangays: result.items });
});
