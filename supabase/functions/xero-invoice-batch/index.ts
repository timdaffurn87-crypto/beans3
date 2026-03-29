// =============================================================================
// xero-invoice-batch — Supabase Edge Function
// =============================================================================
// Runs daily via Supabase cron at 05:00 UTC (15:00 AEST / 16:00 AEDT).
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
import { getValidXeroToken } from '../xero-token-refresh/index.ts'

/** Maximum invoices per Xero API batch call */
const BATCH_SIZE = 50

// ─── Xero CSV column headers (exact order required for manual import) ─────────
const XERO_CSV_HEADERS = [
  '*ContactName',
  'EmailAddress',
  'POAddressLine1',
  'POAddressLine2',
  'POAddressLine3',
  'POAddressLine4',
  'POCity',
  'PORegion',
  'POPostalCode',
  'POCountry',
  '*InvoiceNumber',
  '*InvoiceDate',
  '*DueDate',
  'InventoryItemCode',
  'Description',
  '*Quantity',
  '*UnitAmount',
  '*AccountCode',
  '*TaxType',
  'TrackingName1',
  'TrackingOption1',
  'TrackingName2',
  'TrackingOption2',
  'Currency',
]

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    // Compute today's café day date in AEST (UTC+10)
    // At 05:00 UTC the Australian date is always the same as the UTC date
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

    // Separate invoices that need GST review (flagged + no tax_type)
    const toSync = invoices.filter(inv =>
      !(inv.gst_flagged === true && inv.tax_type === null) &&
      Array.isArray(inv.line_items) && inv.line_items.length > 0
    )
    const skippedFlagged = invoices.filter(inv => inv.gst_flagged === true && inv.tax_type === null)

    if (skippedFlagged.length > 0) {
      console.log(`Skipping ${skippedFlagged.length} flagged invoices — GST type needs review`)
    }

    if (toSync.length === 0) {
      return new Response(JSON.stringify({ success: true, synced: 0, skipped: skippedFlagged.length, failed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get a valid Xero access token (refreshes automatically if needed)
    const { access_token, tenant_id } = await getValidXeroToken()

    let totalSynced = 0
    let totalFailed = 0
    const failedInvoiceIds: string[] = []

    // ── JSON API posting (primary sync mechanism) ──────────────────────────
    for (let i = 0; i < toSync.length; i += BATCH_SIZE) {
      const batch = toSync.slice(i, i + BATCH_SIZE)
      const xeroInvoices = batch.map(inv => mapToXeroInvoice(inv))

      const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Xero-Tenant-Id': tenant_id,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
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

      const data = await res.json()
      const returnedInvoices = data?.Invoices ?? [] as Array<{
        InvoiceID: string
        HasErrors: boolean
        ValidationErrors?: Array<{ Message: string }>
        Status: string
      }>

      // Match returned invoices to our batch by position
      for (let j = 0; j < batch.length; j++) {
        const inv = batch[j]
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
              xero_invoice_id: returned.InvoiceID,
              xero_synced_at: new Date().toISOString(),
            })
            .eq('id', inv.id)
          totalSynced++
        }
      }
    }

    // ── CSV export (audit / manual import backup) ─────────────────────────
    // Generate a Xero-format CSV with exact headers and store to Supabase Storage.
    // This is a backup — the primary sync already happened above via the JSON API.
    try {
      const csvContent = buildXeroCsv(toSync)
      const csvBytes = new TextEncoder().encode(csvContent)

      await supabase.storage
        .from('xero-csv-exports')
        .upload(`${cafeDay}.csv`, csvBytes, {
          contentType: 'text/csv',
          upsert: true,       // overwrite if rerun for the same day
        })

      console.log(`xero-invoice-batch: CSV saved to xero-csv-exports/${cafeDay}.csv`)
    } catch (csvErr) {
      // Non-fatal — log but don't fail the whole function
      const msg = csvErr instanceof Error ? csvErr.message : String(csvErr)
      console.warn(`xero-invoice-batch: CSV export failed (non-fatal): ${msg}`)
    }

    const result = {
      success: true,
      cafe_day: cafeDay,
      synced: totalSynced,
      skipped: skippedFlagged.length,
      failed: totalFailed,
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

/**
 * Maps a Beans invoice row to the Xero ACCPAY invoice JSON format.
 *
 * GST mapping (invoice-level tax_type → Xero fields):
 *   INCLUSIVE → LineAmountTypes=INCLUSIVE, each line TaxType=INPUT
 *   EXCLUSIVE → LineAmountTypes=EXCLUSIVE, each line TaxType=INPUT
 *   NOTAX     → LineAmountTypes=NOTAX,     each line TaxType=NONE
 *
 * InventoryItemCode is included per line item when set, allowing Xero to
 * auto-fill account codes and descriptions from the item master.
 */
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
    Quantity: item.quantity,
    UnitAmount: item.unit_amount,
    AccountCode: item.account_code || '310',
    TaxType: lineTaxType,
    // Only include ItemCode if the field has a non-empty value
    ...(item.inventory_item_code?.trim() ? { ItemCode: item.inventory_item_code.trim() } : {}),
  }))

  return {
    Type: 'ACCPAY',
    Contact: { Name: inv.supplier_name },
    // EmailAddress is optional — only include if present
    ...(inv.supplier_email ? { EmailAddress: inv.supplier_email } : {}),
    ...(inv.reference_number ? { InvoiceNumber: inv.reference_number } : {}),
    ...(inv.invoice_date    ? { Date: inv.invoice_date }             : {}),
    ...(inv.due_date        ? { DueDate: inv.due_date }              : {}),
    LineAmountTypes: lineAmounts,
    LineItems: lineItems,
    CurrencyCode: 'AUD',
  }
}

/**
 * Builds a Xero Bills CSV string (for manual import / audit backup).
 *
 * The CSV is "flat" — one row per line item, with invoice header fields
 * repeated on every row. This matches the Xero Bills import template format.
 *
 * Column order is fixed to match the Xero import spec exactly.
 * Tax type values use Xero's rate-name strings, not the API enum values:
 *   INPUT → "GST on Expenses"
 *   NONE  → "GST Free Expenses"
 */
function buildXeroCsv(invoices: Record<string, unknown>[]): string {
  /** Wraps a value in quotes if it contains a comma, newline, or quote */
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
    // Map to Xero CSV tax rate names
    const csvTaxType = taxType === 'NOTAX' ? 'GST Free Expenses' : 'GST on Expenses'

    const lineItems = inv.line_items as Array<{
      description: string
      quantity: number
      unit_amount: number
      account_code?: string
      inventory_item_code?: string
    }>

    for (const item of lineItems) {
      const row = [
        csvCell(inv.supplier_name as string),       // *ContactName
        csvCell(inv.supplier_email as string),       // EmailAddress
        '',                                          // POAddressLine1
        '',                                          // POAddressLine2
        '',                                          // POAddressLine3
        '',                                          // POAddressLine4
        '',                                          // POCity
        '',                                          // PORegion
        '',                                          // POPostalCode
        '',                                          // POCountry
        csvCell(inv.reference_number as string),     // *InvoiceNumber
        csvCell(inv.invoice_date as string),         // *InvoiceDate
        csvCell(inv.due_date as string),             // *DueDate
        csvCell(item.inventory_item_code || ''),     // InventoryItemCode
        csvCell(item.description),                   // Description
        csvCell(item.quantity),                      // *Quantity
        csvCell(item.unit_amount),                   // *UnitAmount
        csvCell(item.account_code || '310'),         // *AccountCode
        csvCell(csvTaxType),                         // *TaxType
        '',                                          // TrackingName1
        '',                                          // TrackingOption1
        '',                                          // TrackingName2
        '',                                          // TrackingOption2
        'AUD',                                       // Currency
      ]
      rows.push(row.join(','))
    }
  }

  return rows.join('\n')
}
