/**
 * app/api/inventory/upsert/route.ts
 *
 * POST /api/inventory/upsert
 *
 * Upserts line items from a saved invoice into the inventory_items table.
 * - If an item with the same name already exists, updates unit_price,
 *   default_tax_type, supplier, and logs a price change if the price changed.
 * - If no match exists, creates a new inventory item.
 *
 * This runs server-side with the service role key so it can bypass RLS
 * for the upsert + price history insert in a single transaction.
 *
 * Body: {
 *   invoice_id: string,
 *   supplier_name: string,
 *   line_items: Array<{
 *     description: string,
 *     unit_amount: number,
 *     tax_type: 'NONE' | 'INPUT2' | 'BASEXCLUDED',
 *     account_code: string,
 *     inventory_item_code: string
 *   }>
 * }
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const cookieStore = await cookies()

  // Authenticate the caller
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
  const { invoice_id, supplier_name, line_items } = body as {
    invoice_id: string
    supplier_name: string
    line_items: Array<{
      description: string
      unit_amount: number
      tax_type: string
      account_code: string
      inventory_item_code: string
    }>
  }

  if (!line_items || line_items.length === 0) {
    return NextResponse.json({ error: 'No line items provided' }, { status: 400 })
  }

  // Use service role for upserts (bypasses RLS for atomic operations)
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const results: Array<{ name: string; action: 'created' | 'updated' | 'unchanged' }> = []

  for (const item of line_items) {
    if (!item.description.trim()) continue

    const itemName = item.description.trim()

    // Check if this item already exists (case-insensitive match)
    const { data: existing } = await adminSupabase
      .from('inventory_items')
      .select('id, unit_price, default_tax_type')
      .ilike('name', itemName)
      .limit(1)
      .single()

    if (existing) {
      const priceChanged = existing.unit_price !== item.unit_amount
      const taxChanged = existing.default_tax_type !== item.tax_type

      if (priceChanged || taxChanged) {
        // Update the existing item
        await adminSupabase
          .from('inventory_items')
          .update({
            unit_price: item.unit_amount,
            default_tax_type: item.tax_type,
            supplier_name: supplier_name,
            xero_account_code: item.account_code || '310',
            xero_inventory_item_code: item.inventory_item_code || '',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)

        // Log price change if price actually changed
        if (priceChanged) {
          await adminSupabase.from('inventory_price_history').insert({
            inventory_item_id: existing.id,
            old_price: existing.unit_price,
            new_price: item.unit_amount,
            supplier_name: supplier_name,
            invoice_id: invoice_id || null,
          })
        }

        results.push({ name: itemName, action: 'updated' })
      } else {
        results.push({ name: itemName, action: 'unchanged' })
      }
    } else {
      // Create new inventory item
      const { data: created } = await adminSupabase
        .from('inventory_items')
        .insert({
          name: itemName,
          supplier_name: supplier_name,
          unit_price: item.unit_amount,
          default_tax_type: item.tax_type,
          xero_account_code: item.account_code || '310',
          xero_inventory_item_code: item.inventory_item_code || '',
        })
        .select('id')
        .single()

      // Log initial price as first history entry
      if (created) {
        await adminSupabase.from('inventory_price_history').insert({
          inventory_item_id: created.id,
          old_price: null,
          new_price: item.unit_amount,
          supplier_name: supplier_name,
          invoice_id: invoice_id || null,
        })
      }

      results.push({ name: itemName, action: 'created' })
    }
  }

  return NextResponse.json({ success: true, results })
}
