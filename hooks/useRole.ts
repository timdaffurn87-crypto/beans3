'use client'

import { useAuth } from './useAuth'

/** Returns role-check booleans for the current user */
export function useRole() {
  const { profile } = useAuth()

  return {
    role: profile?.role ?? null,
    isBarista: profile?.role === 'barista',
    isKitchen: profile?.role === 'kitchen',
    isManager: profile?.role === 'manager' || profile?.role === 'owner',
    isOwner: profile?.role === 'owner',
  }
}
