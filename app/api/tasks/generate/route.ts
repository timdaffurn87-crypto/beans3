/**
 * app/api/tasks/generate/route.ts
 *
 * POST /api/tasks/generate
 *
 * Generates daily_task rows for the given café day from:
 *   1. All task_templates with is_active = true  (daily tasks — run every day)
 *   2. All task_templates with is_active = false AND recurrence_days contains
 *      the day-of-week matching the cafeDay date  (weekly tasks)
 *
 * Uses the service role key to bypass RLS (daily_tasks has no client INSERT policy).
 * Idempotent — does nothing if tasks already exist for that café day.
 *
 * Body: { cafeDay: string } — YYYY-MM-DD
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/** Returns the full day name (e.g. "Monday") for a YYYY-MM-DD date string */
function dayNameFromDate(cafeDay: string): string {
  // Parse as noon UTC to avoid timezone edge cases flipping the date
  const date = new Date(`${cafeDay}T12:00:00Z`)
  return date.toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'Australia/Sydney' })
}

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

  // Idempotency check — do nothing if tasks already exist for this café day
  const { count } = await admin
    .from('daily_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('cafe_day', cafeDay)

  if ((count ?? 0) > 0) {
    return NextResponse.json({ generated: 0, skipped: true })
  }

  // Work out which day of the week this café day falls on (AEST)
  const todayName = dayNameFromDate(cafeDay) // e.g. "Monday"

  // 1. Fetch daily templates (is_active = true — run every day)
  const { data: dailyTemplates, error: dailyError } = await admin
    .from('task_templates')
    .select('id, title, description, station')
    .eq('is_active', true)
    .order('station')
    .order('sort_order')

  if (dailyError) {
    return NextResponse.json({ error: dailyError.message }, { status: 500 })
  }

  // 2. Fetch weekly templates whose recurrence_days includes today
  //    Uses the Postgres @> (contains) operator on the text[] column
  const { data: weeklyTemplates, error: weeklyError } = await admin
    .from('task_templates')
    .select('id, title, description, station')
    .eq('is_active', false)
    .contains('recurrence_days', [todayName])
    .order('station')
    .order('sort_order')

  if (weeklyError) {
    return NextResponse.json({ error: weeklyError.message }, { status: 500 })
  }

  const allTemplates = [...(dailyTemplates ?? []), ...(weeklyTemplates ?? [])]

  if (allTemplates.length === 0) {
    return NextResponse.json({ generated: 0, skipped: false })
  }

  // Build rows — strip the "· Weekly: DayName" suffix from descriptions so it
  // doesn't clutter the task checklist UI
  const rows = allTemplates.map((t: {
    id: string
    title: string
    description: string | null
    station: string
  }) => ({
    template_id:  t.id,
    cafe_day:     cafeDay,
    title:        t.title,
    description:  t.description
      ? t.description.replace(/\s*·\s*Weekly:[^$]*/i, '').trim() || null
      : null,
    station:      t.station,
  }))

  const { error: insertError } = await admin.from('daily_tasks').insert(rows)

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ generated: rows.length, daily: dailyTemplates?.length ?? 0, weekly: weeklyTemplates?.length ?? 0 })
}
