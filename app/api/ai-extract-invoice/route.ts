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
  "confidence": "high" | "medium" | "low"
}

Rules:
- unit_amount is the price per unit EXCLUDING GST
- due_date: extract from invoice if present, otherwise leave null (the app will default to 30 days from invoice_date)
- account_code: always use "300" unless you can clearly identify a different account
- inventory_item_code: leave as empty string unless the invoice shows a product/item code
- If you cannot read a field clearly, set it to null. If you cannot determine a numeric value, use 0.
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
 * POST /api/ai-extract-invoice
 * Accepts a base64-encoded invoice image or PDF.
 * Tries Claude first. If Claude is not configured or fails, falls back to Gemini.
 * Returns structured invoice data: supplier, date, reference, line items, total.
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

  // Try Claude first, fall back to Gemini if Claude is unavailable or fails
  if (claudeKey) {
    try {
      const result = await extractWithClaude(claudeKey, imageBase64, mediaType)
      return NextResponse.json(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // If we have a Gemini key, log and fall through to it
      if (geminiKey) {
        console.warn(`Claude extraction failed, falling back to Gemini: ${msg}`)
      } else {
        return NextResponse.json({ error: `Claude API error: ${msg}` }, { status: 502 })
      }
    }
  }

  // Gemini fallback
  try {
    const result = await extractWithGemini(geminiKey, imageBase64, mediaType)
    return NextResponse.json({ ...result, _provider: 'gemini' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Gemini API error: ${msg}` }, { status: 502 })
  }
}
