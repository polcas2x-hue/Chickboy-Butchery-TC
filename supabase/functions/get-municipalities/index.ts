// Port of Code.gs's getMunicipalities (Code.gs:202). Public — no auth,
// applicants use this while filling out the form before logging in.
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { PSGC_API_BASE, findMindanaoProvinceByCode, fetchPsgcList } from '../_shared/psgc.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { provinceCode?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.', municipalities: [] }, 400);
  }

  const { provinceCode } = body;
  if (!provinceCode) {
    return jsonResponse({ success: false, message: 'Missing province.', municipalities: [] });
  }

  const province = findMindanaoProvinceByCode(provinceCode);
  if (province?.isHuc) {
    return jsonResponse({ success: true, municipalities: [{ code: province.code, name: province.name }] });
  }

  const result = await fetchPsgcList(
    `${PSGC_API_BASE}provinces/${provinceCode}/cities-municipalities/`,
    'Address service unavailable — please type your municipality/city.'
  );
  return jsonResponse({ success: result.success, message: result.message, municipalities: result.items });
});
