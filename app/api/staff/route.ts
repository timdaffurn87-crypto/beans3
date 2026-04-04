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

  // Check PIN is not already taken
  const supabaseAdmin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('pin', pin)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'PIN already in use' }, { status: 409 })
  }

  // Create auth user. If creation fails because the dummy email already exists
  // (e.g. from a partially-failed previous attempt where the profile insert
  // failed but the auth user was created), clean up the orphaned auth user
  // and retry once.
  const dummyEmail = `pin${pin}@beans.local`

  let { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: dummyEmail,
    password: pin,
    email_confirm: true,
  })

  const isEmailTaken = authError?.message?.toLowerCase().includes('already') &&
    (authError.message.toLowerCase().includes('registered') || authError.message.toLowerCase().includes('used') || authError.message.toLowerCase().includes('exists'))
  if (isEmailTaken) {
    // Find and delete the orphaned auth user, then retry
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const staleUser = existingUsers?.users?.find(u => u.email === dummyEmail)
    if (staleUser) {
      await supabaseAdmin.auth.admin.deleteUser(staleUser.id)
    }
    const retry = await supabaseAdmin.auth.admin.createUser({
      email: dummyEmail,
      password: pin,
      email_confirm: true,
    })
    authUser = retry.data
    authError = retry.error
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
