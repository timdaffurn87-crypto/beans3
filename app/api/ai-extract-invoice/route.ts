/**
 * app/api/ai-extract-invoice/route.ts
 *
 * POST endpoint that accepts a base64-encoded invoice image or PDF and
 * returns structured invoice data ready for Xero import.
 *
 * Strategy:
 * 1. Load Xero reference data (inventory items + chart of accounts) from /data/ CSVs
 * 2. Fetch the GST inclusive supplier list from Supabase
 * 3. Build a detailed system prompt injecting both reference sets
 * 4. Call Claude (primary) or Gemini (fallback)
 * 5. Post-process: override tax_type if supplier is in the GST inclusive list
 *
 * Auth: requires a valid Supabase session cookie.
 * API keys: read from the `settings` table (not env vars) using service role.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'
import { inventoryItems, chartOfAccounts } from '@/lib/invoiceReferenceData'

// ─── Prompt builder ──────────────────────────────────────────────────────────

/**
 * Builds the AI extraction system prompt, injecting:
 * - The full inventory item list (for exact ItemCode + AccountCode matching)
 * - The chart of accounts (for fallback account selection)
 * - The GST inclusive supplier list (for automatic tax_type override)
 *
 * Keeping reference data as compact JSON minimises token usage.
 */
function buildExtractionPrompt(gstSuppliers: string[]): string {
  // Minify reference arrays — compact JSON without extra spaces
  const inventoryJson = JSON.stringify(
    inventoryItems.map(i => ({
      c: i.itemCode,
      n: i.itemName,
      d: i.purchasesDescription,
      a: i.purchasesAccount,
      t: i.purchasesTaxRate,
    }))
  )

  const coaJson = JSON.stringify(
    chartOfAccounts.map(a => ({
      c: a.code,
      n: a.name,
      t: a.taxCode,
    }))
  )

  const suppliersJson = JSON.stringify(gstSuppliers)

  return `You are an expert Xero Accounts Payable data extraction bot for Cocoa Café.

I am providing you with our exact Xero Inventory Item list and Chart of Accounts.

INVENTORY ITEMS (fields: c=ItemCode, n=ItemName, d=PurchasesDescription, a=PurchasesAccount, t=PurchasesTaxRate):
${inventoryJson}

CHART OF ACCOUNTS — expense/cost accounts only (fields: c=Code, n=Name, t=TaxCode):
${coaJson}

GST INCLUSIVE SUPPLIERS — invoices from these suppliers have GST already included in all prices:
${suppliersJson}

INSTRUCTIONS:

For each line item on the invoice:

1. Find the closest semantic match in the Inventory list by comparing the line item description to "n" (ItemName) and "d" (PurchasesDescription).

2. If an inventory match is found:
   - Set inventory_item_code to the exact "c" (ItemCode) value
   - Set account_code to the exact "a" (PurchasesAccount) value
   - Note the "t" (PurchasesTaxRate) — use it to inform the invoice-level tax_type

3. If no inventory match is found:
   - Leave inventory_item_code as empty string — do NOT invent a code
   - Select the most appropriate account_code from the Chart of Accounts based on the expense category
   - Prefer account 310 (Cost of Goods Sold) for food/beverage supplies, 408 (Cleaning) for cleaning products, 429 (General Expenses) when unsure

4. GST treatment — determine at the INVOICE level (applies to all line items):
   - If the supplier name (exactly as on invoice) appears in the GST Inclusive Suppliers list → set tax_type to "INCLUSIVE"
   - If the invoice shows a separate GST line item (e.g. "GST $12.50" broken out) → set tax_type to "EXCLUSIVE"
   - If the invoice shows "incl. GST", "GST included", or similar on the total → set tax_type to "INCLUSIVE"
   - If the invoice explicitly shows items as GST-free, zero-rated, or exempt → set tax_type to "NOTAX"
   - If GST treatment cannot be determined confidently → set tax_type to null and gst_flagged to true

5. Extract invoice header fields:
   - supplier_name: exactly as shown on the invoice
   - supplier_email: if shown, otherwise null
   - invoice_number: the supplier's invoice/reference number
   - invoice_date: YYYY-MM-DD format, null if not found
   - due_date: YYYY-MM-DD format, null if not shown
   - confidence: "high" (all fields clear), "medium" (some inference needed), "low" (poor image / much guesswork)

6. Extract per line item:
   - description: as printed on invoice
   - quantity: numeric (default 1 if not itemised)
   - unit_amount: price per unit as shown (do not adjust for GST)
   - account_code: from inventory match or COA lookup (string)
   - inventory_item_code: exact ItemCode from inventory match, or empty string

Return ONLY a valid JSON object using this exact structure — no preamble, no markdown, no explanation:
{
  "supplier_name": "string",
  "supplier_email": "string or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "tax_type": "INCLUSIVE" | "EXCLUSIVE" | "NOTAX" | null,
  "gst_flagged": true | false,
  "confidence": "high" | "medium" | "low",
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "unit_amount": number,
      "account_code": "string",
      "inventory_item_code": "string"
    }
  ]
}`
}

// ─── JSON parser ─────────────────────────────────────────────────────────────

/**
 * Strips markdown code fences and parses JSON from a model response string.
 * Returns null if parsing fails.
 */
function parseModelJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

// ─── AI extraction functions ─────────────────────────────────────────────────

/** One image/document payload item for Claude */
type ImageInput = { base64: string; mediaType: string }

/**
 * Calls Claude (Anthropic) for invoice extraction.
 * Accepts one or more images/PDFs — multi-page invoices are sent as multiple
 * image blocks in a single message so Claude can synthesise all pages.
 * Throws an error with a descriptive message if the call fails.
 */
async function extractWithClaude(
  apiKey: string,
  images: ImageInput[],
  prompt: string
): Promise<Record<string, unknown>> {
  const anthropic = new Anthropic({ apiKey })

  // Build content blocks: one block per image/PDF, then the instruction text
  type ContentBlock =
    | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
    | { type: 'text'; text: string }

  const contentBlocks: ContentBlock[] = images.map(({ base64, mediaType }) => {
    if (mediaType === 'application/pdf') {
      return {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
      }
    }
    return {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: (mediaType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: base64,
      },
    }
  })

  contentBlocks.push({ type: 'text' as const, text: prompt })

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: contentBlocks }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

  const parsed = parseModelJson(content.text)
  if (!parsed) throw new Error('Failed to parse JSON from Claude response')

  return parsed
}

/**
 * Calls Gemini (Google) for invoice extraction.
 * Uses gemini-2.0-flash via the REST API — no additional SDK required.
 * Accepts one or more images; all are sent as inline_data parts in one request.
 * Throws an error with a descriptive message if the call fails.
 */
async function extractWithGemini(
  apiKey: string,
  images: ImageInput[],
  prompt: string
): Promise<Record<string, unknown>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`

  const imageParts = images.map(({ base64, mediaType }) => ({
    inline_data: { mime_type: mediaType || 'image/jpeg', data: base64 },
  }))

  const body = {
    contents: [
      {
        parts: [
          ...imageParts,
          { text: prompt },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 2048 },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('No text in Gemini response')

  const parsed = parseModelJson(text)
  if (!parsed) throw new Error('Failed to parse JSON from Gemini response')

  return parsed
}

// ─── GST supplier lookup ─────────────────────────────────────────────────────

/**
 * Fetches all supplier names from the gst_inclusive_suppliers table.
 * Returns an empty array if the table is empty or the query fails.
 * These names are injected into the AI prompt AND used for post-extraction override.
 */
async function fetchGstInclusiveSuppliers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminSupabase: { from: (table: string) => any }
): Promise<string[]> {
  const { data } = await adminSupabase
    .from('gst_inclusive_suppliers')
    .select('supplier_name')

  if (!data || data.length === 0) return []
  return data.map((row: { supplier_name: string }) => row.supplier_name)
}

/**
 * Returns true if the given supplier name matches any entry in the
 * GST inclusive suppliers list (case-insensitive, trimmed).
 */
function isGstInclusiveSupplier(
  supplierName: string,
  gstSuppliers: string[]
): boolean {
  const normalised = supplierName.trim().toLowerCase()
  return gstSuppliers.some(s => s.trim().toLowerCase() === normalised)
}

// ─── Route handler ───────────────────────────────────────────────────────────

/**
 * POST /api/ai-extract-invoice
 *
 * Body: { images: [{base64, mediaType}][] } — or legacy { imageBase64, mediaType }
 *
 * 1. Authenticates the caller via Supabase session
 * 2. Loads Claude/Gemini API keys from the settings table
 * 3. Fetches GST inclusive suppliers from Supabase
 * 4. Builds the extraction prompt with reference data injected
 * 5. Calls Claude (falls back to Gemini if Claude unavailable or fails)
 * 6. Post-processes: overrides tax_type to INCLUSIVE if supplier is known
 * 7. Returns the structured invoice JSON
 */
export async function POST(request: Request) {
  const cookieStore = await cookies()

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

  // Verify authenticated
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role to read sensitive settings and the supplier list
  const { createClient: createServiceClient } = await import('@supabase/supabase-js')
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Fetch AI API keys and GST inclusive supplier list in parallel
  const [keyRows, gstSuppliers] = await Promise.all([
    adminSupabase
      .from('settings')
      .select('key, value')
      .in('key', ['claude_api_key', 'gemini_api_key'])
      .then(({ data }) => data ?? []),
    fetchGstInclusiveSuppliers(adminSupabase),
  ])

  const keys: Record<string, string> = {}
  for (const row of keyRows) keys[row.key] = row.value

  const claudeKey = keys['claude_api_key'] || ''
  const geminiKey = keys['gemini_api_key'] || ''

  if (!claudeKey && !geminiKey) {
    return NextResponse.json(
      { error: 'No AI API key configured. Add a Claude or Gemini key in Settings.' },
      { status: 400 }
    )
  }

  const body = await request.json()

  // Accept either the new `images` array or the legacy single `imageBase64` field
  let images: ImageInput[]
  if (Array.isArray(body.images) && body.images.length > 0) {
    images = body.images as ImageInput[]
  } else if (body.imageBase64) {
    images = [{ base64: body.imageBase64, mediaType: body.mediaType || 'image/jpeg' }]
  } else {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  // Build the prompt with reference data injected
  const prompt = buildExtractionPrompt(gstSuppliers)

  let result: Record<string, unknown>

  // Try Claude first, fall back to Gemini if Claude is unavailable or fails
  if (claudeKey) {
    try {
      result = await extractWithClaude(claudeKey, images, prompt)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (geminiKey) {
        console.warn(`Claude extraction failed, falling back to Gemini: ${msg}`)
        try {
          result = await extractWithGemini(geminiKey, images, prompt)
          result = { ...result, _provider: 'gemini' }
        } catch (geminiErr) {
          const geminiMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr)
          return NextResponse.json({ error: `Gemini API error: ${geminiMsg}` }, { status: 502 })
        }
      } else {
        return NextResponse.json({ error: `Claude API error: ${msg}` }, { status: 502 })
      }
    }
  } else {
    // No Claude key — go straight to Gemini
    try {
      result = await extractWithGemini(geminiKey, images, prompt)
      result = { ...result, _provider: 'gemini' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Gemini API error: ${msg}` }, { status: 502 })
    }
  }

  // Post-extraction safety net: if the supplier is in our GST inclusive list,
  // force tax_type to INCLUSIVE even if the model missed it.
  const supplierName = (result.supplier_name as string) || ''
  if (supplierName && isGstInclusiveSupplier(supplierName, gstSuppliers)) {
    result = { ...result, tax_type: 'INCLUSIVE', gst_flagged: false }
  }

  return NextResponse.json(result)
}
