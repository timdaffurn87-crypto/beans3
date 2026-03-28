'use client'

/**
 * app/my-roster/page.tsx
 *
 * Staff-facing Roster View.
 * Fetches the authenticated staff member's upcoming week of shifts from the
 * Milk Firebase backend via getStaffRoster(), and renders them as shift cards.
 *
 * Auth: reads profile.id from the existing useAuth() hook — no new auth logic.
 * Data: calls lib/api/roster.ts which POSTs to the Firebase callable function.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import {
  getStaffRoster,
  formatShiftDate,
  formatShiftDuration,
  format12h,
  type Shift,
} from '@/lib/api/roster'
import { cn } from '@/lib/cn'

// ─── Role badge colours ───────────────────────────────────────────────────────

/** Maps known role strings to a Tailwind background + text colour pair */
function getRoleBadgeStyle(role: string): string {
  const r = role.toLowerCase()
  if (r.includes('barista'))   return 'bg-[#B8960C]/10 text-[#B8960C]'
  if (r.includes('floor'))     return 'bg-blue-50 text-blue-600'
  if (r.includes('supervisor') || r.includes('manager')) return 'bg-purple-50 text-purple-600'
  if (r.includes('kitchen'))   return 'bg-orange-50 text-orange-600'
  // Fallback for any other role
  return 'bg-gray-100 text-gray-600'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Full-screen loading spinner */
function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 py-20">
      <div className="w-10 h-10 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-gray-400">Loading your roster…</p>
    </div>
  )
}

/** Error state with optional retry callback */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 py-20 px-6 text-center">
      <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-2xl">
        ⚠️
      </div>
      <div>
        <p className="font-semibold text-[#1A1A1A] mb-1">Couldn't load roster</p>
        <p className="text-sm text-gray-400">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="px-6 py-3 rounded-full bg-[#B8960C] text-white text-sm font-semibold active:scale-95 transition-transform"
      >
        Try Again
      </button>
    </div>
  )
}

/** Empty state when no shifts are scheduled */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 py-20 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-[#B8960C]/10 flex items-center justify-center text-3xl">
        ☀️
      </div>
      <div>
        <p className="font-semibold text-[#1A1A1A] mb-1">You're all clear</p>
        <p className="text-sm text-gray-400 leading-relaxed">
          No upcoming shifts scheduled yet.{'\n'}Enjoy your time off!
        </p>
      </div>
    </div>
  )
}

/** A single shift card */
function ShiftCard({ shift }: { shift: Shift }) {
  const { dayName, displayDate } = formatShiftDate(shift.date)
  const duration = formatShiftDuration(shift.start_time, shift.end_time)
  const startDisplay = format12h(shift.start_time)
  const endDisplay = format12h(shift.end_time)

  // Determine if this shift is today
  const today = new Date().toISOString().split('T')[0]
  const isToday = shift.date === today

  return (
    <div
      className={cn(
        'bg-white rounded-2xl p-4 shadow-sm border transition-all',
        isToday
          ? 'border-[#B8960C]/40 shadow-[#B8960C]/10 shadow-md'
          : 'border-gray-100'
      )}
    >
      {/* Today badge */}
      {isToday && (
        <div className="mb-2">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-[#B8960C] bg-[#B8960C]/10 px-2 py-0.5 rounded-full">
            Today
          </span>
        </div>
      )}

      {/* Date row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="font-bold text-[#1A1A1A] text-base leading-tight">{dayName}</p>
          <p className="text-xs text-gray-400 mt-0.5">{displayDate}</p>
        </div>
        {/* Role badge */}
        <span
          className={cn(
            'text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap flex-shrink-0',
            getRoleBadgeStyle(shift.role)
          )}
        >
          {shift.role}
        </span>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100 mb-3" />

      {/* Time + duration row */}
      <div className="flex items-center justify-between">
        {/* Time range */}
        <div className="flex items-center gap-2">
          {/* Clock icon */}
          <span className="text-gray-300 text-lg leading-none">🕐</span>
          <span className="text-[#1A1A1A] font-semibold text-sm">
            {startDisplay}
          </span>
          <span className="text-gray-300 text-xs">→</span>
          <span className="text-[#1A1A1A] font-semibold text-sm">
            {endDisplay}
          </span>
        </div>

        {/* Duration pill */}
        <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
          {duration}
        </span>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MyRosterPage() {
  const router = useRouter()
  const { profile, loading: authLoading } = useAuth()

  const [shifts, setShifts] = useState<Shift[]>([])
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  // If Firebase backend URL isn't configured, show coming soon instead of an error
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL)

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!authLoading && !profile) {
      router.replace('/login')
    }
  }, [authLoading, profile, router])

  /** Fetches roster data — called on mount and on manual retry */
  async function fetchRoster() {
    if (!profile) return

    setFetchState('loading')
    setErrorMessage('')

    try {
      const data = await getStaffRoster(profile.id)
      setShifts(data)
      setFetchState('success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setErrorMessage(msg)
      setFetchState('error')
    }
  }

  // Kick off fetch once we have a profile — but only if the backend is configured
  useEffect(() => {
    if (profile && fetchState === 'idle' && isConfigured) {
      fetchRoster()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  // ── Render ─────────────────────────────────────────────────────────────────

  // Show spinner while we wait for auth to resolve or profile to load
  if (authLoading || (!profile && fetchState === 'idle')) {
    return (
      <main
        className="min-h-screen flex flex-col"
        style={{ backgroundColor: '#FAF8F3' }}
      >
        <LoadingScreen />
      </main>
    )
  }

  return (
    <main
      className="min-h-screen flex flex-col pb-24"
      style={{ backgroundColor: '#FAF8F3' }}
    >
      {/* ── Header ── */}
      <div className="px-4 pt-12 pb-4">
        <button
          onClick={() => router.back()}
          className="text-gray-400 text-sm mb-4 flex items-center gap-1 active:opacity-60 transition-opacity"
          aria-label="Go back"
        >
          ← Back
        </button>

        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-1">
              Roster
            </p>
            <h1 className="text-2xl font-bold text-[#1A1A1A] leading-tight">
              My Shifts
            </h1>
          </div>

          {/* Week range label */}
          <UpcomingWeekLabel />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col px-4">

        {/* Coming soon — shown when Firebase backend isn't connected yet */}
        {!isConfigured && (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 py-20 px-6 text-center">
            <div className="w-16 h-16 rounded-full bg-[#B8960C]/10 flex items-center justify-center text-3xl">
              📅
            </div>
            <div>
              <p className="font-bold text-[#1A1A1A] text-lg mb-1">Coming Soon</p>
              <p className="text-sm text-gray-400 leading-relaxed">
                Your roster will appear here once the scheduling system is connected.
              </p>
            </div>
          </div>
        )}

        {/* Loading */}
        {isConfigured && fetchState === 'loading' && <LoadingScreen />}

        {/* Error */}
        {isConfigured && fetchState === 'error' && (
          <ErrorState message={errorMessage} onRetry={fetchRoster} />
        )}

        {/* Success — empty */}
        {isConfigured && fetchState === 'success' && shifts.length === 0 && <EmptyState />}

        {/* Success — shifts list */}
        {isConfigured && fetchState === 'success' && shifts.length > 0 && (
          <div className="flex flex-col gap-3 pt-1">
            {/* Shift count summary */}
            <p className="text-xs text-gray-400 font-medium px-1">
              {shifts.length} shift{shifts.length !== 1 ? 's' : ''} this week
            </p>

            {shifts.map(shift => (
              <ShiftCard key={shift.id} shift={shift} />
            ))}

            {/* Weekly hours total */}
            <WeeklyHoursSummary shifts={shifts} />
          </div>
        )}
      </div>
    </main>
  )
}

// ─── Supporting components ────────────────────────────────────────────────────

/** Displays the date range for the upcoming week */
function UpcomingWeekLabel() {
  const today = new Date()
  const end = new Date(today)
  end.setDate(today.getDate() + 6)

  const startLabel = today.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const endLabel = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

  return (
    <div className="text-right">
      <p className="text-xs text-gray-400">Upcoming week</p>
      <p className="text-xs font-semibold text-[#1A1A1A]">
        {startLabel} – {endLabel}
      </p>
    </div>
  )
}

/** Totals up the hours across all shifts and shows a summary card */
function WeeklyHoursSummary({ shifts }: { shifts: Shift[] }) {
  const totalMins = shifts.reduce((acc, shift) => {
    const toMins = (t: string) => {
      const [h, m] = t.split(':').map(Number)
      return h * 60 + (m ?? 0)
    }
    const duration = toMins(shift.end_time) - toMins(shift.start_time)
    return acc + (duration > 0 ? duration : 0)
  }, 0)

  const totalHours = totalMins / 60
  const formatted = totalHours % 1 === 0 ? totalHours.toString() : totalHours.toFixed(1)

  return (
    <div className="mt-2 bg-[#1A1A1A] rounded-2xl p-4 flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-0.5">
          Total this week
        </p>
        <p className="text-white font-bold text-xl">
          {formatted} hours
        </p>
      </div>
      <div className="w-10 h-10 rounded-full bg-[#B8960C]/20 flex items-center justify-center text-xl">
        ⏱
      </div>
    </div>
  )
}
