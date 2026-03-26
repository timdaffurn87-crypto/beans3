import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'

/**
 * POST /api/ai-extract-menu
 * Accepts a base64-encoded menu board image, sends it to Claude API.
 * Returns an array of menu items with name, category, and price.
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

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get Claude API key using service role
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
  if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

  const anthropic = new Anthropic({ apiKey: apiKeySetting.value })

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: `Extract all menu items from this menu board image. Return JSON only, no explanation:
{
  "items": [
    {
      "name": "string",
      "category": "coffee" | "food" | "beverage" | "retail",
      "sell_price": number
    }
  ]
}

For category: "coffee" for espresso-based drinks, "food" for food items, "beverage" for non-coffee drinks, "retail" for packaged goods.
If price is not visible, use 0. Return only the JSON, nothing else.`,
          },
        ],
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') return NextResponse.json({ error: 'Unexpected response' }, { status: 500 })

  const jsonText = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  let extracted
  try {
    extracted = JSON.parse(jsonText)
  } catch {
    return NextResponse.json({ error: 'Failed to parse Claude response' }, { status: 500 })
  }

  return NextResponse.json(extracted)
}
