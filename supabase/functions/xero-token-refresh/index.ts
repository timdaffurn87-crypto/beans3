// =============================================================================
// xero-token-refresh — Supabase Edge Function
// =============================================================================
// Helper function that returns a valid Xero access token.
// Checks expiry and refreshes automatically if the token is expired or close
// to expiry (within 5 minutes). Updates xero_tokens table with new tokens.
//
// Called internally by xero-invoice-batch and xero-retry-failed.
// Can also be called manually to test the connection.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** Returns { access_token, tenant_id } — refreshing first if needed */
export async function getValidXeroToken(): Promise<{ access_token: string; tenant_id: string }> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: row, error } = await supabase
    .from('xero_tokens')
    .select('*')
    .single()

  if (error || !row) {
    throw new Error('Xero not connected. Run the one-time auth flow first.')
  }

  const expiresAt = new Date(row.expires_at).getTime()
  const fiveMinutes = 5 * 60 * 1000
  const needsRefresh = Date.now() >= expiresAt - fiveMinutes

  if (!needsRefresh) {
    return { access_token: row.access_token, tenant_id: row.tenant_id }
  }

  // Token is expired or about to expire — refresh it
  const clientId     = Deno.env.get('XERO_CLIENT_ID')!
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
  const credentials  = btoa(`${clientId}:${clientSecret}`)

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token refresh failed: ${res.status} — ${body}`)
  }

  const tokens = await res.json()
  const newExpiresAt = new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()

  // Xero rotates refresh tokens — always save the new one immediately
  await supabase.from('xero_tokens').update({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at:    newExpiresAt,
    updated_at:    new Date().toISOString(),
  }).eq('id', row.id)

  return { access_token: tokens.access_token, tenant_id: row.tenant_id }
}

// Also expose as an HTTP endpoint so it can be called manually or by other services
Deno.serve(async () => {
  try {
    const result = await getValidXeroToken()
    return new Response(
      JSON.stringify({ success: true, tenant_id: result.tenant_id }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
