import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Invoice } from '@/lib/types'

/**
 * POST /api/xero/send-invoices
 * Sends the day's invoices directly to Xero as Bills (ACCPAY).
 * Called by the EOD page after submitting the report.
 *
 * Request body: { invoices: Invoice[], cafe_day: string }
 *
 * GST logic:
 * - Suppliers listed in xero_gst_inclusive_suppliers setting →
 *   LineAmountTypes = "INCLUSIVE" (amounts already include GST)
 * - All others → LineAmountTypes = "EXCLUSIVE" (amounts are ex-GST)
 *
 * Returns: { success: true, sent: number, skipped: number, errors: string[] }
 *
 * Invoices already sent (have xero_invoice_id) are skipped to prevent duplicates
 * when the owner resubmits the EOD report.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies()

  // Verify authenticated
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

  const body = await request.json()
  const { invoices, cafe_day } = body as { invoices: Invoice[]; cafe_day: string }

  if (!invoices || invoices.length === 0) {
    return NextResponse.json({ success: true, sent: 0, skipped: 0, errors: [] })
  }

  // Read all Xero credentials using service role (bypasses RLS for sensitive keys)
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: rows } = await adminSupabase
    .from('settings')
    .select('key, value')
    .in('key', [
      'xero_client_id',
      'xero_client_secret',
      'xero_refresh_token',
      'xero_tenant_id',
      'xero_gst_inclusive_suppliers',
    ])

  const settings: Record<string, string> = {}
  for (const row of rows ?? []) settings[row.key] = row.value

  // Xero must be connected to proceed
  if (!settings['xero_refresh_token'] || !settings['xero_tenant_id']) {
    return NextResponse.json({
      success: false,
      error: 'Xero not connected. Connect Xero in Settings.',
    }, { status: 400 })
  }

  if (!settings['xero_client_id'] || !settings['xero_client_secret']) {
    return NextResponse.json({
      success: false,
      error: 'Xero client credentials not configured.',
    }, { status: 400 })
  }

  // Parse the GST-inclusive suppliers list
  let gstInclusiveSuppliers: string[] = []
  try {
    gstInclusiveSuppliers = settings['xero_gst_inclusive_suppliers']
      ? JSON.parse(settings['xero_gst_inclusive_suppliers'])
      : []
  } catch {
    gstInclusiveSuppliers = []
  }

  // Normalise supplier names to lowercase for case-insensitive matching
  const inclusiveSet = new Set(gstInclusiveSuppliers.map(s => s.toLowerCase().trim()))

  try {
    // Refresh the Xero access token (also rotates the refresh token — must save the new one)
    const { access_token, refresh_token: newRefreshToken } = await refreshXeroToken(
      settings['xero_client_id'],
      settings['xero_client_secret'],
      settings['xero_refresh_token']
    )

    // Always update the stored refresh token immediately (Xero rotates it each use)
    await adminSupabase
      .from('settings')
      .upsert({ key: 'xero_refresh_token', value: newRefreshToken, updated_at: new Date().toISOString() }, { onConflict: 'key' })

    const tenantId = settings['xero_tenant_id']

    // Fetch the current xero_invoice_id state from the DB for today's invoices
    // so we can skip ones already sent (handles resubmit case)
    const { data: dbInvoices } = await adminSupabase
      .from('invoices')
      .select('id, xero_invoice_id')
      .eq('cafe_day', cafe_day)

    const alreadySentIds = new Set(
      (dbInvoices ?? [])
        .filter(i => i.xero_invoice_id != null)
        .map(i => i.id)
    )

    const toSend = invoices.filter(inv =>
      !alreadySentIds.has(inv.id) &&
      inv.line_items &&
      inv.line_items.length > 0
    )

    const skipped = invoices.length - toSend.length
    const errors: string[] = []
    let sent = 0

    // Send each invoice individually so a single failure doesn't block others
    for (const invoice of toSend) {
      try {
        const isGstInclusive = inclusiveSet.has(invoice.supplier_name.toLowerCase().trim())
        const xeroInvoiceId = await createXeroBill(access_token, tenantId, invoice, isGstInclusive)

        // Record the Xero invoice ID back to our DB
        await adminSupabase
          .from('invoices')
          .update({ xero_invoice_id: xeroInvoiceId })
          .eq('id', invoice.id)

        sent++
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`${invoice.supplier_name} (${invoice.reference_number || 'no ref'}): ${msg}`)
      }
    }

    return NextResponse.json({ success: true, sent, skipped, errors })

  } catch (err) {
    console.error('Xero send-invoices error:', err)
    const message = err instanceof Error ? err.message : 'Failed to send invoices to Xero'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * Refreshes the Xero access token using the stored refresh token.
 * Returns the new access_token and rotated refresh_token.
 */
async function refreshXeroToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string }> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token refresh failed: ${res.status} ${body}`)
  }

  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  }
}

/**
 * Creates a single ACCPAY (bill) invoice in Xero.
 * Returns the Xero Invoice ID on success.
 *
 * LineAmountTypes is set based on whether the supplier is GST-inclusive.
 * TaxType "INPUT" = GST on Expenses (standard Australian GST).
 */
async function createXeroBill(
  accessToken: string,
  tenantId: string,
  invoice: Invoice,
  isGstInclusive: boolean
): Promise<string> {
  const xeroInvoice = {
    Type: 'ACCPAY',
    Contact: { Name: invoice.supplier_name },
    InvoiceNumber: invoice.reference_number || undefined,
    // Xero API accepts dates as "YYYY-MM-DD" strings
    Date: invoice.invoice_date || undefined,
    DueDate: invoice.due_date || undefined,
    LineAmountTypes: isGstInclusive ? 'INCLUSIVE' : 'EXCLUSIVE',
    LineItems: invoice.line_items.map(item => ({
      Description: item.description,
      Quantity: item.quantity,
      UnitAmount: item.unit_amount,
      AccountCode: item.account_code || '300',
      TaxType: 'INPUT', // GST on Expenses
      // Only include InventoryItemCode if present
      ...(item.inventory_item_code ? { ItemCode: item.inventory_item_code } : {}),
    })),
    CurrencyCode: 'AUD',
  }

  const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ Invoices: [xeroInvoice] }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Xero API error: ${res.status} ${body}`)
  }

  const data = await res.json()
  const createdInvoice = data?.Invoices?.[0]

  if (!createdInvoice) {
    throw new Error('Xero returned no invoice in response')
  }

  // Xero may return a ValidationErrors array for issues like duplicate invoice number
  if (createdInvoice.HasErrors) {
    const errs = (createdInvoice.ValidationErrors ?? [])
      .map((e: { Message: string }) => e.Message)
      .join('; ')
    throw new Error(`Xero validation: ${errs}`)
  }

  return createdInvoice.InvoiceID as string
}
