// Port of Code.gs's saveBase64Image_ (Code.gs:3572) — parses a
// data:<mime>;base64,<data> URI and uploads it, now to Supabase Storage
// instead of a Drive folder. Same 8MB cap as MAX_IMAGE_BYTES.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const DOCUMENTS_BUCKET = 'applicant-documents';

export function estimateBase64Bytes(dataUri: string | null | undefined): number {
  if (!dataUri) return 0;
  const commaIndex = dataUri.indexOf(',');
  const base64Part = commaIndex >= 0 ? dataUri.slice(commaIndex + 1) : dataUri;
  return Math.floor(base64Part.length * 0.75);
}

// Returns the final storage path (base path + extension inferred from the
// data URI's MIME type) so the caller can persist exactly what was stored.
export async function uploadBase64File(supabaseAdmin: SupabaseClient, dataUri: string, basePath: string): Promise<string> {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUri);
  if (!match) {
    throw new Error(`Invalid image data for ${basePath}`);
  }
  const contentType = match[1];
  const base64Data = match[2];
  const extension = contentType.split('/')[1] || 'jpg';
  const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const fullPath = `${basePath}.${extension}`;

  const { error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).upload(fullPath, bytes, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(`Failed to upload ${basePath}: ${error.message}`);
  }
  return fullPath;
}
