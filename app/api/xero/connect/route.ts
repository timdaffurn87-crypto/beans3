/**
 * app/api/xero/connect/route.ts
 *
 * GET /api/xero/connect
 *
 * Starts the Xero OAuth 2.0 flow. Redirects the owner's browser to Xero's
 * authorisation screen. After the owner approves, Xero redirects back to
 * /api/xero/callback with a code that we exchange for access + refresh tokens.
 *
 * Required env vars (set in Vercel + Supabase secrets):
 *   XERO_CLIENT_ID       — from Xero developer portal → My Apps → app → Client ID
 *   XERO_REDIRECT_URI    — must match exactly what's registered in Xero app
 *                          e.g. https://beans3.vercel.app/api/xero/callback
 *
 * Owner only — other roles cannot initiate an OAuth connection.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()

  // Authenticate and check owner role
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

  if (!profile || profile.role !== 'owner') {
    return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  }

  const clientId     = process.env.XERO_CLIENT_ID
  const redirectUri  = process.env.XERO_REDIRECT_URI

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'XERO_CLIENT_ID and XERO_REDIRECT_URI must be set in environment variables' },
      { status: 500 }
    )
  }

  // Build the Xero OAuth authorisation URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  redirectUri,
    scope:         'openid profile email accounting.transactions accounting.contacts offline_access',
    state:         'beans', // must match xero-auth-callback edge function check
  })

  const xeroAuthUrl = `https://login.xero.com/identity/connect/authorize?${params.toString()}`
  return NextResponse.redirect(xeroAuthUrl)
}
