/**
 * app/api/tasks/generate/route.ts
 *
 * POST /api/tasks/generate
 *
 * Generates daily_task rows from active task_templates for the given café day.
 * Uses the service role key to bypass RLS (daily_tasks has no client INSERT policy).
 * Idempotent — does nothing if tasks already exist for that day.
 *
 * Body: { cafeDay: string } — YYYY-MM-DD
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const cookieStore = await cookies()

  // Authenticate the caller via session cookie
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

  const { cafeDay } = await request.json() as { cafeDay: string }
  if (!cafeDay) return NextResponse.json({ error: 'cafeDay required' }, { status: 400 })

  // Use service role to bypass RLS for daily_tasks INSERT
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Check if tasks already exist for today — idempotent
  const { count } = await admin
    .from('daily_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('cafe_day', cafeDay)

  if ((count ?? 0) > 0) {
    return NextResponse.json({ generated: 0, skipped: true })
  }

  // Fetch all active task templates
  const { data: templates, error: templatesError } = await admin
    .from('task_templates')
    .select('*')
    .eq('is_active', true)
    .order('station')
    .order('sort_order')

  if (templatesError) {
    return NextResponse.json({ error: templatesError.message }, { status: 500 })
  }

  if (!templates || templates.length === 0) {
    return NextResponse.json({ generated: 0, skipped: false })
  }

  // Insert a daily_task row for each active template
  const rows = templates.map((t: {
    id: string
    title: string
    description: string | null
    station: string
  }) => ({
    template_id:  t.id,
    cafe_day:     cafeDay,
    title:        t.title,
    description:  t.description,
    station:      t.station,
  }))

  const { error: insertError } = await admin.from('daily_tasks').insert(rows)

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ generated: rows.length, skipped: false })
}
