// =============================================================================
// xero-invoice-batch — Supabase Edge Function
// =============================================================================
// Runs daily via Supabase cron at 05:00 UTC (15:00 AEST / 16:00 AEDT).
// Also triggered manually via POST /api/xero/sync from the invoice page.
//
// Pulls all invoices with xero_sync_status = 'pending' for today's café day,
// maps them to Xero ACCPAY bills, and posts them to the Xero Invoices API.
//
// After the API call it also generates a Xero-format CSV (one row per line
// item) and saves it to the "xero-csv-exports" Supabase Storage bucket for
// audit purposes — useful if manual re-import is ever needed.
//
// Cron schedule: 0 5 * * *
// Set in: Supabase Dashboard → Edge Functions → xero-invoice-batch → Cron
//
// GST handling (invoice-level tax_type):
//   'INCLUSIVE' → LineAmountTypes=INCLUSIVE, TaxType=INPUT
//   'EXCLUSIVE' → LineAmountTypes=EXCLUSIVE, TaxType=INPUT
//   'NOTAX'     → LineAmountTypes=NOTAX,     TaxType=NONE
//   null + gst_flagged=true → xero_sync_status='review', SKIPPED
//
// On success: sets xero_sync_status='synced', xero_invoice_id, xero_synced_at
// On failure: sets xero_sync_status='failed'
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** Maximum invoices per Xero API batch call */
const BATCH_SIZE = 50

// ─── Xero CSV column headers (exact order required for manual import) ─────────
const XERO_CSV_HEADERS = [
  '*ContactName', 'EmailAddress',
  'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4',
  'POCity', 'PORegion', 'POPostalCode', 'POCountry',
  '*InvoiceNumber', '*InvoiceDate', '*DueDate',
  'InventoryItemCode', 'Description',
  '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType',
  'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2',
  'Currency',
]

// ─── Token refresh (inlined — edge functions cannot import sibling functions) ──

/**
 * Returns a valid Xero access token, refreshing it first if it expires
 * within the next 5 minutes. Updates xero_tokens with the new tokens.
 */
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
  const fiveMin    = 5 * 60 * 1000
  const needsRefresh = Date.now() >= expiresAt - fiveMin

  if (!needsRefresh) {
    return { access_token: row.access_token, tenant_id: row.tenant_id }
  }

  // Refresh the token
  const clientId     = Deno.env.get('XERO_CLIENT_ID')!
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
  const credentials  = btoa(`${clientId}:${clientSecret}`)

  const res = await fetch('https://identity.xero.com/connect/token', {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
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

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Verify caller passes the service role key as a bearer token
  const authHeader     = req.headers.get('Authorization') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    // Compute today's café day date in AEST (UTC+10 fixed offset)
    const aestNow = new Date(Date.now() + 10 * 60 * 60 * 1000)
    const cafeDay = aestNow.toISOString().split('T')[0]

    console.log(`xero-invoice-batch: processing café day ${cafeDay}`)

    // Fetch all pending invoices for today's café day
    const { data: invoices, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('cafe_day', cafeDay)
      .eq('xero_sync_status', 'pending')
      .not('line_items', 'is', null)

    if (fetchError) throw new Error(`Failed to fetch invoices: ${fetchError.message}`)
    if (!invoices || invoices.length === 0) {
      console.log('No pending invoices to sync.')
      return new Response(JSON.stringify({ success: true, synced: 0, skipped: 0, failed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Separate invoices that need GST review
    const toSync = invoices.filter(inv =>
      !(inv.gst_flagged === true && inv.tax_type === null) &&
      Array.isArray(inv.line_items) && inv.line_items.length > 0
    )
    const skippedFlagged = invoices.filter(inv => inv.gst_flagged === true && inv.tax_type === null)

    if (skippedFlagged.length > 0) {
      console.log(`Skipping ${skippedFlagged.length} flagged invoices — GST type needs review`)
    }

    if (toSync.length === 0) {
      return new Response(
        JSON.stringify({ success: true, synced: 0, skipped: skippedFlagged.length, failed: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get a valid Xero access token (refreshes automatically if needed)
    const { access_token, tenant_id } = await getValidXeroToken(supabase)

    let totalSynced = 0
    let totalFailed = 0
    const failedInvoiceIds: string[] = []

    // ── JSON API posting ───────────────────────────────────────────────────
    for (let i = 0; i < toSync.length; i += BATCH_SIZE) {
      const batch       = toSync.slice(i, i + BATCH_SIZE)
      const xeroInvoices = batch.map(inv => mapToXeroInvoice(inv))

      const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
        method:  'POST',
        headers: {
          'Authorization':  `Bearer ${access_token}`,
          'Xero-Tenant-Id': tenant_id,
          'Content-Type':   'application/json',
          'Accept':         'application/json',
        },
        body: JSON.stringify({ Invoices: xeroInvoices }),
      })

      if (!res.ok) {
        const body = await res.text()
        console.error(`Xero batch API error: ${res.status} — ${body}`)
        for (const inv of batch) {
          await supabase.from('invoices')
            .update({ xero_sync_status: 'failed' })
            .eq('id', inv.id)
          failedInvoiceIds.push(inv.id)
          totalFailed++
        }
        continue
      }

      const data             = await res.json()
      const returnedInvoices = (data?.Invoices ?? []) as Array<{
        InvoiceID: string
        HasErrors: boolean
        ValidationErrors?: Array<{ Message: string }>
      }>

      for (let j = 0; j < batch.length; j++) {
        const inv      = batch[j]
        const returned = returnedInvoices[j]

        if (!returned || returned.HasErrors) {
          const errs = (returned?.ValidationErrors ?? []).map((e: { Message: string }) => e.Message).join('; ')
          console.error(`Invoice ${inv.id} failed: ${errs}`)
          await supabase.from('invoices')
            .update({ xero_sync_status: 'failed' })
            .eq('id', inv.id)
          failedInvoiceIds.push(inv.id)
          totalFailed++
        } else {
          await supabase.from('invoices')
            .update({
              xero_sync_status: 'synced',
              xero_invoice_id:  returned.InvoiceID,
              xero_synced_at:   new Date().toISOString(),
            })
            .eq('id', inv.id)
          totalSynced++
        }
      }
    }

    // ── CSV export (audit backup) ──────────────────────────────────────────
    try {
      const csvContent = buildXeroCsv(toSync)
      const csvBytes   = new TextEncoder().encode(csvContent)

      await supabase.storage
        .from('xero-csv-exports')
        .upload(`${cafeDay}.csv`, csvBytes, { contentType: 'text/csv', upsert: true })

      console.log(`xero-invoice-batch: CSV saved to xero-csv-exports/${cafeDay}.csv`)
    } catch (csvErr) {
      const msg = csvErr instanceof Error ? csvErr.message : String(csvErr)
      console.warn(`xero-invoice-batch: CSV export failed (non-fatal): ${msg}`)
    }

    const result = {
      success:    true,
      cafe_day:   cafeDay,
      synced:     totalSynced,
      skipped:    skippedFlagged.length,
      failed:     totalFailed,
      failed_ids: failedInvoiceIds,
    }
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

function mapToXeroInvoice(inv: Record<string, unknown>): Record<string, unknown> {
  const taxType     = inv.tax_type as string | null
  const lineAmounts = taxType === 'NOTAX' ? 'NOTAX' : taxType === 'INCLUSIVE' ? 'INCLUSIVE' : 'EXCLUSIVE'
  const lineTaxType = taxType === 'NOTAX' ? 'NONE' : 'INPUT'

  const lineItems = (inv.line_items as Array<{
    description: string
    quantity: number
    unit_amount: number
    account_code?: string
    inventory_item_code?: string
  }>).map(item => ({
    Description: item.description,
    Quantity:    item.quantity,
    UnitAmount:  item.unit_amount,
    AccountCode: item.account_code || '310',
    TaxType:     lineTaxType,
    ...(item.inventory_item_code?.trim() ? { ItemCode: item.inventory_item_code.trim() } : {}),
  }))

  return {
    Type:            'ACCPAY',
    Contact:         { Name: inv.supplier_name },
    ...(inv.supplier_email    ? { EmailAddress:  inv.supplier_email }    : {}),
    ...(inv.reference_number  ? { InvoiceNumber: inv.reference_number }  : {}),
    ...(inv.invoice_date      ? { Date:          inv.invoice_date }      : {}),
    ...(inv.due_date          ? { DueDate:       inv.due_date }          : {}),
    LineAmountTypes: lineAmounts,
    LineItems:       lineItems,
    CurrencyCode:    'AUD',
    Status:          'DRAFT',
  }
}

function buildXeroCsv(invoices: Record<string, unknown>[]): string {
  function csvCell(value: string | number | null | undefined): string {
    const str = value === null || value === undefined ? '' : String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const rows: string[] = [XERO_CSV_HEADERS.join(',')]

  for (const inv of invoices) {
    const taxType    = inv.tax_type as string | null
    const csvTaxType = taxType === 'NOTAX' ? 'GST Free Expenses' : 'GST on Expenses'

    const lineItems = inv.line_items as Array<{
      description: string
      quantity: number
      unit_amount: number
      account_code?: string
      inventory_item_code?: string
    }>

    for (const item of lineItems) {
      rows.push([
        csvCell(inv.supplier_name as string),
        csvCell(inv.supplier_email as string),
        '', '', '', '', '', '', '', '',
        csvCell(inv.reference_number as string),
        csvCell(inv.invoice_date as string),
        csvCell(inv.due_date as string),
        csvCell(item.inventory_item_code || ''),
        csvCell(item.description),
        csvCell(item.quantity),
        csvCell(item.unit_amount),
        csvCell(item.account_code || '310'),
        csvCell(csvTaxType),
        '', '', '', '',
        'AUD',
      ].join(','))
    }
  }

  return rows.join('\n')
}
