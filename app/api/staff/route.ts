import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * POST /api/staff
 * Creates a new staff member. Owner only.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies()

  const supabaseAuth = createServerClient(
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

  // Verify the requesting user is an owner
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAuth.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, pin, role } = await request.json()

  if (!name || !pin || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4–6 digits' }, { status: 400 })
  }

  const supabaseAdmin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Check PIN is not already taken in profiles
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('pin', pin)
    .single()

  if (existingProfile) {
    return NextResponse.json({ error: 'PIN already in use' }, { status: 409 })
  }

  // Create auth user for PIN-based login. Uses a dummy email pattern.
  // If an orphaned auth user exists from a previous failed attempt, we detect
  // it via signInWithPassword, delete it, then retry createUser.
  const dummyEmail = `pin${pin}@beans.local`

  let { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: dummyEmail,
    password: pin,
    email_confirm: true,
  })

  // If creation failed (likely "email already registered"), find and remove
  // the orphaned auth user by signing in with the known credentials to get its ID
  if (authError) {
    const { data: signInData } = await supabaseAdmin.auth.signInWithPassword({
      email: dummyEmail,
      password: pin,
    })

    if (signInData?.user) {
      // Found the orphan — delete it and retry creation
      await supabaseAdmin.auth.admin.deleteUser(signInData.user.id)
      const retry = await supabaseAdmin.auth.admin.createUser({
        email: dummyEmail,
        password: pin,
        email_confirm: true,
      })
      authUser = retry.data
      authError = retry.error
    }
    // If sign-in also failed, the original createUser error stands
  }

  if (authError || !authUser.user) {
    return NextResponse.json({ error: authError?.message || 'Auth creation failed' }, { status: 500 })
  }

  // Create profile
  const { error: profileError } = await supabaseAdmin.from('profiles').insert({
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
