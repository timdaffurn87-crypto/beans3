import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'

const EXTRACTION_PROMPT = `Extract the invoice data from this document and return it as JSON only, no explanation. Use this exact structure:
{
  "supplier_name": "string",
  "supplier_email": "string or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "unit_amount": number,
      "account_code": "300",
      "inventory_item_code": ""
    }
  ],
  "tax_type": "INCLUSIVE" | "EXCLUSIVE" | "NOTAX" | null,
  "gst_flagged": true | false,
  "confidence": "high" | "medium" | "low"
}

Rules:
- unit_amount is the price per unit as shown on the invoice (do not adjust for GST)
- due_date: extract from invoice if present, otherwise leave null (the app will default to 30 days from invoice_date)
- account_code: always use "300" unless you can clearly identify a different account
- inventory_item_code: leave as empty string unless the invoice shows a product/item code
- If you cannot read a field clearly, set it to null. If you cannot determine a numeric value, use 0.
- tax_type: examine the invoice carefully for GST treatment:
  - "EXCLUSIVE" — if GST appears as a SEPARATE LINE ITEM showing the GST dollar amount broken out (e.g. "GST $12.50" as its own line)
  - "INCLUSIVE" — if the invoice shows a total with notation like "incl. GST", "GST included", "Total (GST incl.)" with NO separate GST line item
  - "NOTAX" — if the invoice explicitly shows items as GST-free, zero-rated, or is from a category exempt from GST
  - null — if you cannot confidently determine the GST treatment from the invoice
- gst_flagged: set to true ONLY when tax_type is null (i.e. GST treatment is ambiguous). Set to false in all other cases.
- Return only the JSON object, nothing else.`

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

/**
 * Calls Claude (Anthropic) for invoice extraction.
 * Throws an error with a descriptive message if the call fails.
 */
async function extractWithClaude(
  apiKey: string,
  imageBase64: string,
  mediaType: string
): Promise<Record<string, unknown>> {
  const anthropic = new Anthropic({ apiKey })
  const isPdf = mediaType === 'application/pdf'

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: isPdf
          ? [
              {
                type: 'document' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'application/pdf' as const,
                  data: imageBase64,
                },
              },
              { type: 'text' as const, text: EXTRACTION_PROMPT },
            ]
          : [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: (mediaType || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                  data: imageBase64,
                },
              },
              { type: 'text' as const, text: EXTRACTION_PROMPT },
            ],
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

  const parsed = parseModelJson(content.text)
  if (!parsed) throw new Error('Failed to parse JSON from Claude response')

  return parsed
}

/**
 * Calls Gemini (Google) for invoice extraction.
 * Uses the gemini-2.0-flash model via the REST API (no extra SDK needed).
 * Throws an error with a descriptive message if the call fails.
 */
async function extractWithGemini(
  apiKey: string,
  imageBase64: string,
  mediaType: string
): Promise<Record<string, unknown>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`

  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mediaType || 'image/jpeg',
              data: imageBase64,
            },
          },
          { text: EXTRACTION_PROMPT },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 1024 },
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

/**
 * Checks the gst_inclusive_suppliers table for a matching supplier name.
 * If found, returns true — meaning we should override tax_type to INCLUSIVE.
 * Uses case-insensitive trimmed comparison.
 */
async function isGstInclusiveSupplier(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminSupabase: { from: (table: string) => any },
  supplierName: string
): Promise<boolean> {
  const { data } = await adminSupabase
    .from('gst_inclusive_suppliers')
    .select('supplier_name')

  if (!data) return false

  const normalised = supplierName.trim().toLowerCase()
  return data.some((row: { supplier_name: string }) =>
    row.supplier_name.trim().toLowerCase() === normalised
  )
}

/**
 * POST /api/ai-extract-invoice
 * Accepts a base64-encoded invoice image or PDF.
 * Tries Claude first. If Claude is not configured or fails, falls back to Gemini.
 * After extraction, checks gst_inclusive_suppliers table to override tax_type if needed.
 * Returns structured invoice data: supplier, date, reference, line items, GST info.
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

  // Fetch both API keys using service role (bypasses RLS for sensitive keys)
  const { createClient: createServiceClient } = await import('@supabase/supabase-js')
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: keyRows } = await adminSupabase
    .from('settings')
    .select('key, value')
    .in('key', ['claude_api_key', 'gemini_api_key'])

  const keys: Record<string, string> = {}
  for (const row of keyRows ?? []) keys[row.key] = row.value

  const claudeKey = keys['claude_api_key'] || ''
  const geminiKey = keys['gemini_api_key'] || ''

  if (!claudeKey && !geminiKey) {
    return NextResponse.json(
      { error: 'No AI API key configured. Add a Claude or Gemini key in Settings.' },
      { status: 400 }
    )
  }

  const { imageBase64, mediaType } = await request.json()
  if (!imageBase64) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  let result: Record<string, unknown>

  // Try Claude first, fall back to Gemini if Claude is unavailable or fails
  if (claudeKey) {
    try {
      result = await extractWithClaude(claudeKey, imageBase64, mediaType)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // If we have a Gemini key, log and fall through to it
      if (geminiKey) {
        console.warn(`Claude extraction failed, falling back to Gemini: ${msg}`)
        try {
          result = await extractWithGemini(geminiKey, imageBase64, mediaType)
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
      result = await extractWithGemini(geminiKey, imageBase64, mediaType)
      result = { ...result, _provider: 'gemini' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Gemini API error: ${msg}` }, { status: 502 })
    }
  }

  // Check gst_inclusive_suppliers table — if supplier is known, override to INCLUSIVE
  const supplierName = (result.supplier_name as string) || ''
  if (supplierName) {
    const isInclusiveSupplier = await isGstInclusiveSupplier(adminSupabase, supplierName)
    if (isInclusiveSupplier) {
      result = { ...result, tax_type: 'INCLUSIVE', gst_flagged: false }
    }
  }

  return NextResponse.json(result)
}
