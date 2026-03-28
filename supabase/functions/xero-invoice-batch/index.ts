// =============================================================================
// xero-invoice-batch — Supabase Edge Function
// =============================================================================
// Runs daily via Supabase cron at 05:00 UTC (15:00 AEST / 16:00 AEDT).
// Pulls all invoices with xero_sync_status = 'pending' for today's café day,
// maps them to Xero ACCPAY bills, and posts them to the Xero Invoices API.
//
// Cron schedule: 0 5 * * *
// Set in: Supabase Dashboard → Edge Functions → xero-invoice-batch → Cron
//
// GST handling:
//   tax_type = 'INCLUSIVE' → LineAmountTypes=INCLUSIVE, TaxType=INPUT
//   tax_type = 'EXCLUSIVE' → LineAmountTypes=EXCLUSIVE, TaxType=INPUT
//   tax_type = 'NOTAX'     → LineAmountTypes=NOTAX,     TaxType=NONE
//   tax_type = null AND gst_flagged = true → SKIPPED (needs manual review)
//
// On success: sets xero_sync_status='synced', saves xero_invoice_id + xero_synced_at
// On failure: sets xero_sync_status='failed', logs error
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidXeroToken } from '../xero-token-refresh/index.ts'

/** Maximum invoices per Xero API batch call */
const BATCH_SIZE = 50

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
    // Skip invoices that are flagged AND have no tax_type (need manager review)
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

    // Separate invoices that need review (flagged + no tax_type)
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

    // Process in batches of BATCH_SIZE
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
        // Mark all in this batch as failed
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

      // Match returned invoices back to our batch by position
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

/** Maps a Beans invoice row to the Xero ACCPAY invoice format */
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
    AccountCode: item.account_code || '300',
    TaxType: lineTaxType,
    ...(item.inventory_item_code ? { ItemCode: item.inventory_item_code } : {}),
  }))

  return {
    Type: 'ACCPAY',
    Contact: { Name: inv.supplier_name },
    ...(inv.reference_number ? { InvoiceNumber: inv.reference_number } : {}),
    ...(inv.invoice_date ? { Date: inv.invoice_date } : {}),
    ...(inv.due_date ? { DueDate: inv.due_date } : {}),
    LineAmountTypes: lineAmounts,
    LineItems: lineItems,
    CurrencyCode: 'AUD',
  }
}
