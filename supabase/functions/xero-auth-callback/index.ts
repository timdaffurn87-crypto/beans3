// =============================================================================
// xero-auth-callback — Supabase Edge Function
// =============================================================================
//
// ONE-TIME SETUP INSTRUCTIONS
// ───────────────────────────
// 1. Add these secrets in Supabase → Edge Functions → Secrets:
//      XERO_CLIENT_ID      (from Xero developer portal → your app → Client ID)
//      XERO_CLIENT_SECRET  (from Xero developer portal → your app → Client Secret)
//      XERO_REDIRECT_URI   (this Edge Function's URL — see below)
//
// 2. Your XERO_REDIRECT_URI is:
//      https://<your-supabase-project-ref>.supabase.co/functions/v1/xero-auth-callback
//    Register this exact URL in your Xero app under "Redirect URIs".
//
// 3. Visit this URL once in a browser (replace CLIENT_ID and REDIRECT_URI):
//      https://login.xero.com/identity/connect/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=REDIRECT_URI&state=beans
//
// 4. Authorise in Xero. You will be redirected back to this Edge Function.
//    It will exchange the code for tokens and save them to the xero_tokens table.
//    A success message will confirm the tenant ID that was saved.
//
// 5. To verify: check the xero_tokens table in Supabase — one row should exist.
//
// CRON SCHEDULE (for xero-invoice-batch)
// ───────────────────────────────────────
// In Supabase → Edge Functions → xero-invoice-batch → Cron:
//   Schedule: 0 5 * * *   (05:00 UTC = 15:00 AEST = 16:00 AEDT every day)
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  // Handle user cancellation
  if (error) {
    return htmlResponse('❌ Xero Connection Cancelled', `Xero returned: ${error}`, 400)
  }

  if (!code) {
    return htmlResponse('❌ Missing Code', 'No authorization code received from Xero.', 400)
  }

  // Simple state check — the setup URL uses state=beans
  if (state !== 'beans') {
    return htmlResponse('❌ State Mismatch', 'Invalid state parameter. Use state=beans in the auth URL.', 400)
  }

  const clientId     = Deno.env.get('XERO_CLIENT_ID')
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')
  const redirectUri  = Deno.env.get('XERO_REDIRECT_URI')

  if (!clientId || !clientSecret || !redirectUri) {
    return htmlResponse('❌ Missing Secrets', 'XERO_CLIENT_ID, XERO_CLIENT_SECRET, and XERO_REDIRECT_URI must be set as Supabase secrets.', 500)
  }

  try {
    // Exchange authorization code for tokens
    const credentials = btoa(`${clientId}:${clientSecret}`)
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
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

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      throw new Error(`Token exchange failed: ${tokenRes.status} — ${body}`)
    }

    const tokens = await tokenRes.json()
    const accessToken  = tokens.access_token  as string
    const refreshToken = tokens.refresh_token as string
    // expires_in is seconds; Xero access tokens last 30 minutes
    const expiresAt = new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()

    // Get the connected Xero organisation (tenant) ID
    const connectionsRes = await fetch('https://api.xero.com/connections', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!connectionsRes.ok) {
      throw new Error(`Failed to get Xero connections: ${connectionsRes.status}`)
    }

    const connections = await connectionsRes.json() as Array<{ tenantId: string; tenantName: string }>
    if (!connections.length) {
      throw new Error('No Xero organisations found. Make sure you authorise an organisation, not just a user.')
    }

    const tenantId   = connections[0].tenantId
    const tenantName = connections[0].tenantName

    // Save tokens to Supabase using service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Delete any previous connection and insert fresh row
    await supabase.from('xero_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    const { error: insertError } = await supabase.from('xero_tokens').insert({
      access_token:  accessToken,
      refresh_token: refreshToken,
      expires_at:    expiresAt,
      tenant_id:     tenantId,
      updated_at:    new Date().toISOString(),
    })

    if (insertError) throw new Error(`DB save failed: ${insertError.message}`)

    return htmlResponse(
      '✅ Xero Connected',
      `Successfully connected to <strong>${tenantName}</strong>.<br><br>Tenant ID: <code>${tenantId}</code><br><br>Invoices will now sync to Xero automatically at the end of each café day.`,
      200
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('xero-auth-callback error:', msg)
    return htmlResponse('❌ Connection Failed', msg, 500)
  }
})

/** Returns a simple HTML response for the one-time browser auth flow */
function htmlResponse(title: string, body: string, status: number): Response {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;background:#FAF8F3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:16px;padding:32px;max-width:480px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
h1{margin:0 0 16px;font-size:22px}p{color:#555;line-height:1.5}code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:13px}</style>
</head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body>
</html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html' } })
}
