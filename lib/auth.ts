import { createClient } from './supabase'
import type { Profile } from './types'

/**
 * Attempts to sign in with a PIN by constructing the dummy email format.
 * Returns the profile on success, null on failure.
 */
export async function signInWithPin(pin: string): Promise<Profile | null> {
  const supabase = createClient()
  const email = `pin${pin}@beans.local`

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: pin,
  })

  if (error) return null

  // Fetch the staff profile
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .eq('is_active', true)
    .single()

  return profile ?? null
}

/** Signs out the current user */
export async function signOut(): Promise<void> {
  const supabase = createClient()
  await supabase.auth.signOut()
}

/** Gets the current user's profile */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return profile ?? null
}
