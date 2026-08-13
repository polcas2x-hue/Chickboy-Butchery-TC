// Port of Code.gs's MINDANAO_PROVINCES + findMindanaoProvinceByCode_
// (Code.gs:127-194), shared by get-municipalities and get-barangays.
export const PSGC_API_BASE = 'https://psgc.gitlab.io/api/';

export interface MindanaoProvince {
  name: string;
  code: string;
  isHuc?: boolean;
}

export const MINDANAO_PROVINCES: MindanaoProvince[] = [
  { name: 'Zamboanga del Norte', code: '097200000' },
  { name: 'Zamboanga del Sur', code: '097300000' },
  { name: 'Zamboanga Sibugay', code: '098300000' },
  { name: 'Zamboanga City', code: '097332000', isHuc: true },
  { name: 'Bukidnon', code: '101300000' },
  { name: 'Camiguin', code: '101800000' },
  { name: 'Lanao del Norte', code: '103500000' },
  { name: 'Misamis Occidental', code: '104200000' },
  { name: 'Misamis Oriental', code: '104300000' },
  { name: 'Cagayan de Oro', code: '104305000', isHuc: true },
  { name: 'Iligan', code: '103504000', isHuc: true },
  { name: 'Davao del Norte', code: '112300000' },
  { name: 'Davao del Sur', code: '112400000' },
  { name: 'Davao Oriental', code: '112500000' },
  { name: 'Davao de Oro', code: '118200000' },
  { name: 'Davao Occidental', code: '118600000' },
  { name: 'Davao City', code: '112402000', isHuc: true },
  { name: 'Cotabato', code: '124700000' },
  { name: 'South Cotabato', code: '126300000' },
  { name: 'Sultan Kudarat', code: '126500000' },
  { name: 'Sarangani', code: '128000000' },
  { name: 'General Santos', code: '126303000', isHuc: true },
  { name: 'Agusan del Norte', code: '160200000' },
  { name: 'Agusan del Sur', code: '160300000' },
  { name: 'Surigao del Norte', code: '166700000' },
  { name: 'Surigao del Sur', code: '166800000' },
  { name: 'Dinagat Islands', code: '168500000' },
  { name: 'Butuan', code: '160202000', isHuc: true },
  { name: 'Basilan', code: '150700000' },
  { name: 'Lanao del Sur', code: '153600000' },
  { name: 'Maguindanao', code: '153800000' },
  { name: 'Sulu', code: '156600000' },
  { name: 'Tawi-Tawi', code: '157000000' },
];

export function findMindanaoProvinceByCode(code: string): MindanaoProvince | null {
  return MINDANAO_PROVINCES.find((p) => p.code === code) ?? null;
}

export interface PsgcItem {
  code: string;
  name: string;
}

// Code.gs cached results in CacheService for PSGC_CACHE_SECONDS (6h) —
// Edge Functions are stateless between invocations, so this simplification
// skips that cache and fetches PSGC live each time. PSGC's own response
// times are fast enough at this app's traffic volume; add a cache table
// later if it ever becomes worth it.
export async function fetchPsgcList(url: string, notFoundMessage: string): Promise<{ success: boolean; items: PsgcItem[]; message?: string }> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { success: false, items: [], message: notFoundMessage };
    }
    const data = (await res.json()) as Array<{ code: string; name: string }>;
    const items = data.map((item) => ({ code: item.code, name: item.name })).sort((a, b) => a.name.localeCompare(b.name));
    return { success: true, items };
  } catch {
    return { success: false, items: [], message: notFoundMessage };
  }
}
