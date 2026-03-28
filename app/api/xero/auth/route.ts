import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * GET /api/xero/auth
 * Initiates the Xero OAuth 2.0 authorization flow.
 * Only accessible by authenticated owners.
 * Redirects the browser to Xero's login/consent screen.
 *
 * Requires XERO_REDIRECT_URI env var set to exactly:
 *   https://beans3.vercel.app/api/xero/callback
 * (must match what's registered in your Xero app)
 */
export async function GET() {
  const cookieStore = await cookies()

  // XERO_REDIRECT_URI must be set in Vercel env vars to avoid any dynamic
  // URL construction that could cause a mismatch with Xero's registered URI
  const redirectUri = process.env.XERO_REDIRECT_URI
  if (!redirectUri) {
    return NextResponse.json(
      { error: 'XERO_REDIRECT_URI environment variable is not set on the server.' },
      { status: 500 }
    )
  }

  // Verify authenticated user
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
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify the user is an owner
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  }

  // Read client_id from settings using service role (bypasses RLS for sensitive keys)
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: rows } = await adminSupabase
    .from('settings')
    .select('key, value')
    .in('key', ['xero_client_id'])

  const settings: Record<string, string> = {}
  for (const row of rows ?? []) settings[row.key] = row.value

  if (!settings['xero_client_id']) {
    return NextResponse.json(
      { error: 'Xero Client ID not configured. Add it in Settings first.' },
      { status: 400 }
    )
  }

  // Generate a random state value for CSRF protection
  const state = crypto.randomUUID()

  // Build the Xero authorization URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: settings['xero_client_id'],
    redirect_uri: redirectUri,
    scope: 'accounting.transactions offline_access',
    state,
  })
  const xeroAuthUrl = `https://login.xero.com/identity/connect/authorize?${params.toString()}`

  // Store state in a short-lived cookie (5 min) for CSRF validation on callback
  const response = NextResponse.redirect(xeroAuthUrl)
  response.cookies.set('xero_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 300,
    path: '/',
    sameSite: 'lax',
  })

  return response
}
