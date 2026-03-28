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
 * Required settings in DB: xero_client_id
 * Owner must register the callback URL in their Xero app:
 *   https://<your-app-domain>/api/xero/callback
 */
export async function GET(request: Request) {
  const cookieStore = await cookies()

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

  // Read client_id from settings using service role (secure)
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

  // Store state in a short-lived cookie (5 min)
  const response = NextResponse.redirect(buildXeroAuthUrl(
    settings['xero_client_id'],
    buildRedirectUri(request),
    state
  ))
  response.cookies.set('xero_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 300, // 5 minutes
    path: '/',
    sameSite: 'lax',
  })

  return response
}

/** Builds the Xero OAuth authorization URL */
function buildXeroAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'accounting.transactions offline_access',
    state,
  })
  return `https://login.xero.com/identity/connect/authorize?${params.toString()}`
}

/** Constructs the OAuth callback URL from the current request origin */
function buildRedirectUri(request: Request): string {
  const url = new URL(request.url)
  return `${url.origin}/api/xero/callback`
}
