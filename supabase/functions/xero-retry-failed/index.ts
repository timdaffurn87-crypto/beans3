// =============================================================================
// xero-retry-failed — Supabase Edge Function
// =============================================================================
// Manually retriggerable function that retries all invoices with
// xero_sync_status = 'failed'. Intended to be called from Krema
// or triggered manually via the Supabase dashboard.
//
// Usage: POST https://<project>.supabase.co/functions/v1/xero-retry-failed
//        Header: Authorization: Bearer <supabase-anon-key>
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidXeroToken } from '../xero-token-refresh/index.ts'

const BATCH_SIZE = 50

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    const { data: invoices, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('xero_sync_status', 'failed')
      .not('line_items', 'is', null)

    if (fetchError) throw new Error(`Failed to fetch failed invoices: ${fetchError.message}`)
    if (!invoices || invoices.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No failed invoices to retry', retried: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Skip flagged invoices with no tax_type
    const toRetry = invoices.filter(inv =>
      !(inv.gst_flagged === true && inv.tax_type === null) &&
      Array.isArray(inv.line_items) && inv.line_items.length > 0
    )

    if (toRetry.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'All failed invoices need GST review before retrying', retried: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { access_token, tenant_id } = await getValidXeroToken()
    let totalSynced = 0
    let totalFailed = 0

    for (let i = 0; i < toRetry.length; i += BATCH_SIZE) {
      const batch = toRetry.slice(i, i + BATCH_SIZE)
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
        console.error(`Xero retry API error: ${res.status} — ${body}`)
        totalFailed += batch.length
        continue
      }

      const data = await res.json()
      const returnedInvoices = data?.Invoices ?? [] as Array<{
        InvoiceID: string
        HasErrors: boolean
        ValidationErrors?: Array<{ Message: string }>
      }>

      for (let j = 0; j < batch.length; j++) {
        const inv = batch[j]
        const returned = returnedInvoices[j]

        if (!returned || returned.HasErrors) {
          totalFailed++
        } else {
          await supabase.from('invoices').update({
            xero_sync_status: 'synced',
            xero_invoice_id: returned.InvoiceID,
            xero_synced_at: new Date().toISOString(),
          }).eq('id', inv.id)
          totalSynced++
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, retried: toRetry.length, synced: totalSynced, failed: totalFailed }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('xero-retry-failed error:', msg)
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})

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
