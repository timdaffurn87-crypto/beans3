import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * PATCH /api/staff/:id
 * Updates a staff member's name, role, PIN, or active status. Owner only.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: requestingProfile } = await supabaseAuth.from('profiles').select('role').eq('id', user.id).single()
  if (requestingProfile?.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { name, role, pin, is_active } = body

  const supabaseAdmin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.full_name = name
  if (role !== undefined) updates.role = role
  if (pin !== undefined) updates.pin = pin
  if (is_active !== undefined) updates.is_active = is_active

  // If PIN is changing, update the auth user's email and password
  if (pin !== undefined) {
    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be 4–6 digits' }, { status: 400 })
    }

    // Check PIN not taken by another user
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('pin', pin)
      .neq('id', id)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'PIN already in use' }, { status: 409 })
    }

    await supabaseAdmin.auth.admin.updateUserById(id, {
      email: `pin${pin}@beans.local`,
      password: pin,
    })
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
