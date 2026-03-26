'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import type { Profile } from '@/lib/types'

interface AuthState {
  profile: Profile | null
  loading: boolean
}

/** Hook that returns the current authenticated user's profile and loading state */
export function useAuth(): AuthState {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    // Fetch profile for the current session
    async function fetchProfile() {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setProfile(null)
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      setProfile(data ?? null)
      setLoading(false)
    }

    fetchProfile()

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchProfile()
    })

    return () => subscription.unsubscribe()
  }, [])

  return { profile, loading }
}
