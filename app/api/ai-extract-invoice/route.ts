/**
 * app/api/ai-extract-invoice/route.ts
 *
 * POST endpoint that accepts a base64-encoded invoice image or PDF and
 * returns structured invoice data ready for Xero import.
 *
 * Strategy:
 * 1. Load Xero reference data (inventory items + chart of accounts) from /data/ CSVs
 * 2. Build a detailed system prompt injecting reference sets
 * 3. Call Claude (primary) or Gemini (fallback)
 * 4. Return per-line tax_type (NONE for GST-free, INPUT2 for GST items)
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

/** Learned tax type overrides from previous invoices (populated before prompt build) */
let learnedTaxTypes: Array<{ name: string; tax_type: string }> = []

/** Injects learned tax types from inventory_items into the module — called before prompt build */
export function setLearnedTaxTypes(items: Array<{ name: string; tax_type: string }>) {
  learnedTaxTypes = items
}

/**
 * Builds the AI extraction system prompt, injecting:
 * - The full inventory item list (for exact ItemCode + AccountCode matching)
 * - The chart of accounts (for fallback account selection)
 * - Learned tax types from previous invoice confirmations
 * AI returns per-line tax_type: "NONE", "INPUT2", or "BASEXCLUDED"
 */
function buildExtractionPrompt(): string {
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

  // Minify learned tax types — confirmed by user on previous invoices
  const learnedJson = learnedTaxTypes.length > 0
    ? JSON.stringify(learnedTaxTypes.map(i => ({ n: i.name, t: i.tax_type })))
    : '[]'

  return `You are an expert Xero Accounts Payable data extraction bot for Cocoa Café.

I am providing you with our exact Xero Inventory Item list, Chart of Accounts, and a list of previously confirmed tax types for known items.

INVENTORY ITEMS (fields: c=ItemCode, n=ItemName, d=PurchasesDescription, a=PurchasesAccount, t=PurchasesTaxRate):
${inventoryJson}

CHART OF ACCOUNTS — expense/cost accounts only (fields: c=Code, n=Name, t=TaxCode):
${coaJson}

PREVIOUSLY CONFIRMED TAX TYPES (fields: n=ItemName, t=TaxType — these were manually confirmed by staff and MUST take priority over other rules):
${learnedJson}


INSTRUCTIONS:

This is a café in Australia. All amounts on invoices are GST-inclusive (tax included in the price).
LineAmountTypes will always be "Inclusive" in Xero — you must set the correct TaxType PER LINE ITEM.

TAX TYPE RULES — THREE CATEGORIES:
1. INPUT2 — GST on Expenses (10%): alcohol, equipment, packaging, non-food supplies, cleaning chemicals, carbonated/soft drinks, confectionery, electrical, plumbing
2. NONE — GST Free: most food ingredients, basic beverages (milk, juice), coffee beans, tea, flour, sugar, fruit, vegetables, bread, meat, dairy
3. BASEXCLUDED — BAS Excluded: bank fees, merchant fees, wages, superannuation, insurance premiums, government charges, donations, interest

PRIORITY ORDER for determining tax_type:
1. FIRST check the "Previously Confirmed Tax Types" list above — if the item name closely matches, use that tax_type (these are user-confirmed and override all other rules)
2. THEN check the Inventory Items list "t" (PurchasesTaxRate) field
3. FINALLY apply the tax type rules above based on what the item actually is
4. When genuinely uncertain, default to "NONE" for food/beverage items

For each line item on the invoice:

1. Find the closest semantic match in the Inventory list by comparing the line item description to "n" (ItemName) and "d" (PurchasesDescription).

2. If an inventory match is found:
   - Set inventory_item_code to the exact "c" (ItemCode) value
   - Set account_code to the exact "a" (PurchasesAccount) value
   - Determine tax_type using the priority order above

3. If no inventory match is found:
   - Leave inventory_item_code as empty string — do NOT invent a code
   - Select the most appropriate account_code from the Chart of Accounts based on the expense category
   - Prefer account 310 (Cost of Goods Sold) for food/beverage supplies, 408 (Cleaning) for cleaning products, 429 (General Expenses) when unsure
   - Determine tax_type using the priority order above

4. Extract invoice header fields:
   - supplier_name: exactly as shown on the invoice
   - supplier_email: if shown, otherwise null
   - invoice_number: the supplier's invoice/reference number
   - invoice_date: YYYY-MM-DD format, null if not found
   - due_date: YYYY-MM-DD format, null if not shown
   - confidence: "high" (all fields clear), "medium" (some inference needed), "low" (poor image / much guesswork)

5. Extract per line item:
   - description: as printed on invoice
   - quantity: numeric (default 1 if not itemised)
   - unit_amount: price per unit AS SHOWN on the invoice (GST-inclusive — do not adjust)
   - account_code: from inventory match or COA lookup (string)
   - inventory_item_code: exact ItemCode from inventory match, or empty string
   - tax_type: "INPUT2" for GST items, "NONE" for GST-free items, "BASEXCLUDED" for BAS-excluded items

Return ONLY a valid JSON object using this exact structure — no preamble, no markdown, no explanation:
{
  "supplier_name": "string",
  "supplier_email": "string or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "confidence": "high" | "medium" | "low",
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "unit_amount": number,
      "account_code": "string",
      "inventory_item_code": "string",
      "tax_type": "NONE" | "INPUT2" | "BASEXCLUDED"
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

// ─── Route handler ───────────────────────────────────────────────────────────

/**
 * POST /api/ai-extract-invoice
 *
 * Body: { images: [{base64, mediaType}][] } — or legacy { imageBase64, mediaType }
 *
 * 1. Authenticates the caller via Supabase session
 * 2. Loads Claude/Gemini API keys from the settings table
 * 3. Builds the extraction prompt with Xero reference data
 * 4. Calls Claude (falls back to Gemini if Claude unavailable or fails)
 * 5. Returns the structured invoice JSON with per-line tax_type
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

  // Fetch AI API keys
  const keyRows = await adminSupabase
    .from('settings')
    .select('key, value')
    .in('key', ['claude_api_key', 'gemini_api_key'])
    .then(({ data }: { data: { key: string; value: string }[] | null }) => data ?? [])

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

  // Load learned tax types from inventory_items table (confirmed by users on previous invoices)
  const { data: learnedItems } = await adminSupabase
    .from('inventory_items')
    .select('name, default_tax_type')
    .eq('is_active', true)

  setLearnedTaxTypes(
    (learnedItems ?? []).map(i => ({ name: i.name, tax_type: i.default_tax_type }))
  )

  // Build the prompt with reference data + learned tax types injected
  const prompt = buildExtractionPrompt()

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

  return NextResponse.json(result)
}
