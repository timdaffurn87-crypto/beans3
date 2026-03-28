import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * GET /api/xero/callback
 * Handles the OAuth callback from Xero after the owner grants access.
 * Exchanges the authorization code for tokens, gets the tenant ID,
 * then stores both in the settings table.
 *
 * Requires XERO_REDIRECT_URI env var — must match exactly what's in the Xero app
 * and what was sent in the /api/xero/auth request.
 */
export async function GET(request: Request) {
  const cookieStore = await cookies()
  const url = new URL(request.url)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  // Redirect back to settings — using NEXT_PUBLIC_APP_URL if set, otherwise
  // fall back to the origin derived from the Xero redirect URI env var
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.XERO_REDIRECT_URI?.replace('/api/xero/callback', '')
    ?? 'https://beans3.vercel.app'
  const settingsUrl = `${appUrl.replace(/\/$/, '')}/admin/settings`

  // Handle Xero-side errors (e.g. user clicked Cancel)
  if (error) {
    return NextResponse.redirect(`${settingsUrl}?xero=cancelled`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}?xero=error&msg=missing_params`)
  }

  // Verify CSRF state matches what we stored in cookie
  const storedState = cookieStore.get('xero_oauth_state')?.value
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(`${settingsUrl}?xero=error&msg=state_mismatch`)
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
    return NextResponse.redirect(`${settingsUrl}?xero=error&msg=unauthorized`)
  }

  // Read client credentials using service role
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: rows } = await adminSupabase
    .from('settings')
    .select('key, value')
    .in('key', ['xero_client_id', 'xero_client_secret'])

  const creds: Record<string, string> = {}
  for (const row of rows ?? []) creds[row.key] = row.value

  if (!creds['xero_client_id'] || !creds['xero_client_secret']) {
    return NextResponse.redirect(`${settingsUrl}?xero=error&msg=missing_credentials`)
  }

  // Must use the exact same redirect_uri that was sent in the auth request
  const redirectUri = process.env.XERO_REDIRECT_URI
  if (!redirectUri) {
    return NextResponse.redirect(`${settingsUrl}?xero=error&msg=missing_redirect_uri_env`)
  }

  try {
    // Exchange authorization code for access + refresh tokens
    const tokenRes = await exchangeCodeForTokens(
      creds['xero_client_id'],
      creds['xero_client_secret'],
      code,
      redirectUri
    )

    // Get the connected tenant (organisation) ID
    const tenantId = await getFirstTenantId(tokenRes.access_token)

    if (!tenantId) {
      return NextResponse.redirect(`${settingsUrl}?xero=error&msg=no_tenant`)
    }

    // Store refresh_token and tenant_id securely in settings
    const now = new Date().toISOString()
    await adminSupabase.from('settings').upsert([
      { key: 'xero_refresh_token', value: tokenRes.refresh_token, updated_at: now },
      { key: 'xero_tenant_id', value: tenantId, updated_at: now },
    ], { onConflict: 'key' })

    // Clear the state cookie and redirect to settings with success indicator
    const response = NextResponse.redirect(`${settingsUrl}?xero=connected`)
    response.cookies.delete('xero_oauth_state')
    return response

  } catch (err) {
    console.error('Xero OAuth error:', err)
    const msg = err instanceof Error ? encodeURIComponent(err.message) : 'unknown'
    return NextResponse.redirect(`${settingsUrl}?xero=error&msg=${msg}`)
  }
}

/** Exchange authorization code for access/refresh tokens at Xero token endpoint */
async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string }> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${body}`)
  }

  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  }
}

/** Fetches the Xero connections and returns the first tenant ID */
async function getFirstTenantId(accessToken: string): Promise<string | null> {
  const res = await fetch('https://api.xero.com/connections', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`Failed to get Xero connections: ${res.status}`)
  }

  const connections = await res.json()
  if (!Array.isArray(connections) || connections.length === 0) {
    return null
  }

  // Return the first connected organisation's tenant ID
  return connections[0].tenantId as string
}
