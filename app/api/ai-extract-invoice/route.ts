import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'

/**
 * POST /api/ai-extract-invoice
 * Accepts a base64-encoded invoice image, sends it to Claude API for OCR extraction.
 * Returns structured invoice data: supplier, date, reference, line items, total.
 * Requires claude_api_key to be set in the settings table.
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

  // Get Claude API key from settings (use service role to read sensitive key)
  const { createClient: createServiceClient } = await import('@supabase/supabase-js')
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: apiKeySetting } = await adminSupabase
    .from('settings')
    .select('value')
    .eq('key', 'claude_api_key')
    .single()

  if (!apiKeySetting?.value) {
    return NextResponse.json({ error: 'Claude API key not configured' }, { status: 400 })
  }

  const { imageBase64, mediaType } = await request.json()

  if (!imageBase64) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const anthropic = new Anthropic({ apiKey: apiKeySetting.value })

  const prompt = `Extract the invoice data from this document and return it as JSON only, no explanation. Use this exact structure:
{
  "supplier_name": "string",
  "invoice_date": "YYYY-MM-DD or null",
  "reference_number": "string or null",
  "total_amount": number,
  "line_items": [
    { "description": "string", "quantity": number, "unit_price": number, "total": number }
  ],
  "confidence": "high" | "medium" | "low"
}

If you cannot read a field clearly, set it to null. If you cannot determine a numeric value, use 0. Return only the JSON object, nothing else.`

  // PDFs use the 'document' content type; images use 'image'
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
              { type: 'text' as const, text: prompt },
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
              { type: 'text' as const, text: prompt },
            ],
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') {
    return NextResponse.json({ error: 'Unexpected response from Claude' }, { status: 500 })
  }

  // Parse the JSON response from Claude
  // Strip any markdown code fences if present
  const jsonText = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  let extracted
  try {
    extracted = JSON.parse(jsonText)
  } catch {
    return NextResponse.json({ error: 'Failed to parse Claude response' }, { status: 500 })
  }

  return NextResponse.json(extracted)
}
