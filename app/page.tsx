'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useRole } from '@/hooks/useRole'
import { CalibrationAlert } from '@/components/CalibrationAlert'
import { getGreeting, getCurrentCafeDay } from '@/lib/cafe-day'
import { formatDisplayDate, formatCurrency } from '@/lib/utils'
import { createClient } from '@/lib/supabase'

interface DashboardStats {
  tasksCompleted: number
  tasksTotal: number
  wasteTotal: number
  dayIsClosed: boolean
}

/** Main dashboard screen — the home screen after login */
export default function DashboardPage() {
  const { profile, loading } = useAuth()
  const { isManager, isOwner } = useRole()
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats>({
    tasksCompleted: 0, tasksTotal: 0, wasteTotal: 0, dayIsClosed: false,
  })

  /**
   * Xero connection status — shown as a small pulsing dot in the header.
   * Queries xero_tokens directly; RLS means non-owners get null automatically.
   */
  const [xeroConnected, setXeroConnected] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !profile) router.push('/login')
  }, [profile, loading, router])

  // Fetch today's stats
  useEffect(() => {
    if (!profile) return

    async function fetchStats() {
      const supabase = createClient()
      const cafeDay = getCurrentCafeDay()

      // Fetch task counts, waste total, and EOD report status in parallel
      const [tasksRes, wasteRes, eodRes] = await Promise.all([
        supabase.from('daily_tasks').select('id, completed_at').eq('cafe_day', cafeDay),
        supabase.from('waste_logs').select('total_cost').eq('cafe_day', cafeDay),
        supabase.from('eod_reports').select('id').eq('cafe_day', cafeDay).single(),
      ])

      const tasksCompleted = tasksRes.data?.filter(t => t.completed_at).length ?? 0
      const tasksTotal     = tasksRes.data?.length ?? 0
      const wasteTotal     = wasteRes.data?.reduce((sum, w) => sum + w.total_cost, 0) ?? 0
      const dayIsClosed    = !!eodRes.data

      setStats({ tasksCompleted, tasksTotal, wasteTotal, dayIsClosed })
    }

    fetchStats()
  }, [profile])

  // Check Xero connection — RLS returns empty for non-owners so the dot
  // only appears for the owner when a token row exists.
  useEffect(() => {
    if (!profile) return
    const supabase = createClient()
    supabase
      .from('xero_tokens')
      .select('id')
      .single()
      .then(({ data }) => setXeroConnected(!!data))
  }, [profile])

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-8 h-8 border-4 border-[#B8960C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const greeting    = getGreeting()
  const cafeDay     = getCurrentCafeDay()
  const displayDate = formatDisplayDate(cafeDay)
  const firstName   = profile.full_name.split(' ')[0]

  const quickActions = [
    { href: '/calibration', label: 'Coffee Calibration', desc: 'Log a dial-in',             icon: '☕' },
    { href: '/waste',       label: 'Waste Logger',       desc: 'Record waste',              icon: '🗑' },
    { href: '/tasks',       label: 'Daily Tasks',        desc: 'Check off tasks',           icon: '✓' },
    { href: '/invoice',     label: 'Scan Invoice',       desc: 'Capture delivery receipts', icon: '📄' },
    { href: '/recipes',     label: 'Recipe Book',        desc: 'View recipes',              icon: '📖' },
    { href: '/eod',         label: 'End of Day',         desc: 'Submit shift report',       icon: '🌙' },
  ]

  const managerActions = [
    { href: '/results',          label: '7-Day Results', desc: 'Performance overview', icon: '📊' },
    { href: '/admin/settings',   label: 'Settings',      desc: 'Staff & café config',  icon: '⚙' },
  ]

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: 'var(--bg-oatmeal)' }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="px-5 pt-12 pb-4">
        <div className="flex items-start justify-between">
          <div>
            {/* Playfair Display greeting — applied via h1 rule in globals.css */}
            <h1 className="text-2xl font-bold" style={{ color: 'var(--fg-slate)' }}>
              {greeting}, {firstName}.
            </h1>

            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm text-gray-400">{displayDate}</p>
              {stats.dayIsClosed && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-[#16A34A] font-medium">
                  Day Closed
                </span>
              )}
            </div>
          </div>

          {/* Right side: Xero status dot + Log Out */}
          <div className="flex items-center gap-3 mt-1">
            {/* Xero connection indicator — only visible to owner when connected.
                8px circle with a matcha pulse animation. */}
            {xeroConnected && (
              <span
                className="block w-2 h-2 rounded-full animate-pulse-matcha"
                style={{ backgroundColor: 'var(--accent-matcha)' }}
                title="Xero connected"
              />
            )}

            <button
              onClick={async () => {
                const { signOut } = await import('@/lib/auth')
                await signOut()
                router.push('/login')
              }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>

      <div className="px-5 space-y-5">

        {/* Calibration alert — highest priority element on the screen */}
        <CalibrationAlert />

        {/* ── Summary cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4 card-interactive">
            <p className="section-label mb-1">Today&apos;s Waste</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--fg-slate)' }}>
              {formatCurrency(stats.wasteTotal)}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-4 card-interactive">
            <p className="section-label mb-1">Tasks Done</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--fg-slate)' }}>
              {stats.tasksTotal > 0 ? `${stats.tasksCompleted}/${stats.tasksTotal}` : '—'}
            </p>
            {stats.tasksTotal > 0 && (
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(stats.tasksCompleted / stats.tasksTotal) * 100}%`,
                    backgroundColor: 'var(--accent-gold)',
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Operations ────────────────────────────────────────────────── */}
        <div>
          <p className="section-label mb-3">Operations</p>
          <div className="space-y-2">
            {quickActions.map(action => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center bg-white rounded-2xl p-4 card-interactive"
              >
                <span className="text-2xl mr-4 w-8 text-center">{action.icon}</span>
                <div className="flex-1">
                  <p className="font-semibold" style={{ color: 'var(--fg-slate)' }}>{action.label}</p>
                  <p className="text-sm text-gray-400">{action.desc}</p>
                </div>
                <span className="text-gray-300 text-lg">›</span>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Management (manager / owner only) ─────────────────────────── */}
        {(isManager || isOwner) && (
          <div>
            <p className="section-label mb-3">Management</p>
            <div className="space-y-2">
              {managerActions.map(action => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-center bg-white rounded-2xl p-4 card-interactive"
                >
                  <span className="text-2xl mr-4 w-8 text-center">{action.icon}</span>
                  <div className="flex-1">
                    <p className="font-semibold" style={{ color: 'var(--fg-slate)' }}>{action.label}</p>
                    <p className="text-sm text-gray-400">{action.desc}</p>
                  </div>
                  <span className="text-gray-300 text-lg">›</span>
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
