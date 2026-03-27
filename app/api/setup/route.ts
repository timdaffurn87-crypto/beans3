import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/** Shared service-role client — bypasses RLS, server-side only */
function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * GET /api/setup
 * Returns { isFirstLaunch: true } if no profiles exist yet.
 * Uses service role so RLS doesn't hide the count from unauthenticated callers.
 */
export async function GET() {
  const supabase = getServiceClient()
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ isFirstLaunch: (count ?? 0) === 0 })
}

/**
 * POST /api/setup
 * Creates the first owner account (only works when no profiles exist).
 * Uses service role key to create auth user + profile row.
 */
export async function POST(request: Request) {
  const { name, pin, role } = await request.json()

  if (!name || !pin || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4–6 digits' }, { status: 400 })
  }

  const supabase = getServiceClient()

  // Make sure no profiles exist yet (safety check)
  const { count } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })

  if (count && count > 0) {
    return NextResponse.json({ error: 'Setup already completed' }, { status: 409 })
  }

  // Create the auth user
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: `pin${pin}@beans.local`,
    password: pin,
    email_confirm: true,
  })

  if (authError || !authUser.user) {
    return NextResponse.json({ error: authError?.message || 'Auth creation failed' }, { status: 500 })
  }

  // Create the profile
  const { error: profileError } = await supabase.from('profiles').insert({
    id: authUser.user.id,
    full_name: name,
    role,
    pin,
    is_active: true,
  })

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
