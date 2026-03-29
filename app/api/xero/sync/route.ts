/**
 * app/api/xero/sync/route.ts
 *
 * POST /api/xero/sync
 *
 * Manually triggers the xero-invoice-batch Supabase Edge Function,
 * processing all pending invoices for today's café day right now
 * rather than waiting for the 3 PM scheduled run.
 *
 * Manager/Owner only — baristas cannot trigger Xero syncs.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST() {
  const cookieStore = await cookies()

  // Authenticate and check role
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

  if (!profile || !['manager', 'owner'].includes(profile.role)) {
    return NextResponse.json({ error: 'Manager or owner access required' }, { status: 403 })
  }

  // Invoke the edge function using the service role key as the bearer token
  // so the function's own auth check passes
  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-invoice-batch`

  const res = await fetch(edgeFnUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
  })

  const body = await res.json().catch(() => ({ error: 'Invalid response from sync function' }))

  if (!res.ok) {
    return NextResponse.json(
      { error: body.error ?? `Edge function returned ${res.status}` },
      { status: 502 }
    )
  }

  return NextResponse.json(body)
}
