import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * GET /api/xero/status
 * Returns the Xero connection status for the settings page.
 * Only owner can call this. Uses service role to read sensitive keys.
 *
 * Response:
 *   { connected: true, clientIdConfigured: true, clientSecretConfigured: true }
 *   { connected: false, clientIdConfigured: false, clientSecretConfigured: false }
 */
export async function GET() {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  }

  // Use service role to check which Xero keys exist
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: rows } = await adminSupabase
    .from('settings')
    .select('key')
    .in('key', ['xero_client_id', 'xero_client_secret', 'xero_refresh_token', 'xero_tenant_id'])

  const keys = new Set((rows ?? []).map(r => r.key))

  return NextResponse.json({
    connected: keys.has('xero_refresh_token') && keys.has('xero_tenant_id'),
    clientIdConfigured: keys.has('xero_client_id'),
    clientSecretConfigured: keys.has('xero_client_secret'),
  })
}
