import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Trim defends against the most common cause of "Invalid supabaseUrl" /
// malformed-header errors: trailing whitespace or a newline picked up when
// copy-pasting the value into a dashboard's env var field.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in ' +
      '(or, on Cloudflare Pages, set them under Settings > Environment variables and redeploy).',
  )
}

if (!isValidHttpUrl(supabaseUrl)) {
  throw new Error(
    `VITE_SUPABASE_URL is not a valid http(s) URL: "${supabaseUrl}". Check for a typo, stray character, or ` +
      'missing "https://" wherever it was set (.env.local, or Cloudflare Pages env vars).',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
