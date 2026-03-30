// =============================================================================
// xero-invoice-batch — Supabase Edge Function
// =============================================================================
// Runs daily via Supabase cron at 05:00 UTC (15:00 AEST / 16:00 AEDT).
// Also triggered manually via POST /api/xero/sync from the invoice page.
//
// For each pending/failed invoice today:
//   1. Ensures the supplier contact exists in Xero (creates it if not)
//   2. Pushes the invoice as a DRAFT ACCPAY bill
//   3. Marks xero_sync_status = 'synced' or 'failed'
//
// GST is handled entirely by Xero's chart of accounts — we always send
// LineAmountTypes=EXCLUSIVE and let Xero apply the correct tax rate per
// account code. No GST review/flagging in Beans.
//
// Cron schedule: 0 5 * * *
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Token refresh (inlined — edge functions cannot import sibling functions) ──

async function getValidXeroToken(
  supabase: ReturnType<typeof createClient>
): Promise<{ access_token: string; tenant_id: string }> {
  const { data: row, error } = await supabase
    .from('xero_tokens')
    .select('*')
    .single()

  if (error || !row) {
    throw new Error('Xero not connected. Go to Settings → Xero Integration to connect your account.')
  }

  const expiresAt  = new Date(row.expires_at).getTime()
  const needsRefresh = Date.now() >= expiresAt - 5 * 60 * 1000

  if (!needsRefresh) {
    return { access_token: row.access_token, tenant_id: row.tenant_id }
  }

  const clientId     = Deno.env.get('XERO_CLIENT_ID')!
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!

  const res = await fetch('https://identity.xero.com/connect/token', {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: row.refresh_token,
    }).toString(),
  })

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} — ${await res.text()}`)
  }

  const tokens = await res.json()
  const newExpiresAt = new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString()

  await supabase.from('xero_tokens').update({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at:    newExpiresAt,
    updated_at:    new Date().toISOString(),
  }).eq('id', row.id)

  return { access_token: tokens.access_token, tenant_id: row.tenant_id }
}

// ─── Contact upsert ───────────────────────────────────────────────────────────

/**
 * Ensures a Xero contact exists for the given supplier name.
 * Searches by name first — creates if not found.
 * Returns the ContactID.
 */
async function ensureXeroContact(
  supplierName: string,
  supplierEmail: string | null,
  accessToken: string,
  tenantId: string
): Promise<string> {
  const headers = {
    'Authorization':  `Bearer ${accessToken}`,
    'Xero-Tenant-Id': tenantId,
    'Content-Type':   'application/json',
    'Accept':         'application/json',
  }

  // Search for existing contact by name
  const searchRes = await fetch(
    `https://api.xero.com/api.xro/2.0/Contacts?where=Name%3D%3D%22${encodeURIComponent(supplierName)}%22`,
    { headers }
  )

  if (searchRes.ok) {
    const data = await searchRes.json() as { Contacts: { ContactID: string }[] }
    if (data.Contacts?.length > 0) {
      return data.Contacts[0].ContactID
    }
  }

  // Contact not found — create it
  const createRes = await fetch('https://api.xero.com/api.xro/2.0/Contacts', {
    method:  'POST',
    headers,
    body: JSON.stringify({
      Contacts: [{
        Name: supplierName,
        IsSupplier: true,
        ...(supplierEmail ? { EmailAddress: supplierEmail } : {}),
      }],
    }),
  })

  if (!createRes.ok) {
    throw new Error(`Failed to create Xero contact for "${supplierName}": ${await createRes.text()}`)
  }

  const created = await createRes.json() as { Contacts: { ContactID: string }[] }
  const contactId = created.Contacts?.[0]?.ContactID

  if (!contactId) throw new Error(`Xero returned no ContactID when creating "${supplierName}"`)

  console.log(`Created Xero contact: ${supplierName} → ${contactId}`)
  return contactId
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request) => {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    const aestNow = new Date(Date.now() + 10 * 60 * 60 * 1000)
    const cafeDay = aestNow.toISOString().split('T')[0]

    console.log(`xero-invoice-batch: processing café day ${cafeDay}`)

    // Fetch pending and previously-failed invoices (failed = retry on manual trigger)
    const { data: invoices, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('cafe_day', cafeDay)
      .in('xero_sync_status', ['pending', 'failed'])
      .not('line_items', 'is', null)

    if (fetchError) throw new Error(`Failed to fetch invoices: ${fetchError.message}`)

    if (!invoices || invoices.length === 0) {
      return new Response(JSON.stringify({ success: true, synced: 0, skipped: 0, failed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Filter to invoices that have at least one line item
    const toSync = invoices.filter(inv =>
      Array.isArray(inv.line_items) && inv.line_items.length > 0
    )

    if (toSync.length === 0) {
      return new Response(JSON.stringify({ success: true, synced: 0, skipped: 0, failed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { access_token, tenant_id } = await getValidXeroToken(supabase)

    let totalSynced = 0
    let totalFailed = 0
    const failedInvoiceIds: string[] = []

    // Push one invoice at a time so contact creation works per-supplier
    for (const inv of toSync) {
      try {
        // Ensure the supplier exists as a Xero contact (creates if missing)
        const contactId = await ensureXeroContact(
          inv.supplier_name as string,
          inv.supplier_email as string | null,
          access_token,
          tenant_id
        )

        const xeroInvoice = mapToXeroInvoice(inv, contactId)

        const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
          method:  'POST',
          headers: {
            'Authorization':  `Bearer ${access_token}`,
            'Xero-Tenant-Id': tenant_id,
            'Content-Type':   'application/json',
            'Accept':         'application/json',
          },
          body: JSON.stringify({ Invoices: [xeroInvoice] }),
        })

        const data = await res.json() as {
          Invoices?: Array<{
            InvoiceID: string
            HasErrors: boolean
            ValidationErrors?: Array<{ Message: string }>
          }>
        }

        const returned = data.Invoices?.[0]

        if (!res.ok || !returned || returned.HasErrors) {
          const errs = (returned?.ValidationErrors ?? []).map(e => e.Message).join('; ')
          const httpErr = !res.ok ? `HTTP ${res.status}` : ''
          throw new Error([httpErr, errs].filter(Boolean).join(' — '))
        }

        await supabase.from('invoices').update({
          xero_sync_status: 'synced',
          xero_invoice_id:  returned.InvoiceID,
          xero_synced_at:   new Date().toISOString(),
        }).eq('id', inv.id)

        totalSynced++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`Invoice ${inv.id} (${inv.supplier_name}) failed: ${msg}`)

        await supabase.from('invoices')
          .update({ xero_sync_status: 'failed' })
          .eq('id', inv.id)

        failedInvoiceIds.push(inv.id as string)
        totalFailed++
      }
    }

    // CSV audit export (non-fatal)
    try {
      const csvBytes = new TextEncoder().encode(buildXeroCsv(toSync))
      await supabase.storage
        .from('xero-csv-exports')
        .upload(`${cafeDay}.csv`, csvBytes, { contentType: 'text/csv', upsert: true })
    } catch (csvErr) {
      console.warn(`CSV export failed (non-fatal): ${csvErr instanceof Error ? csvErr.message : csvErr}`)
    }

    const result = { success: true, cafe_day: cafeDay, synced: totalSynced, skipped: 0, failed: totalFailed, failed_ids: failedInvoiceIds }
    console.log('xero-invoice-batch complete:', result)
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('xero-invoice-batch error:', msg)
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Maps a Beans invoice to a Xero ACCPAY bill payload.
 * Always sends LineAmountTypes=EXCLUSIVE — Xero applies the correct tax
 * rate automatically based on the chart of accounts (account code).
 * We do not send ItemCode — supplier codes are not Xero inventory codes.
 */
function mapToXeroInvoice(inv: Record<string, unknown>, contactId: string): Record<string, unknown> {
  const lineItems = (inv.line_items as Array<{
    description: string
    quantity: number
    unit_amount: number
    account_code?: string
  }>).map(item => ({
    Description: item.description,
    Quantity:    item.quantity,
    UnitAmount:  item.unit_amount,
    AccountCode: item.account_code || '310',
  }))

  return {
    Type:            'ACCPAY',
    Contact:         { ContactID: contactId },
    LineAmountTypes: 'EXCLUSIVE',
    LineItems:       lineItems,
    CurrencyCode:    'AUD',
    Status:          'DRAFT',
    // Supplier's invoice number goes in Reference (not InvoiceNumber) — Xero auto-numbers the bill.
    // Using InvoiceNumber causes collisions with previously voided/failed attempts.
    ...(inv.reference_number ? { Reference: inv.reference_number } : {}),
    ...(inv.invoice_date     ? { Date:       inv.invoice_date }    : {}),
    ...(inv.due_date         ? { DueDate:    inv.due_date }        : {}),
  }
}

// ─── CSV export (audit backup) ────────────────────────────────────────────────

const XERO_CSV_HEADERS = [
  '*ContactName', 'EmailAddress',
  'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4',
  'POCity', 'PORegion', 'POPostalCode', 'POCountry',
  '*InvoiceNumber', '*InvoiceDate', '*DueDate',
  'Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType',
  'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2',
  'Currency',
]

function buildXeroCsv(invoices: Record<string, unknown>[]): string {
  function csvCell(value: string | number | null | undefined): string {
    const str = value === null || value === undefined ? '' : String(value)
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str
  }

  const rows: string[] = [XERO_CSV_HEADERS.join(',')]

  for (const inv of invoices) {
    const lineItems = inv.line_items as Array<{
      description: string; quantity: number; unit_amount: number; account_code?: string
    }>
    for (const item of lineItems) {
      rows.push([
        csvCell(inv.supplier_name as string),
        csvCell(inv.supplier_email as string),
        '', '', '', '', '', '', '', '',
        csvCell(inv.reference_number as string),
        csvCell(inv.invoice_date as string),
        csvCell(inv.due_date as string),
        csvCell(item.description),
        csvCell(item.quantity),
        csvCell(item.unit_amount),
        csvCell(item.account_code || '310'),
        'GST on Expenses',
        '', '', '', '',
        'AUD',
      ].join(','))
    }
  }

  return rows.join('\n')
}
