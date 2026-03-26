import { createBrowserClient } from '@supabase/ssr'

/** Creates a Supabase browser client — use in Client Components and hooks */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
